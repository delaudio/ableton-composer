/**
 * preset command — save and restore single-device parameter presets.
 *
 * Presets are stored as:
 *   presets/<brand>/<device>/<name>.json
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
  { brand: 'Arturia', pattern: /^(Arturia|Mini V|SEM V|Jup-8 V|Matrix-12 V|Jupiter-8V|CS-80 V|Prophet V|Prophet 5|ARP 2600|Moog Modular|Buchla Easel|CMI V|DX7 V|Analog Lab|Pigments|OB-Xa V|MS-20 V|B-3 V|Stage-73 V|Farfisa V|Vocoder V|Mini V|Solina V)/i },

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
      for (const { device, presets } of devices) {
        console.log(`    ${chalk.cyan(device)}`);
        for (const p of presets) {
          const paramCount = p.data.parameters ? Object.keys(p.data.parameters).length : '?';
          const rel = relative(PRESETS_DIR, p.filepath);
          console.log(
            `      ${chalk.white(p.data.name || p.filename.replace('.json', ''))}` +
            chalk.dim(`  — ${paramCount} params  (${rel})`)
          );
          total++;
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
 * Walk presets/ and return a grouped tree:
 * [{ brand, devices: [{ device, presets: [{ filename, filepath, data }] }] }]
 */
async function buildPresetTree(root) {
  let brandDirs;
  try { brandDirs = await readdir(root); } catch { return []; }

  const tree = [];

  for (const brandName of brandDirs.sort()) {
    if (brandName.startsWith('.')) continue;
    const brandPath = join(root, brandName);
    const brandStat = await stat(brandPath).catch(() => null);
    if (!brandStat?.isDirectory()) continue;

    const deviceDirs = await readdir(brandPath).catch(() => []);
    const devices = [];

    for (const deviceName of deviceDirs.sort()) {
      if (deviceName.startsWith('.')) continue;
      const devicePath = join(brandPath, deviceName);
      const deviceStat = await stat(devicePath).catch(() => null);
      if (!deviceStat?.isDirectory()) continue;

      const files = await readdir(devicePath).catch(() => []);
      const presets = [];

      for (const f of files.filter(f => f.endsWith('.json')).sort()) {
        const filepath = join(devicePath, f);
        let data = {};
        try { data = JSON.parse(await readFile(filepath, 'utf-8')); } catch {}
        presets.push({ filename: f, filepath, data });
      }

      if (presets.length > 0) {
        // Use the device display name from the first preset JSON
        const auto = detectBrand(presets[0].data.device || deviceName);
        const displayDevice = auto.deviceDisplay || deviceName;
        devices.push({ device: displayDevice, deviceSlug: deviceName, presets });
      }
    }

    if (devices.length > 0) {
      // Use the brand from the first preset JSON as the display name
      const displayBrand = devices[0]?.presets[0]?.data?.brand || brandName;
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

  // Walk the tree for a partial name match
  const tree = await buildPresetTree(PRESETS_DIR);
  const lower = arg.toLowerCase();
  for (const { devices } of tree) {
    for (const { presets } of devices) {
      const match = presets.find(
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
