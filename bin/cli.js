#!/usr/bin/env node

import { config } from 'dotenv';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import { Command } from 'commander';

const __dirname = dirname(fileURLToPath(import.meta.url));
config({ path: join(__dirname, '../.env') });

import { generateCommand } from '../src/commands/generate.js';
import { pushCommand }     from '../src/commands/push.js';
import { pullCommand }     from '../src/commands/pull.js';
import { arrangeCommand }  from '../src/commands/arrange.js';
import { splitCommand }    from '../src/commands/split.js';
import { compileCommand }  from '../src/commands/compile.js';
import { clearCommand }    from '../src/commands/clear.js';
import { listCommand }     from '../src/commands/list.js';
import { infoCommand }     from '../src/commands/info.js';
import { analyzeCommand }  from '../src/commands/analyze.js';
import { compareCommand }  from '../src/commands/compare.js';
import { importMidiCommand } from '../src/commands/import-midi.js';
import { expandCommand }    from '../src/commands/expand.js';
import { snapshotCommand }  from '../src/commands/snapshot.js';
import { importXmlCommand } from '../src/commands/import-xml.js';
import { exportXmlCommand } from '../src/commands/export-xml.js';
import { stemScanCommand, stemSetupCommand } from '../src/commands/stems.js';
import { presetSaveCommand, presetLoadCommand, presetListCommand, presetAnalyzeCommand, presetGenerateCommand } from '../src/commands/preset.js';

const program = new Command();

program
  .name('ableton-composer')
  .description('Generate and push MIDI content into Ableton Live using AI models')
  .version('0.1.0');

// ── generate ─────────────────────────────────────────────────────────────────
program
  .command('generate <prompt>')
  .alias('gen')
  .description('Generate a song JSON from a natural language prompt')
  .option('-t, --tracks <names>',  'Comma-separated track names (e.g. "Bass,Drums,Chords,Lead")')
  .option('-L, --live-sync',       'Auto-detect track names from the open Ableton set')
  .option('-w, --weather',         'Fetch weather data and include it in the prompt context')
  .option('-m, --model <model>',   'Model to use (overrides provider-specific env defaults)')
  .option('-n, --name <name>',     'Name hint for the saved filename')
  .option('-o, --output <path>',   'Save to a specific path instead of sets/')
  .option('-s, --style <path>',    'Style profile JSON to guide generation (from "analyze" command)')
  .option('-c, --continue <file>', 'Existing set to continue — new sections are appended')
  .option('-V, --variations <n>',  'Generate N variations and save each one', '1')
  .option('-S, --sections <n>',    'Total number of sections to generate')
  .option('--chunk-size <n>',      'Generate in chunks of N sections per API call (use with --sections)')
  .option('--provider <name>',     'AI provider: "api"/"anthropic", "openai", "codex", or "cli"/"claude-cli"')
  .option('--no-save',             'Print JSON to stdout without saving to disk')
  .action(generateCommand);

// ── push ──────────────────────────────────────────────────────────────────────
program
  .command('push [file]')
  .description('Push a song JSON into the current Ableton Live set')
  .option('--overwrite',           'Replace existing clips in target slots')
  .option('--dry-run',             'Show what would be pushed without writing to Live')
  .option('--sections <names>',    'Only push specific sections (comma-separated, e.g. "intro,verse")')
  .option('--setup',               'Create missing MIDI tracks and scenes before pushing')
  .option('--humanize [profile]',  'Apply humanization: tight, loose, swing, swing-heavy, vinyl, idm (default: loose). Use "list" to see all profiles.')
  .action(pushCommand);

// ── arrange ───────────────────────────────────────────────────────────────────
program
  .command('arrange <file>')
  .description('Place session view clips into the arrangement timeline in sequence')
  .option('--start <bars>',     'Start position in bars (default: 0)', '0')
  .option('--gap <bars>',       'Gap in bars between sections (default: 0)', '0')
  .option('--sections <names>', 'Only arrange specific sections (comma-separated)')
  .option('--dry-run',          'Show what would be placed without writing to Live')
  .action(arrangeCommand);

// ── split ─────────────────────────────────────────────────────────────────────
program
  .command('split <file>')
  .description('Convert a flat song JSON into a set directory (one file per section)')
  .option('--out <dir>', 'Output directory (default: same name as file without .json)')
  .action(splitCommand);

// ── compile ───────────────────────────────────────────────────────────────────
program
  .command('compile <dir>')
  .description('Merge a set directory into a single flat song JSON')
  .option('--out <file>', 'Output file path (default: sets/<dirname>_<timestamp>.json)')
  .action(compileCommand);

// ── pull ──────────────────────────────────────────────────────────────────────
program
  .command('pull')
  .description('Read clips from the current Ableton Live set and save to JSON')
  .option('-s, --scene <index>',    'Pull only this scene row (0-indexed). Omit to pull all scenes with clips.')
  .option('-n, --name <name>',      'Section name to use in the JSON (default: "scene_N")')
  .option('--out <path>',           'Write to a set directory (e.g. sets/my-song/) or flat file')
  .option('--add-to <file>',        'Merge into an existing flat JSON instead of creating a new file')
  .option('--replace',              'When used with --out or --add-to, replace a section with the same name')
  .option('--from-arrangement',     'Pull from arrangement view, split by cue points (locators)')
  .option('--split-every <bars>',   'Fallback: split every N bars when no cue points exist (default: 8)')
  .action(pullCommand);

// ── clear ─────────────────────────────────────────────────────────────────────
program
  .command('clear')
  .description('Remove clips from the current Ableton Live set')
  .option('-a, --all',              'Clear both session and arrangement view')
  .option('--arrangement',          'Clear arrangement view (empties notes; containers remain)')
  .option('-t, --tracks <names>',   'Only clear specific tracks (comma-separated)')
  .option('--scenes <indices>',     'Only clear specific scene rows, e.g. "0,1,2" (session only)')
  .option('--dry-run',              'Show what would be cleared without making changes')
  .action(clearCommand);

// ── analyze ───────────────────────────────────────────────────────────────────
program
  .command('analyze <targets...>')
  .description('Extract a style profile from one or more sets or a collection directory')
  .option('--out <path>',   'Save profile to a specific path instead of the hierarchical profiles/ tree')
  .option('--scope <name>', 'Profile scope: song, album, artist, or collection')
  .option('--artist <name>','Artist name for hierarchical profile output')
  .option('--album <name>', 'Album name for hierarchical profile output')
  .option('--song <name>',  'Song name for hierarchical profile output')
  .option('--print',        'Print JSON to stdout instead of saving')
  .action(analyzeCommand);

// ── compare ───────────────────────────────────────────────────────────────────
program
  .command('compare <source> <generated>')
  .description('Compare two sets or profiles to measure style fidelity')
  .option('--out <path>', 'Save the comparison report as JSON')
  .action(compareCommand);

// ── expand ────────────────────────────────────────────────────────────────────
program
  .command('expand <file>')
  .description('Add new accompaniment tracks to an existing set using an AI provider')
  .requiredOption('--add <tracks>',       'Comma-separated track names to add, e.g. "Strings,Cello,Bass"')
  .option('-s, --style <hint>',           'Style description to guide the model, e.g. "orchestral ambient"')
  .option('--sections <names>',           'Only expand specific sections (comma-separated)')
  .option('--overwrite',                  'Replace tracks that already exist in a section')
  .option('--dry-run',                    'Show what would be added without calling the model')
  .option('-o, --out <path>',             'Save to a new file instead of updating the source')
  .option('--provider <name>',            'AI provider: "api"/"anthropic", "openai", "codex", or "cli"/"claude-cli"')
  .option('-m, --model <model>',          'Model override')
  .action(expandCommand);

// ── import-xml ────────────────────────────────────────────────────────────────
program
  .command('import-xml <file>')
  .description('Convert a MusicXML (.xml, .musicxml, .mxl) file to an AbletonSong JSON (no Ableton required)')
  .option('-n, --name <name>',        'Name hint for the output file and section(s)')
  .option('-o, --out <path>',         'Save to a specific path (directory or .json file)')
  .option('--split-every <measures>', 'Split into sections every N measures (default: one section)')
  .option('-t, --tracks <names>',     'Rename parts: positional "Piano,Violin" or mapped "Part 1:Lead"')
  .option('--chord-track [name]',     'Generate a MIDI chord track from MusicXML harmony symbols (default name: Chords)')
  .action(importXmlCommand);

// ── export-xml ───────────────────────────────────────────────────────────────
program
  .command('export-xml <file>')
  .description('Export an AbletonSong set as MusicXML (.musicxml) or compressed MXL (.mxl)')
  .option('-o, --out <path>', 'Save to a specific output file (default: exports/<name>.musicxml)')
  .action(exportXmlCommand);

// ── import-midi ───────────────────────────────────────────────────────────────
program
  .command('import-midi <file>')
  .description('Convert a .mid file to an AbletonSong JSON (no Ableton required)')
  .option('-n, --name <name>',           'Name hint for the output file and section(s)')
  .option('-o, --out <path>',            'Save to a specific path (directory or .json file)')
  .option('--split-every <bars>',        'Split into sections every N bars (default: one section)')
  .option('-t, --tracks <names>',        'Rename tracks: positional "Bass,Drums" or mapped "Piano:Pad,Bass:Bass"')
  .action(importMidiCommand);

// ── snapshot ──────────────────────────────────────────────────────────────────
program
  .command('snapshot')
  .description('Save or restore Ableton Live device parameter snapshots')
  .option('-t, --tracks <names>',  'Only snapshot specific tracks (comma-separated)')
  .option('-o, --out <path>',      'Save snapshot to a specific path')
  .option('--restore <file>',      'Restore device parameters from a snapshot file')
  .action(snapshotCommand);

// ── stems ────────────────────────────────────────────────────────────────────
const stemsCmd = program
  .command('stems')
  .description('Scan and prepare audio stem manifests');

stemsCmd
  .command('scan <dir>')
  .description('Scan a folder of audio stems and write a manifest JSON')
  .option('-n, --name <name>', 'Manifest/song name override')
  .option('-o, --out <path>',  'Output file or directory (default: stems/manifests/<name>.stems.json)')
  .action(stemScanCommand);

stemsCmd
  .command('setup <manifest>')
  .description('Create or align Ableton audio tracks from a stem manifest')
  .option('--dry-run', 'Show what would be set up without writing to Ableton')
  .action(stemSetupCommand);

// ── preset ────────────────────────────────────────────────────────────────────
const presetCmd = program
  .command('preset')
  .description('Save and restore single-device parameter presets (native and VST/AU)');

presetCmd
  .command('save <track>')
  .description('Save a device preset from a track')
  .option('-d, --device <name>',  'Device name (required if track has multiple devices)')
  .option('-n, --name <name>',    'Preset name (defaults to device name)')
  .option('-o, --out <path>',     'Save to a specific path instead of presets/')
  .option('--all-params',         'Include system params (Device On, Reserved…)')
  .action(presetSaveCommand);

presetCmd
  .command('load <file>')
  .description('Apply a preset to a device on a track')
  .requiredOption('-t, --track <name>',   'Target track name')
  .option('-d, --device <name>',          'Device name override (defaults to preset device name)')
  .action(presetLoadCommand);

presetCmd
  .command('list')
  .description('List saved presets')
  .action(presetListCommand);

presetCmd
  .command('analyze <dir>')
  .description('Analyze a preset collection and extract a parameter profile')
  .option('-n, --name <name>',    'Profile name (defaults to directory name)')
  .option('-o, --out <path>',     'Save profile to a specific path')
  .action(presetAnalyzeCommand);

presetCmd
  .command('generate <profile> [style]')
  .description('Generate new preset(s) from a profile using an AI provider')
  .option('-n, --name <name>',       'Preset name')
  .option('-o, --out <path>',        'Output path')
  .option('-c, --count <n>',         'Number of variants to generate', '1')
  .option('--provider <name>',       'AI provider: "api"/"anthropic", "openai", "codex", or "cli"/"claude-cli"')
  .option('-m, --model <model>',     'Model override')
  .action(presetGenerateCommand);

// ── list ──────────────────────────────────────────────────────────────────────
program
  .command('list')
  .alias('ls')
  .description('List all saved song sets')
  .action(listCommand);

// ── info ──────────────────────────────────────────────────────────────────────
program
  .command('info')
  .description('Show tracks and devices in the current Ableton Live set')
  .option('-d, --devices',         'Show device list per track')
  .option('-p, --params',          'Show device parameters (requires --devices)')
  .action(infoCommand);

program.parseAsync(process.argv).catch(err => {
  console.error(err.message);
  process.exit(1);
});
