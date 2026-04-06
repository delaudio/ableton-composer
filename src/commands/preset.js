/**
 * preset command — save and restore single-device parameter presets.
 *
 * Presets are stored as:
 *   presets/<brand>/<device>/<name>.json            (flat)
 *   presets/<brand>/<device>/<category>/<name>.json (with subcategory)
 *
 * Works with native Ableton devices and VST/AU plugins.
 *
 * Usage:
 *   ableton-composer preset save "Track 1"
 *   ableton-composer preset save "Track 1" --device "ValhallaSupermassive" --name "dark-hall"
 *   ableton-composer preset save "Track 1" --brand "Valhalla" --name "dark-hall"
 *   ableton-composer preset load presets/Valhalla/Supermassive/dark-hall.json --track "Track 1"
 *   ableton-composer preset list
 */

import chalk from 'chalk';
import ora from 'ora';
import { writeFile, readFile, readdir, stat, mkdir } from 'fs/promises';
import { join, dirname, basename, relative } from 'path';
import { fileURLToPath } from 'url';
import { connect, disconnect } from '../lib/ableton.js';
import { generatePresetObject, getProviderLabel, normalizeProvider } from '../lib/ai.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
export const PRESETS_DIR = join(__dirname, '../../presets');

// Parameters that are structural / read-only / not useful for sound design
const SKIP_PARAMS  = new Set(['Device On']);
const SKIP_PATTERN = /^Reserved\d*$/;

function shouldSkip(name, includeAll) {
  if (includeAll) return false;
  return SKIP_PARAMS.has(name) || SKIP_PATTERN.test(name);
}

// ─── Brand detection ──────────────────────────────────────────────────────────

/**
 * Known brand patterns — ordered, first match wins.
 * Each entry: { brand, pattern, deviceSuffix? }
 *
 * deviceSuffix: regex to strip brand prefix from device name for the folder name.
 * e.g. "ValhallaSupermassive" → brand="Valhalla", device="Supermassive"
 */
const BRAND_PATTERNS = [
  // ── Valhalla DSP ──────────────────────────────────────────────────────────
  { brand: 'Valhalla', pattern: /^Valhalla/i,       strip: /^Valhalla/i },

  // ── Ableton native ───────────────────────────────────────────────────────
  {
    brand: 'Ableton',
    pattern: /^(Analog|Operator|Wavetable|Drift|Meld|Tension|Electric|Simpler|Sampler|Impulse|Drum Rack|Arpeggiator|Chord|Note Length|Pitch|Random|Scale|Velocity|Beat Repeat|Corpus|Erosion|Filter Delay|Grain Delay|Redux|Resonator|Spectral Resonator|Spectral Blur|Vinyl Distortion|Compressor|Dynamic Tube|Gate|Glue Compressor|Limiter|Multiband Dynamics|Overdrive|Pedal|Saturator|Amp|Cabinet|AutoFilter|AutoPan|AutoWah|Chorus|Flanger|Frequency Shifter|Phaser|Reverb|EQ Eight|EQ Three|Looper|Tuner|CV|Max)$/i,
  },

  // ── FabFilter ────────────────────────────────────────────────────────────
  { brand: 'FabFilter', pattern: /^(FabFilter|Pro-Q|Pro-C|Pro-L|Pro-R|Pro-G|Pro-MB|Pro-DS|Saturn|Twin|Timeless|Volcano|One|Micro|Simplon|Flux)/i },

  // ── iZotope ───────────────────────────────────────────────────────────────
  { brand: 'iZotope', pattern: /^(iZotope|Neutron|Ozone|RX |Iris|Trash|BreakTweaker|Stutter Edit|VocalSynth|Nectar|Relay|Insight|DDLY|Alloy)/i },

  // ── Xfer Records ─────────────────────────────────────────────────────────
  { brand: 'Xfer Records', pattern: /^(Serum|LFO Tool|Nerve|Cthulhu|OTT|Dimension Expander)/i },

  // ── Native Instruments ────────────────────────────────────────────────────
  { brand: 'Native Instruments', pattern: /^(Massive|Reaktor|Kontakt|Battery|Absynth|FM8|Razor|Monark|Prism|Session Guitarist|Strummed Acoustic|Super 8|Retro Machines|Polyplex|Rounds|Damage|Driver|Replika|Raum|Phasis|Flair|Supercharger|Transient Master)/i },

  // ── Arturia ───────────────────────────────────────────────────────────────
  { brand: 'Arturia', pattern: /^(Arturia|Analog Lab|Pigments|ARP 2600|Jun-6 V|Jup-8 V|Jupiter-8 V|CS-80 V|Prophet V|Prophet-5 V|Prophet-VS V|Mini V|SEM V|OB-Xa V|Matrix-12 V|MS-20 V|B-3 V|Stage-73 V|Farfisa V|Vocoder V|Solina V|CMI V|DX7 V|CZ V|Buchla Easel V|Mellotron V|Synclavier V|Synthi V|Emulator II V|Vox Continental V|Clavinet V|Modular V|OP-Xa V|Piano V|Wurli V|D-50 V)/i },

  // ── u-he ─────────────────────────────────────────────────────────────────
  { brand: 'u-he', pattern: /^(Diva|Zebra|Hive|Repro|Bazille|ACE|Podolski|Triple Cheese|Uhbik|Colour Copy|Presswerk|Satin|Twangström|MFM2)/i },

  // ── Waves ─────────────────────────────────────────────────────────────────
  { brand: 'Waves', pattern: /^(Waves|C1|C4|C6|H-Comp|H-Delay|H-Reverb|H-EQ|Abbey Road|SSL|API|Kramer|NLS|CLA|V-Comp|V-EQ|V-Reverb|Renaissance|Linear Phase|PAZ|Q10|S1 Stereo|MaxxBass|DeBreath|Tune|OVox)/i },

  // ── Soundtoys ─────────────────────────────────────────────────────────────
  { brand: 'Soundtoys', pattern: /^(EchoBoy|Decapitator|Crystallizer|PanMan|PhaseMistress|FilterFreak|MicroShift|Radiator|Little AlterBoy|Little Plate|Devil-Loc|Tremolator|Sie-Q|Soundtoys 5)/i },

  // ── Plugin Alliance / brainworx ───────────────────────────────────────────
  { brand: 'Plugin Alliance', pattern: /^(bx_|Lindell|Elysia|Maag|SPL|Shadow Hills|Millennia|API 500|black box)/i },

  // ── Eventide ──────────────────────────────────────────────────────────────
  { brand: 'Eventide', pattern: /^(H3000|H9 |UltraChannel|UltraReverb|Blackhole|Mangler|Octavox|Quadravox|Instant Phaser|Instant Flanger|Anthology)/i },

  // ── Lexicon ───────────────────────────────────────────────────────────────
  { brand: 'Lexicon', pattern: /^(Lexicon|PCM)/i },

  // ── Softube ───────────────────────────────────────────────────────────────
  { brand: 'Softube', pattern: /^(Softube|Tube-Tech|Tonelux|Valley People|Summit Audio|Weiss|Drawmer|Harmonics|TSAR|Spring Reverb|Console 1|Console 4|Modular)/i },

  // ── Celemony ──────────────────────────────────────────────────────────────
  { brand: 'Celemony', pattern: /^(Melodyne)/i },

  // ── Spectrasonics ─────────────────────────────────────────────────────────
  { brand: 'Spectrasonics', pattern: /^(Omnisphere|Trilian|Stylus)/i },

  // ── Sugar Bytes ───────────────────────────────────────────────────────────
  { brand: 'Sugar Bytes', pattern: /^(Turnado|Effectrix|Aparillo|Thesys|Guitarist|WOW2|Looperator|Cyclop|Artillery)/i },

  // ── Output ────────────────────────────────────────────────────────────────
  { brand: 'Output', pattern: /^(Analog Strings|Signal|Exhaust|Movement|Thermal|Portal|Arcade|Substance)/i },

  // ── Oeksound ──────────────────────────────────────────────────────────────
  { brand: 'Oeksound', pattern: /^(Soothe|Bloom|Spiff)/i },

  // ── Tokyo Dawn ────────────────────────────────────────────────────────────
  { brand: 'Tokyo Dawn', pattern: /^(TDR|SlickEQ|Nova|Kotelnikov|Limiter|Feedback|Prism)/i },
];

/**
 * Detect brand and device display name from a device name.
 * Returns { brand: string|null, deviceDisplay: string }
 */
export function detectBrand(deviceName) {
  for (const { brand, pattern, strip } of BRAND_PATTERNS) {
    if (pattern.test(deviceName)) {
      const deviceDisplay = strip
        ? deviceName.replace(strip, '').trim() || deviceName
        : deviceName;
      return { brand, deviceDisplay };
    }
  }
  return { brand: null, deviceDisplay: deviceName };
}

/**
 * Resolve the preset directory for a given device name + optional brand override.
 * Returns { brandDir: string, deviceDir: string, brand: string, deviceDisplay: string }
 */
function resolvePresetDirs(deviceName, brandOverride) {
  const auto = detectBrand(deviceName);
  const brand = brandOverride || auto.brand || 'Other';
  const deviceDisplay = auto.deviceDisplay;
  const brandDir  = join(PRESETS_DIR, slugify(brand));
  const deviceDir = join(brandDir, slugify(deviceDisplay));
  return { brandDir, deviceDir, brand, deviceDisplay };
}

// ─── save ─────────────────────────────────────────────────────────────────────

export async function presetSaveCommand(trackArg, options) {
  const spinner = ora();

  try {
    spinner.start('Connecting to Ableton Live...');
    const ableton = await connect();
    spinner.succeed('Connected');

    // ── Find track (MIDI + audio) ────────────────────────────────────────────
    const rawTracks = await ableton.song.get('tracks');
    const trackMap  = new Map();
    for (const t of rawTracks) {
      const n = await t.get('name').catch(() => null);
      if (n) trackMap.set(n, t);
    }

    const targetTrack = trackMap.get(trackArg);
    if (!targetTrack) {
      const names = [...trackMap.keys()].join(', ');
      throw new Error(`Track "${trackArg}" not found. Available: ${names}`);
    }

    // ── Find device ──────────────────────────────────────────────────────────
    let devices;
    try {
      devices = await targetTrack.get('devices');
    } catch {
      throw new Error(`Track "${trackArg}" has no devices.`);
    }
    if (devices.length === 0) throw new Error(`Track "${trackArg}" has no devices.`);

    let device, deviceName, deviceClass, deviceType;

    if (options.device) {
      const lower = options.device.toLowerCase();
      for (const d of devices) {
        const n = await d.get('name');
        if (n.toLowerCase().includes(lower)) { device = d; deviceName = n; break; }
      }
      if (!device) {
        const devNames = await Promise.all(devices.map(d => d.get('name')));
        throw new Error(`Device "${options.device}" not found on "${trackArg}". Available: ${devNames.join(', ')}`);
      }
    } else if (devices.length === 1) {
      device = devices[0];
      deviceName = await device.get('name');
    } else {
      const devInfos = await Promise.all(devices.map(async d => ({
        d, name: await d.get('name'), type: await d.get('type').catch(() => null),
      })));
      const instrument = devInfos.find(i => i.type === 'instrument');
      const chosen = instrument ?? devInfos[0];
      device = chosen.d; deviceName = chosen.name;
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
      if (shouldSkip(pName, options.allParams)) { skippedCount++; continue; }
      parameters[pName] = pValue;
    }

    const paramCount = Object.keys(parameters).length;
    spinner.succeed(
      `Read ${paramCount} parameter(s) from "${deviceName}"` +
      (skippedCount > 0 ? chalk.dim(` (${skippedCount} system params skipped)`) : '')
    );

    // ── Resolve brand / device folder ────────────────────────────────────────
    const { brandDir, deviceDir, brand, deviceDisplay } = resolvePresetDirs(deviceName, options.brand);

    // ── Build preset object ───────────────────────────────────────────────────
    const presetName = options.name || 'default';
    const preset = {
      name:         presetName,
      device:       deviceName,
      device_class: deviceClass,
      device_type:  deviceType,
      brand,
      source_track: trackArg,
      created_at:   new Date().toISOString(),
      parameters,
    };

    // ── Save ──────────────────────────────────────────────────────────────────
    let outPath;
    if (options.out) {
      outPath = options.out;
    } else {
      await mkdir(deviceDir, { recursive: true });
      outPath = join(deviceDir, `${slugify(presetName)}.json`);
    }

    await writeFile(outPath, JSON.stringify(preset, null, 2), 'utf-8');

    // ── Print ─────────────────────────────────────────────────────────────────
    console.log('');
    console.log(chalk.bold(`  ${brand}  /  ${deviceDisplay}`));
    console.log(chalk.dim(`  type: ${deviceType || 'unknown'}  |  class: ${deviceClass || 'unknown'}`));
    console.log('');

    const entries = Object.entries(parameters);
    for (const [k, v] of entries.slice(0, 20)) {
      console.log(`  ${chalk.dim(k.padEnd(24))}  ${renderBar(v, 20)}  ${String(v.toFixed(4)).padStart(7)}`);
    }
    if (entries.length > 20) console.log(chalk.dim(`  ... and ${entries.length - 20} more`));

    console.log('');
    console.log(chalk.green(`✓ Saved → ${relative(process.cwd(), outPath)}`));
    console.log(chalk.dim(`  Restore: ableton-composer preset load ${relative(process.cwd(), outPath)} --track "${trackArg}"`));

  } catch (err) {
    spinner.fail(err.message);
    process.exit(1);
  } finally {
    await disconnect();
  }
}

// ─── load ─────────────────────────────────────────────────────────────────────

export async function presetLoadCommand(fileArg, options) {
  const spinner = ora();

  try {
    // ── Resolve preset file ──────────────────────────────────────────────────
    const absPath = await resolvePresetPath(fileArg);
    const raw = await readFile(absPath, 'utf-8').catch(() => {
      throw new Error(`Preset file not found: ${absPath}`);
    });
    const preset = JSON.parse(raw);

    console.log('');
    console.log(chalk.bold(`  ${preset.brand || '?'}  /  ${preset.device}`));
    console.log(chalk.dim(`  Preset: ${preset.name}  |  ${Object.keys(preset.parameters).length} params`));
    console.log('');

    if (!options.track) throw new Error('--track <name> is required.');

    spinner.start('Connecting to Ableton Live...');
    const ableton = await connect();
    spinner.succeed('Connected');

    // ── Find track ───────────────────────────────────────────────────────────
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

    // ── Find device ──────────────────────────────────────────────────────────
    let devices;
    try { devices = await targetTrack.get('devices'); } catch {
      throw new Error(`Track "${options.track}" has no devices.`);
    }

    const deviceTarget = options.device || preset.device;
    let device;

    if (deviceTarget) {
      const lower = deviceTarget.toLowerCase();
      for (const d of devices) {
        const n = await d.get('name');
        if (n.toLowerCase().includes(lower)) { device = d; break; }
      }
      if (!device) {
        const devNames = await Promise.all(devices.map(d => d.get('name')));
        throw new Error(`Device "${deviceTarget}" not found on "${options.track}". Available: ${devNames.join(', ')}`);
      }
    } else {
      device = devices[0];
    }

    const liveDeviceName = await device.get('name');

    // ── Apply parameters ─────────────────────────────────────────────────────
    spinner.start(`Applying parameters to "${liveDeviceName}"...`);

    let liveParams;
    try { liveParams = await device.get('parameters'); } catch {
      throw new Error(`Device "${liveDeviceName}" has no automatable parameters.`);
    }

    const liveParamMap = new Map();
    for (const p of liveParams) {
      const pName = await p.get('name');
      if (!liveParamMap.has(pName)) liveParamMap.set(pName, p);
    }

    let restored = 0, skipped = 0;
    const notFound = [];

    for (const [paramName, paramValue] of Object.entries(preset.parameters)) {
      const liveParam = liveParamMap.get(paramName);
      if (!liveParam) { notFound.push(paramName); skipped++; continue; }
      try {
        await liveParam.set('value', paramValue);
        restored++;
      } catch {
        skipped++;
      }
    }

    spinner.succeed(
      `Applied ${restored} parameter(s) to "${liveDeviceName}"` +
      (skipped > 0 ? chalk.dim(` (${skipped} skipped)`) : '')
    );

    if (notFound.length > 0) {
      console.log(chalk.yellow(`\n  ⚠ Parameters not found on device (plugin version may differ):`));
      notFound.slice(0, 10).forEach(n => console.log(chalk.dim(`    ${n}`)));
      if (notFound.length > 10) console.log(chalk.dim(`    ... and ${notFound.length - 10} more`));
    }

    console.log('');
    console.log(chalk.green(`✓ Preset "${preset.name}" applied to "${options.track}" → "${liveDeviceName}"`));

  } catch (err) {
    spinner.fail(err.message);
    process.exit(1);
  } finally {
    await disconnect();
  }
}

// ─── list ─────────────────────────────────────────────────────────────────────

export async function presetListCommand() {
  try {
    const tree = await buildPresetTree(PRESETS_DIR);

    if (tree.length === 0) {
      console.log(chalk.dim('  No presets saved yet. Run `preset save <track>` to create one.'));
      return;
    }

    console.log('');
    let total = 0;

    for (const { brand, devices } of tree) {
      console.log(chalk.bold(`  ${brand}`));

      for (const { device, presets, categories } of devices) {
        console.log(`    ${chalk.cyan(device)}`);

        // Direct presets (no category)
        for (const p of presets) {
          const paramCount = p.data.parameters ? Object.keys(p.data.parameters).length : '?';
          const rel = relative(PRESETS_DIR, p.filepath);
          console.log(
            `      ${chalk.white(p.data.name || p.filename.replace('.json', ''))}` +
            chalk.dim(`  — ${paramCount} params  (${rel})`)
          );
          total++;
        }

        // Subcategory presets
        for (const { name: catName, presets: catPresets } of categories) {
          console.log(`      ${chalk.dim(catName)}  ${chalk.dim(`(${catPresets.length})`)}`);
          for (const p of catPresets) {
            const paramCount = p.data.parameters ? Object.keys(p.data.parameters).length : '?';
            console.log(
              `        ${chalk.white(p.data.name || p.filename.replace('.json', ''))}` +
              chalk.dim(`  — ${paramCount} params`)
            );
            total++;
          }
        }
      }

      console.log('');
    }

    console.log(chalk.dim(`  ${total} preset(s) in ${PRESETS_DIR}`));
    console.log('');

  } catch (err) {
    console.error(chalk.red(`✗ ${err.message}`));
    process.exit(1);
  }
}

// ─── helpers ──────────────────────────────────────────────────────────────────

/**
 * Walk presets/ and return a grouped tree.
 *
 * Supports two structures:
 *   presets/<brand>/<device>/<preset>.json
 *   presets/<brand>/<device>/<category>/<preset>.json
 *
 * Result shape:
 * [{ brand, brandSlug, devices: [{
 *   device, deviceSlug,
 *   presets: [{ filename, filepath, data }],        ← direct presets
 *   categories: [{ name, presets: [...] }]          ← sub-categorised presets
 * }] }]
 */
async function buildPresetTree(root) {
  let brandDirs;
  try { brandDirs = await readdir(root); } catch { return []; }

  const tree = [];

  for (const brandName of brandDirs.sort()) {
    if (brandName.startsWith('.')) continue;
    const brandPath = join(root, brandName);
    if (!(await stat(brandPath).catch(() => null))?.isDirectory()) continue;

    const deviceDirs = await readdir(brandPath).catch(() => []);
    const devices = [];

    for (const deviceName of deviceDirs.sort()) {
      if (deviceName.startsWith('.')) continue;
      const devicePath = join(brandPath, deviceName);
      if (!(await stat(devicePath).catch(() => null))?.isDirectory()) continue;

      const entries = await readdir(devicePath).catch(() => []);
      const directPresets = [];
      const categories = [];

      for (const entry of entries.sort()) {
        if (entry.startsWith('.')) continue;
        const entryPath = join(devicePath, entry);
        const entryStat = await stat(entryPath).catch(() => null);

        if (entryStat?.isFile() && entry.endsWith('.json')) {
          // Direct preset at device level
          let data = {};
          try { data = JSON.parse(await readFile(entryPath, 'utf-8')); } catch {}
          directPresets.push({ filename: entry, filepath: entryPath, data });

        } else if (entryStat?.isDirectory()) {
          // Subcategory folder
          const catFiles = await readdir(entryPath).catch(() => []);
          const catPresets = [];
          for (const f of catFiles.filter(f => f.endsWith('.json')).sort()) {
            const fp = join(entryPath, f);
            let data = {};
            try { data = JSON.parse(await readFile(fp, 'utf-8')); } catch {}
            catPresets.push({ filename: f, filepath: fp, data });
          }
          if (catPresets.length > 0) categories.push({ name: entry, presets: catPresets });
        }
      }

      if (directPresets.length > 0 || categories.length > 0) {
        // Use display name from first available preset JSON
        const firstPreset = directPresets[0] ?? categories[0]?.presets[0];
        const auto = detectBrand(firstPreset?.data?.device || deviceName);
        devices.push({
          device:     auto.deviceDisplay || deviceName,
          deviceSlug: deviceName,
          presets:    directPresets,
          categories,
        });
      }
    }

    if (devices.length > 0) {
      const firstPreset = devices[0].presets[0] ?? devices[0].categories[0]?.presets[0];
      const displayBrand = firstPreset?.data?.brand || brandName;
      tree.push({ brand: displayBrand, brandSlug: brandName, devices });
    }
  }

  return tree;
}

/**
 * Resolve a preset path from:
 * - absolute path
 * - path relative to CWD
 * - path relative to PRESETS_DIR
 * - partial name search within PRESETS_DIR tree
 */
async function resolvePresetPath(arg) {
  const candidates = [
    arg,
    join(process.cwd(), arg),
    join(PRESETS_DIR, arg),
    arg.endsWith('.json') ? null : join(PRESETS_DIR, `${arg}.json`),
  ].filter(Boolean);

  for (const p of candidates) {
    try {
      await stat(p);
      return p;
    } catch {}
  }

  // Walk the tree for a partial name match (direct presets + categories)
  const tree = await buildPresetTree(PRESETS_DIR);
  const lower = arg.toLowerCase();
  for (const { devices } of tree) {
    for (const { presets, categories } of devices) {
      const allPresets = [
        ...presets,
        ...categories.flatMap(c => c.presets),
      ];
      const match = allPresets.find(
        p => p.filename.toLowerCase().includes(lower) ||
             (p.data.name || '').toLowerCase().includes(lower)
      );
      if (match) return match.filepath;
    }
  }

  throw new Error(`Preset not found: "${arg}". Run \`preset list\` to see available presets.`);
}

function slugify(str) {
  return str.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 50);
}

function renderBar(value, width = 16) {
  const filled = Math.round(Math.max(0, Math.min(1, value)) * width);
  return chalk.cyan('█'.repeat(filled)) + chalk.dim('░'.repeat(width - filled));
}

// ─── analyze ──────────────────────────────────────────────────────────────────

const PROFILES_DIR = join(__dirname, '../../profiles/presets');

// Parameters to skip when building the generation prompt (system / MIDI internals)
const SKIP_IN_PROMPT = /^(MPE_|VST3_Ctrl|Reserved)/;

/**
 * Compute per-parameter statistics across a collection of preset files.
 * Returns { paramName: { mean, std, min, max, variance, values[] } }
 */
function computeStats(presets) {
  const paramNames = [...new Set(presets.flatMap(p => Object.keys(p.parameters || {})))];
  const stats = {};

  for (const name of paramNames) {
    const vals = presets.map(p => p.parameters?.[name]).filter(v => typeof v === 'number');
    if (vals.length === 0) continue;

    const mean = vals.reduce((a, b) => a + b, 0) / vals.length;
    const std  = Math.sqrt(vals.reduce((s, v) => s + (v - mean) ** 2, 0) / vals.length);
    const min  = Math.min(...vals);
    const max  = Math.max(...vals);

    let variance = 'high';
    if (std < 0.02)  variance = 'fixed';
    else if (std < 0.1)  variance = 'low';
    else if (std < 0.25) variance = 'medium';

    stats[name] = { mean: +mean.toFixed(4), std: +std.toFixed(4), min: +min.toFixed(4), max: +max.toFixed(4), variance };
  }

  return stats;
}

export async function presetAnalyzeCommand(dirArg, options) {
  try {
    // ── Resolve directory ─────────────────────────────────────────────────────
    const absDir = dirArg.startsWith('/')
      ? dirArg
      : join(process.cwd(), dirArg);

    let info;
    try { info = await stat(absDir); } catch {
      throw new Error(`Directory not found: ${absDir}`);
    }
    if (!info.isDirectory()) throw new Error(`Not a directory: ${absDir}`);

    const files = (await readdir(absDir)).filter(f => f.endsWith('.json'));
    if (files.length === 0) throw new Error(`No JSON preset files found in ${absDir}`);

    // ── Load all presets ──────────────────────────────────────────────────────
    const presets = await Promise.all(
      files.map(async f => {
        const raw = await readFile(join(absDir, f), 'utf-8');
        return JSON.parse(raw);
      })
    );

    // Validate: all presets should be for the same device
    const devices = [...new Set(presets.map(p => p.device).filter(Boolean))];
    const device  = devices[0] || 'Unknown';
    const brand   = presets.find(p => p.brand)?.brand || detectBrand(device).brand || 'Unknown';

    if (devices.length > 1) {
      console.log(chalk.yellow(`  ⚠ Mixed devices: ${devices.join(', ')}. Analyzing as "${device}".`));
    }

    // ── Compute stats ─────────────────────────────────────────────────────────
    const paramStats = computeStats(presets);
    const paramCount = Object.keys(paramStats).length;
    const category   = options.name || basename(absDir);

    const profile = {
      _meta: {
        type:         'preset-profile',
        device,
        brand,
        category,
        source_dir:   relative(process.cwd(), absDir),
        preset_count: presets.length,
        param_count:  paramCount,
        created_at:   new Date().toISOString(),
      },
      parameters: paramStats,
    };

    // ── Save ──────────────────────────────────────────────────────────────────
    let outPath;
    if (options.out) {
      outPath = options.out;
    } else {
      const brandSlug  = slugify(brand);
      const deviceSlug = slugify(detectBrand(device).deviceDisplay || device);
      const catSlug    = slugify(category);
      const profileDir = join(PROFILES_DIR, brandSlug, deviceSlug);
      await mkdir(profileDir, { recursive: true });
      outPath = join(profileDir, `${catSlug}.json`);
    }

    await writeFile(outPath, JSON.stringify(profile, null, 2), 'utf-8');

    // ── Summary ───────────────────────────────────────────────────────────────
    const byVariance = Object.entries(paramStats).reduce((acc, [, s]) => {
      acc[s.variance] = (acc[s.variance] || 0) + 1;
      return acc;
    }, {});

    console.log('');
    console.log(chalk.bold(`  ${brand}  /  ${device}  —  ${category}`));
    console.log(chalk.dim(`  ${presets.length} presets  |  ${paramCount} params`));
    console.log('');
    console.log(chalk.dim(`  fixed: ${byVariance.fixed || 0}  low: ${byVariance.low || 0}  medium: ${byVariance.medium || 0}  high: ${byVariance.high || 0}`));
    console.log('');

    // Show top variable params
    const topVar = Object.entries(paramStats)
      .filter(([n, s]) => s.variance !== 'fixed' && !SKIP_IN_PROMPT.test(n))
      .sort((a, b) => b[1].std - a[1].std)
      .slice(0, 12);

    console.log(chalk.dim('  Most variable parameters:'));
    for (const [name, s] of topVar) {
      const bar = renderBar(s.mean, 14);
      console.log(`    ${chalk.dim(name.padEnd(28))} ${bar}  ±${s.std.toFixed(2)}`);
    }

    console.log('');
    console.log(chalk.green(`✓ Profile saved → ${relative(process.cwd(), outPath)}`));
    console.log(chalk.dim(`  Generate: ableton-composer preset generate "${relative(process.cwd(), outPath)}" "your style"`));

  } catch (err) {
    console.error(chalk.red(`✗ ${err.message}`));
    process.exit(1);
  }
}

// ─── generate (from profile) ──────────────────────────────────────────────────

export async function presetGenerateCommand(profileArg, stylePrompt, options) {
  const spinner = ora();

  try {
    // ── Load profile ──────────────────────────────────────────────────────────
    const absProfile = profileArg.startsWith('/')
      ? profileArg
      : join(process.cwd(), profileArg);

    const profileRaw = await readFile(absProfile, 'utf-8').catch(() => {
      throw new Error(`Profile not found: ${absProfile}. Run \`preset analyze <dir>\` first.`);
    });
    const profile = JSON.parse(profileRaw);
    const { _meta, parameters: paramStats } = profile;

    const count         = Math.max(1, parseInt(options.count, 10) || 1);
    const provider      = normalizeProvider(options.provider || 'api');
    const providerLabel = getProviderLabel(provider, options.model);

    console.log('');
    console.log(chalk.bold(`  ${_meta.brand}  /  ${_meta.device}  —  ${_meta.category}`));
    console.log(chalk.dim(`  Profile: ${_meta.preset_count} reference presets  |  style: "${stylePrompt || 'default'}"`));
    console.log('');

    // ── Split params: fixed (auto) vs variable (model-generated) ─────────────
    const fixedParams    = {};  // param → value (always the mean)
    const variableParams = {};  // param → { mean, min, max, variance }

    for (const [name, s] of Object.entries(paramStats)) {
      if (s.variance === 'fixed' || SKIP_IN_PROMPT.test(name) || shouldSkip(name, false)) {
        fixedParams[name] = s.mean;
      } else {
        variableParams[name] = s;
      }
    }

    // ── Build prompt ──────────────────────────────────────────────────────────
    const systemPrompt = await readFile(
      join(__dirname, '../../prompts/preset-generate.md'), 'utf-8'
    );

    const paramTable = Object.entries(variableParams)
      .sort((a, b) => b[1].std - a[1].std)
      .map(([name, s]) => {
        const vLabel = s.variance.padEnd(6);
        return `  ${name.padEnd(32)} mean=${s.mean.toFixed(3)}  min=${s.min.toFixed(3)}  max=${s.max.toFixed(3)}  variance=${vLabel}`;
      })
      .join('\n');

    const allParamNames = Object.keys(paramStats)
      .filter(n => !SKIP_IN_PROMPT.test(n) && !shouldSkip(n, false));

    const userMessage = [
      `## Device`,
      `${_meta.device} (${_meta.brand}) — ${_meta.category} preset`,
      '',
      `## Reference collection`,
      `${_meta.preset_count} presets analyzed from: ${_meta.source_dir}`,
      '',
      `## Variable parameter profile`,
      `(${Object.keys(variableParams).length} parameters — these are the ones you should tune for the sound character)`,
      '',
      paramTable,
      '',
      `## Fixed parameters (set automatically — do NOT include these in your output)`,
      Object.entries(fixedParams)
        .filter(([n]) => !SKIP_IN_PROMPT.test(n))
        .slice(0, 20)
        .map(([n, v]) => `  ${n}: ${v}`)
        .join('\n'),
      '',
      `## Style request`,
      stylePrompt || `Create a ${_meta.category} preset in the style of the reference collection.`,
      '',
      `## Parameters to generate`,
      `Output values for ONLY these ${Object.keys(variableParams).length} variable parameters:`,
      Object.keys(variableParams).map(n => `  - ${n}`).join('\n'),
    ].join('\n');

    // ── Call model ────────────────────────────────────────────────────────────
    const savedPaths = [];

    for (let i = 1; i <= count; i++) {
      const label = count > 1 ? ` [${i}/${count}]` : '';
      spinner.start(`Generating preset${label} with ${providerLabel}...`);

      // ── Call provider ──────────────────────────────────────────────────────
      let generated;
      try {
        generated = await generatePresetObject({
          systemPrompt,
          userMessage,
          model: options.model,
          provider,
        });
      } catch (e) {
        spinner.fail(`Failed to generate preset: ${e.message}`);
        continue;
      }

      // ── Merge fixed + generated parameters ─────────────────────────────────
      const parameters = {
        ...fixedParams,
        ...generated.parameters,
      };

      const presetName = options.name
        ? (count > 1 ? `${options.name} ${i}` : options.name)
        : (generated.name || `generated-${_meta.category}-${i}`);

      const preset = {
        name:         presetName,
        device:       _meta.device,
        device_class: _meta.device,
        device_type:  'instrument',
        brand:        _meta.brand,
        category:     _meta.category,
        generated:    true,
        style_prompt: stylePrompt || null,
        source_profile: relative(process.cwd(), absProfile),
        created_at:   new Date().toISOString(),
        parameters,
      };

      // ── Save ────────────────────────────────────────────────────────────────
      let outPath;
      if (options.out) {
        outPath = count > 1
          ? options.out.replace(/\.json$/, `${i}.json`)
          : options.out;
      } else {
        const brandSlug  = slugify(_meta.brand);
        const deviceSlug = slugify(detectBrand(_meta.device).deviceDisplay || _meta.device);
        const catSlug    = slugify(_meta.category);
        const outDir     = join(PRESETS_DIR, brandSlug, deviceSlug, catSlug);
        await mkdir(outDir, { recursive: true });
        outPath = join(outDir, `${slugify(presetName)}.json`);
      }

      await writeFile(outPath, JSON.stringify(preset, null, 2), 'utf-8');
      savedPaths.push({ outPath, preset });

      const varCount = Object.keys(generated.parameters || {}).length;
      spinner.succeed(`Generated "${presetName}"${label}  (${varCount} variable params set)`);
    }

    // ── Print results ─────────────────────────────────────────────────────────
    console.log('');
    for (const { outPath, preset } of savedPaths) {
      console.log(chalk.green(`✓ ${preset.name}`));
      console.log(chalk.dim(`  ${relative(process.cwd(), outPath)}`));

      // Show top params that differ most from the profile mean
      const interesting = Object.entries(preset.parameters)
        .filter(([n]) => variableParams[n] && !SKIP_IN_PROMPT.test(n))
        .map(([n, v]) => ({ n, v, diff: Math.abs(v - variableParams[n].mean) }))
        .sort((a, b) => b.diff - a.diff)
        .slice(0, 8);

      for (const { n, v } of interesting) {
        const s = variableParams[n];
        console.log(
          `  ${chalk.dim(n.padEnd(28))} ${renderBar(v, 14)}` +
          chalk.dim(`  ${v.toFixed(3)}  (mean ${s.mean.toFixed(3)})`)
        );
      }

      console.log('');
      console.log(chalk.dim(`  Load: ableton-composer preset load ${relative(process.cwd(), outPath)} --track "Your Track"`));
    }

  } catch (err) {
    spinner.fail(err.message);
    process.exit(1);
  }
}
