/**
 * preset command — save and restore single-device parameter presets.
 *
 * A preset captures the parameter state of ONE device from ONE track.
 * Unlike snapshots (whole-set state), presets are named, device-specific,
 * and can be applied to any track that has a matching device.
 *
 * Works with native Ableton devices (Analog, Operator, Wavetable…) and
 * VST/AU plugins — anything that exposes parameters via the Live API.
 *
 * Usage:
 *   ableton-composer preset save "Track 1"
 *   ableton-composer preset save "Track 1" --device "ValhallaSupermassive" --name "my-hall"
 *   ableton-composer preset load presets/my-hall.json --track "Track 1"
 *   ableton-composer preset list
 */

import chalk from 'chalk';
import ora from 'ora';
import { writeFile, readFile, readdir, stat, mkdir } from 'fs/promises';
import { join, dirname, basename } from 'path';
import { fileURLToPath } from 'url';
import { connect, disconnect, getMidiTracks } from '../lib/ableton.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const PRESETS_DIR = join(__dirname, '../../presets');

// Parameters that are structural / read-only / not useful for sound design
const SKIP_PARAMS = new Set(['Device On']);
const SKIP_PATTERN = /^Reserved\d*$/;

function shouldSkip(name, includeAll) {
  if (includeAll) return false;
  return SKIP_PARAMS.has(name) || SKIP_PATTERN.test(name);
}

// ─── save ────────────────────────────────────────────────────────────────────

export async function presetSaveCommand(trackArg, options) {
  const spinner = ora();

  try {
    spinner.start('Connecting to Ableton Live...');
    const ableton = await connect();
    spinner.succeed('Connected');

    // ── Find track ──────────────────────────────────────────────────────────
    const allTracks = await getMidiTracks(ableton);

    // Also check audio tracks (VST effects live on any track type)
    const rawTracks  = await ableton.song.get('tracks');
    const trackMap   = new Map();
    for (const t of rawTracks) {
      const n = await t.get('name').catch(() => null);
      if (n) trackMap.set(n, t);
    }

    const targetTrack = trackMap.get(trackArg);
    if (!targetTrack) {
      const names = [...trackMap.keys()].join(', ');
      throw new Error(`Track "${trackArg}" not found. Available: ${names}`);
    }

    // ── Find device ─────────────────────────────────────────────────────────
    let devices;
    try {
      devices = await targetTrack.get('devices');
    } catch {
      throw new Error(`Track "${trackArg}" has no devices.`);
    }

    if (devices.length === 0) {
      throw new Error(`Track "${trackArg}" has no devices.`);
    }

    let device;
    let deviceName;
    let deviceClass;
    let deviceType;

    if (options.device) {
      // Find by name (case-insensitive partial match)
      const lower = options.device.toLowerCase();
      for (const d of devices) {
        const n = await d.get('name');
        if (n.toLowerCase().includes(lower)) {
          device = d;
          deviceName = n;
          break;
        }
      }
      if (!device) {
        const devNames = await Promise.all(devices.map(d => d.get('name')));
        throw new Error(`Device "${options.device}" not found on "${trackArg}". Available: ${devNames.join(', ')}`);
      }
    } else if (devices.length === 1) {
      device = devices[0];
      deviceName = await device.get('name');
    } else {
      // Multiple devices — pick the first instrument-type device, or just the first
      const devInfos = await Promise.all(devices.map(async d => ({
        d,
        name: await d.get('name'),
        type: await d.get('type').catch(() => null),
      })));

      // Prefer instruments over effects
      const instrument = devInfos.find(i => i.type === 'instrument');
      const chosen = instrument ?? devInfos[0];
      device     = chosen.d;
      deviceName = chosen.name;

      const allNames = devInfos.map(i => `"${i.name}"`).join(', ');
      console.log(chalk.yellow(`  ⚠ Multiple devices on "${trackArg}" — using "${deviceName}".`));
      console.log(chalk.dim(`    All: ${allNames}  |  specify with --device to pick one.`));
    }

    [deviceClass, deviceType] = await Promise.all([
      device.get('class_display_name').catch(() => null),
      device.get('type').catch(() => null),
    ]);

    // ── Read parameters ──────────────────────────────────────────────────────
    spinner.start(`Reading parameters from "${deviceName}"...`);

    let params;
    try {
      params = await device.get('parameters');
    } catch {
      throw new Error(`Device "${deviceName}" exposes no parameters via the Live API.`);
    }

    const parameters = {};
    let skippedCount = 0;

    for (const p of params) {
      const [pName, pValue] = await Promise.all([p.get('name'), p.get('value')]);
      if (shouldSkip(pName, options.allParams)) {
        skippedCount++;
        continue;
      }
      parameters[pName] = pValue;
    }

    const paramCount = Object.keys(parameters).length;
    spinner.succeed(
      `Read ${paramCount} parameter(s) from "${deviceName}"` +
      (skippedCount > 0 ? chalk.dim(` (${skippedCount} system params skipped)`) : '')
    );

    // ── Build preset object ───────────────────────────────────────────────────
    const presetName = options.name || slugify(deviceName);
    const preset = {
      name:         presetName,
      device:       deviceName,
      device_class: deviceClass,
      device_type:  deviceType,
      source_track: trackArg,
      created_at:   new Date().toISOString(),
      parameters,
    };

    // ── Save ──────────────────────────────────────────────────────────────────
    await mkdir(PRESETS_DIR, { recursive: true });

    let outPath;
    if (options.out) {
      outPath = options.out;
    } else {
      outPath = join(PRESETS_DIR, `${slugify(presetName)}.json`);
    }

    await writeFile(outPath, JSON.stringify(preset, null, 2), 'utf-8');

    console.log('');
    console.log(chalk.bold(`  ${deviceName}`));
    console.log(chalk.dim(`  type: ${deviceType || 'unknown'}  |  class: ${deviceClass || 'unknown'}`));
    console.log('');

    // Print a compact parameter summary
    const entries = Object.entries(parameters);
    for (const [k, v] of entries.slice(0, 20)) {
      const bar = renderBar(v, 20);
      console.log(`  ${chalk.dim(k.padEnd(24))}  ${bar}  ${String(v.toFixed(4)).padStart(7)}`);
    }
    if (entries.length > 20) {
      console.log(chalk.dim(`  ... and ${entries.length - 20} more`));
    }

    console.log('');
    console.log(chalk.green(`✓ Preset saved to ${outPath}`));
    console.log(chalk.dim(`  Restore with: ableton-composer preset load ${outPath} --track "${trackArg}"`));

  } catch (err) {
    spinner.fail(err.message);
    process.exit(1);
  } finally {
    await disconnect();
  }
}

// ─── load ────────────────────────────────────────────────────────────────────

export async function presetLoadCommand(fileArg, options) {
  const spinner = ora();

  try {
    // ── Read preset file ─────────────────────────────────────────────────────
    const absPath = fileArg.startsWith('/')
      ? fileArg
      : join(process.cwd(), fileArg);

    const raw = await readFile(absPath, 'utf-8').catch(() => {
      throw new Error(`Preset file not found: ${absPath}`);
    });
    const preset = JSON.parse(raw);

    console.log(chalk.dim(`  Preset:  ${preset.name || basename(fileArg)}`));
    console.log(chalk.dim(`  Device:  ${preset.device}`));
    console.log(chalk.dim(`  Params:  ${Object.keys(preset.parameters).length}`));
    console.log('');

    if (!options.track) {
      throw new Error('--track <name> is required to load a preset.');
    }

    spinner.start('Connecting to Ableton Live...');
    const ableton = await connect();
    spinner.succeed('Connected');

    // ── Find track ──────────────────────────────────────────────────────────
    const rawTracks = await ableton.song.get('tracks');
    const trackMap  = new Map();
    for (const t of rawTracks) {
      const n = await t.get('name').catch(() => null);
      if (n) trackMap.set(n, t);
    }

    const targetTrack = trackMap.get(options.track);
    if (!targetTrack) {
      const names = [...trackMap.keys()].join(', ');
      throw new Error(`Track "${options.track}" not found. Available: ${names}`);
    }

    // ── Find device ─────────────────────────────────────────────────────────
    let devices;
    try {
      devices = await targetTrack.get('devices');
    } catch {
      throw new Error(`Track "${options.track}" has no devices.`);
    }

    let device;
    const deviceTarget = options.device || preset.device;

    if (deviceTarget) {
      const lower = deviceTarget.toLowerCase();
      for (const d of devices) {
        const n = await d.get('name');
        if (n.toLowerCase().includes(lower)) {
          device = d;
          break;
        }
      }
      if (!device) {
        const devNames = await Promise.all(devices.map(d => d.get('name')));
        throw new Error(
          `Device "${deviceTarget}" not found on "${options.track}". Available: ${devNames.join(', ')}`
        );
      }
    } else {
      device = devices[0];
    }

    const liveDeviceName = await device.get('name');

    // ── Apply parameters ─────────────────────────────────────────────────────
    spinner.start(`Applying ${Object.keys(preset.parameters).length} parameters to "${liveDeviceName}"...`);

    let liveParams;
    try {
      liveParams = await device.get('parameters');
    } catch {
      throw new Error(`Device "${liveDeviceName}" has no automatable parameters.`);
    }

    // Build param name → param object map
    const liveParamMap = new Map();
    for (const p of liveParams) {
      const pName = await p.get('name');
      if (!liveParamMap.has(pName)) liveParamMap.set(pName, p);
    }

    let restored = 0;
    let skipped  = 0;
    const notFound = [];

    for (const [paramName, paramValue] of Object.entries(preset.parameters)) {
      const liveParam = liveParamMap.get(paramName);
      if (!liveParam) {
        notFound.push(paramName);
        skipped++;
        continue;
      }
      try {
        await liveParam.set('value', paramValue);
        restored++;
      } catch {
        // Read-only parameter (e.g. Device On, meters)
        skipped++;
      }
    }

    spinner.succeed(
      `Applied ${restored} parameter(s)` +
      (skipped > 0 ? chalk.dim(` (${skipped} skipped)`) : '')
    );

    if (notFound.length > 0) {
      console.log(chalk.yellow(`\n  ⚠ Parameters not found on device (plugin version may differ):`));
      notFound.slice(0, 10).forEach(n => console.log(chalk.dim(`    ${n}`)));
      if (notFound.length > 10) console.log(chalk.dim(`    ... and ${notFound.length - 10} more`));
    }

    console.log('');
    console.log(chalk.green(`✓ Preset "${preset.name || basename(fileArg)}" applied to "${options.track}" → "${liveDeviceName}"`));

  } catch (err) {
    spinner.fail(err.message);
    process.exit(1);
  } finally {
    await disconnect();
  }
}

// ─── list ────────────────────────────────────────────────────────────────────

export async function presetListCommand() {
  try {
    let entries;
    try {
      entries = await readdir(PRESETS_DIR);
    } catch {
      console.log(chalk.dim('  No presets directory found. Run `preset save` first.'));
      return;
    }

    const jsonFiles = entries.filter(f => f.endsWith('.json'));

    if (jsonFiles.length === 0) {
      console.log(chalk.dim('  No presets saved yet. Run `preset save <track>` to create one.'));
      return;
    }

    const presets = await Promise.all(
      jsonFiles.map(async f => {
        const filepath = join(PRESETS_DIR, f);
        const info = await stat(filepath);
        let data = {};
        try { data = JSON.parse(await readFile(filepath, 'utf-8')); } catch {}
        return { filename: f, filepath, mtime: info.mtime, data };
      })
    );

    presets.sort((a, b) => b.mtime - a.mtime);

    console.log('');
    console.log(chalk.bold('  Saved presets\n'));

    for (const { filename, filepath, data } of presets) {
      const paramCount = data.parameters ? Object.keys(data.parameters).length : '?';
      console.log(
        `  ${chalk.cyan(data.name || filename.replace('.json', ''))}` +
        chalk.dim(`  ${data.device || '?'}  —  ${paramCount} params`)
      );
      if (data.device_type) {
        console.log(chalk.dim(`    type: ${data.device_type}  |  source: ${data.source_track || '?'}`));
      }
      console.log(chalk.dim(`    ${filepath}`));
      console.log('');
    }

    console.log(chalk.dim(`  ${presets.length} preset(s) in ${PRESETS_DIR}`));
    console.log('');

  } catch (err) {
    console.error(chalk.red(`✗ ${err.message}`));
    process.exit(1);
  }
}

// ─── helpers ─────────────────────────────────────────────────────────────────

function slugify(str) {
  return str.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 50);
}

function renderBar(value, width = 16) {
  const filled = Math.round(Math.max(0, Math.min(1, value)) * width);
  return chalk.cyan('█'.repeat(filled)) + chalk.dim('░'.repeat(width - filled));
}
