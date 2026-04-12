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
import { validateRoundtripCommand } from '../src/commands/validate-roundtrip.js';
import { critiqueCommand } from '../src/commands/critique.js';
import { reviseCommand } from '../src/commands/revise.js';
import { evaluationPackCommand } from '../src/commands/evaluation-pack.js';
import { importMidiCommand } from '../src/commands/import-midi.js';
import { exportMidiCommand } from '../src/commands/export-midi.js';
import { expandCommand }    from '../src/commands/expand.js';
import { snapshotCommand }  from '../src/commands/snapshot.js';
import { separateCommand } from '../src/commands/separate.js';
import { transcribeCommand } from '../src/commands/transcribe.js';
import { importXmlCommand } from '../src/commands/import-xml.js';
import { exportXmlCommand } from '../src/commands/export-xml.js';
import { reportCommand } from '../src/commands/report.js';
import { renderPlanCommand } from '../src/commands/render-plan.js';
import { renderAudioCommand, convertAudioCommand } from '../src/commands/render-audio.js';
import { renderStemsCommand } from '../src/commands/render-stems.js';
import { researchGenreCommand } from '../src/commands/research.js';
import { pluginEnrichCommand, pluginListCommand, pluginMatchCommand, pluginScanCommand } from '../src/commands/plugins.js';
import { paletteGenerateCommand } from '../src/commands/palette.js';
import { presetPlanCommand } from '../src/commands/preset-plan.js';
import { stemScanCommand, stemSetupCommand, stemReaperCommand } from '../src/commands/stems.js';
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
  .option('-d, --dossier <path>',  'Research dossier JSON to add historical/production constraints')
  .option('-p, --palette <path>',  'Operational palette JSON with track-level sound/role guidance')
  .option('--historical-strictness <mode>', 'Historical guardrail mode: strict, loose, hybrid, or modern', 'loose')
  .option('-c, --continue <file>', 'Existing set to continue — new sections are appended')
  .option('-V, --variations <n>',  'Generate N variations and save each one', '1')
  .option('-S, --sections <n>',    'Total number of sections to generate')
  .option('--chunk-size <n>',      'Generate in chunks of N sections per API call (use with --sections)')
  .option('--provider <name>',     'AI provider: "api"/"anthropic", "openai", "codex", or "cli"/"claude-cli"')
  .option('--evaluate',            'Run an AI critique after saving the generated set')
  .option('--rubric <name>',       'Critique rubric for --evaluate or critique command')
  .option('--eval-out <path>',     'Save auto-evaluation report to a specific JSON path')
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

program
  .command('validate-roundtrip <file>')
  .description('Export and re-import a set to measure what survives across MIDI/MusicXML round-trips')
  .requiredOption('--via <format>', 'Round-trip format: midi, musicxml, or mxl')
  .option('--out <path>', 'Save the validation report as JSON')
  .action(validateRoundtripCommand);

program
  .command('critique <file>')
  .description('Review a set with an AI model and return structured musical feedback')
  .option('--rubric <name>', 'Critique rubric: general, string-quartet, synth-pop, chicago-house')
  .option('--provider <name>', 'AI provider: "api"/"anthropic", "openai", "codex", or "cli"/"claude-cli"')
  .option('-m, --model <model>', 'Model override')
  .option('--out <path>', 'Save the critique report as JSON')
  .action(critiqueCommand);

program
  .command('revise <file>')
  .description('Revise an existing set using a saved or inline-generated critique')
  .option('--critique <path>', 'Optional critique JSON report to use as revision guidance')
  .option('--rubric <name>', 'Critique rubric when generating critique inline')
  .option('--provider <name>', 'AI provider: "api"/"anthropic", "openai", "codex", or "cli"/"claude-cli"')
  .option('-m, --model <model>', 'Model override for the revision pass')
  .option('--out <path>', 'Save to a specific path instead of sets/')
  .action(reviseCommand);

program
  .command('evaluation-pack <targets...>')
  .alias('eval-pack')
  .description('Build a thesis/user-study evaluation bundle from one or more sets')
  .option('--reference <path>', 'Reference set/profile/bundle for compare scoring')
  .option('--critique', 'Run AI critique for each target')
  .option('--rubric <name>', 'Critique rubric when --critique is enabled')
  .option('--provider <name>', 'AI provider for --critique')
  .option('-m, --model <model>', 'Model override for --critique')
  .option('--roundtrip <formats>', 'Comma-separated round-trip checks: midi,musicxml,mxl')
  .option('--out <dir>', 'Output directory (default: reports/<name>-evaluation-pack)')
  .action(evaluationPackCommand);

program
  .command('report <file>')
  .description('Generate a static Markdown song report for docs or thesis/demo use')
  .option('--out <path>', 'Output Markdown path (default: reports/<name>.md)')
  .action(reportCommand);

program
  .command('render-plan <file>')
  .description('Generate an engine-agnostic audio render-chain JSON plan from an AbletonSong')
  .option('--stems <manifest>', 'Optional stem manifest to attach external audio sources to matching tracks')
  .option('--sample-rate <n>', 'Render sample rate (default: 44100)', '44100')
  .option('--bit-depth <n>', 'Render bit depth (default: 24)', '24')
  .option('--channels <n>', 'Render channel count (default: 2)', '2')
  .option('--out <path>', 'Output render-chain JSON path (default: renders/plans/<name>.render-chain.json)')
  .action(renderPlanCommand);

program
  .command('render-audio <plan>')
  .description('Use ffmpeg as a post-processing/mixdown fallback for an existing render-chain JSON')
  .option('--ffmpeg-bin <path>', 'Explicit ffmpeg binary path')
  .option('--normalize', 'Apply loudness normalization in the ffmpeg filter graph')
  .option('--dry-run', 'Print the ffmpeg command without executing it')
  .option('--out <path>', 'Output mixdown path (default: uses plan.outputs.mixdown_path)')
  .action(renderAudioCommand);

program
  .command('convert-audio <file>')
  .description('Convert an audio file with ffmpeg as a lightweight fallback utility')
  .option('--ffmpeg-bin <path>', 'Explicit ffmpeg binary path')
  .option('--codec <name>', 'Explicit audio codec, e.g. libmp3lame or flac')
  .option('--sample-rate <n>', 'Target sample rate')
  .option('--channels <n>', 'Target channel count')
  .option('--normalize', 'Apply loudness normalization')
  .option('--dry-run', 'Print the ffmpeg command without executing it')
  .option('--out <path>', 'Output file path')
  .action(convertAudioCommand);

program
  .command('render-stems <plan>')
  .description('Use an optional Pedalboard Python worker to render/process existing audio stems from a render-chain JSON')
  .option('--engine <name>', 'Render engine (currently: pedalboard)', 'pedalboard')
  .option('--python-bin <path>', 'Explicit Python binary path')
  .option('--worker <path>', 'Explicit Pedalboard worker script path')
  .option('--dry-run', 'Print the worker command without executing it')
  .option('--out <dir>', 'Optional output directory for rendered stems')
  .action(renderStemsCommand);

// ── research ─────────────────────────────────────────────────────────────────
const researchCmd = program
  .command('research')
  .description('Create structured research dossiers for generation guidance');

researchCmd
  .command('genre <topic>')
  .description('Seed a genre/period research dossier as JSON')
  .option('-o, --out <path>', 'Output file path (default: research/<topic>.json)')
  .option('--print', 'Print JSON to stdout instead of saving')
  .action(researchGenreCommand);

// ── plugins ─────────────────────────────────────────────────────────────────
const pluginsCmd = program
  .command('plugins')
  .description('Scan and inspect local AU/VST/VST3/CLAP plugin inventories');

pluginsCmd
  .command('scan')
  .description('Scan common local plugin folders and write a structured inventory JSON')
  .option('--formats <names>', 'Comma-separated formats: au,vst,vst3,clap')
  .option('-o, --out <path>', 'Output file path (default: plugins/inventory.json)')
  .option('--print', 'Print JSON to stdout instead of saving')
  .option('--prompt-safe', 'Print a prompt-safe view when used with --print')
  .action(pluginScanCommand);

pluginsCmd
  .command('list')
  .description('Print a readable summary from a saved plugin inventory')
  .option('--inventory <path>', 'Inventory file path (default: plugins/inventory.json)')
  .option('--no-prompt-safe', 'Show full local paths instead of the default prompt-safe view')
  .action(pluginListCommand);

pluginsCmd
  .command('enrich')
  .description('Enrich a saved plugin inventory with historical/emulation metadata')
  .option('--inventory <path>', 'Inventory file path (default: plugins/inventory.json)')
  .option('-o, --out <path>', 'Output inventory path (default: overwrite inventory.json)')
  .option('--print', 'Print JSON to stdout instead of saving')
  .option('--prompt-safe', 'Print a prompt-safe view when used with --print')
  .action(pluginEnrichCommand);

pluginsCmd
  .command('match <dossier>')
  .description('Match an enriched plugin inventory against a research dossier')
  .option('--inventory <path>', 'Inventory file path (default: plugins/inventory.json)')
  .option('-o, --out <path>', 'Optional output JSON path for the match report')
  .option('--print', 'Print JSON to stdout instead of summary text')
  .option('--no-prompt-safe', 'Show full local paths instead of the default prompt-safe view')
  .action(pluginMatchCommand);

// ── palette ──────────────────────────────────────────────────────────────────
const paletteCmd = program
  .command('palette')
  .description('Create operational track palettes from research dossiers');

paletteCmd
  .command('generate <dossier>')
  .description('Generate a track-level operational palette from a research dossier')
  .requiredOption('-t, --tracks <names>', 'Comma-separated track names, e.g. "Bass,Drums,Pad,Lead,Chords,FX"')
  .option('--historical-strictness <mode>', 'Historical guardrail mode: strict, loose, hybrid, or modern', 'loose')
  .option('-o, --out <path>', 'Output file path (default: palettes/<topic>-palette.json)')
  .option('--print', 'Print JSON to stdout instead of saving')
  .action(paletteGenerateCommand);

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
  .option('--target <name>', 'Export target preset: default, logic, or reaper')
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

program
  .command('transcribe <file>')
  .description('Transcribe an audio sketch to MIDI, optionally converting it into an AbletonSong set')
  .option('--engine <name>', 'Transcription engine: basic-pitch or klangio', 'basic-pitch')
  .option('--basic-pitch-bin <path>', 'Explicit Basic Pitch CLI path')
  .option('--klangio-api-key <key>', 'Explicit Klangio API key (otherwise use KLANGIO_API_KEY)')
  .option('--klangio-base-url <url>', 'Override the Klangio API base URL')
  .option('--klangio-mode <name>', 'Klangio transcription mode/profile', 'universal')
  .option('--klangio-cache-dir <dir>', 'Override the local Klangio cache directory')
  .option('--klangio-poll-ms <n>', 'Klangio job polling interval in milliseconds', '3000')
  .option('--klangio-timeout-ms <n>', 'Klangio job timeout in milliseconds', '300000')
  .option('--refresh-cache', 'Force a fresh Klangio upload instead of reusing cached artifacts')
  .option('--xml-out <path>', 'Optional MusicXML output path for engines that support it')
  .option('--prefer-musicxml', 'When supported, import MusicXML into --to-set instead of MIDI')
  .option('--separate-first', 'Run source separation before transcription')
  .option('--stem <name>', 'Stem name to transcribe when --separate-first is enabled: drums, bass, vocals, other')
  .option('--stems <names>', 'Comma-separated stem names to transcribe and merge when --separate-first is enabled')
  .option('--all-stems', 'Transcribe and merge all supported stems when --separate-first is enabled')
  .option('--demucs-bin <path>', 'Explicit Demucs CLI path for --separate-first')
  .option('--demucs-model <name>', 'Demucs model name for --separate-first', 'htdemucs')
  .option('--separation-out <dir>', 'Output directory for separated stems when --separate-first is enabled')
  .option('-o, --out <path>', 'Output MIDI path (default: midis/<audio-name>.mid)')
  .option('--to-set <path>', 'Optional AbletonSong output path (directory or .json file)')
  .option('--push', 'Push the imported AbletonSong into the current Ableton Live set after transcription')
  .option('--push-setup', 'When used with --push, create missing MIDI tracks and scenes before pushing')
  .option('--push-overwrite', 'When used with --push, replace existing clips in target slots')
  .option('--dry-run', 'Print the Basic Pitch command without executing it')
  .action(transcribeCommand);

program
  .command('separate <file>')
  .description('Separate a mixed audio file into stems using an optional external engine')
  .option('--engine <name>', 'Separation engine (currently: demucs)', 'demucs')
  .option('--demucs-bin <path>', 'Explicit Demucs CLI path')
  .option('--model <name>', 'Demucs model name (default: htdemucs)', 'htdemucs')
  .option('-o, --out <dir>', 'Output directory (default: stems/separated/<audio-name>/)')
  .option('--manifest', 'Also scan the separated output into a standard stem manifest')
  .option('--manifest-out <path>', 'Optional manifest output path when --manifest is enabled')
  .option('--dry-run', 'Print the Demucs command without executing it')
  .action(separateCommand);

// ── export-midi ──────────────────────────────────────────────────────────────
program
  .command('export-midi <file>')
  .description('Export an AbletonSong set as a Standard MIDI File (.mid)')
  .option('-o, --out <path>', 'Save to a specific output file (default: exports/<name>.mid)')
  .option('--target <name>', 'Export target preset: default, logic, or reaper')
  .action(exportMidiCommand);

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
  .option('--prefix-groups', 'Prefix track names with their group, e.g. [Drums] Kick')
  .option('--dry-run', 'Show what would be set up without writing to Ableton')
  .action(stemSetupCommand);

stemsCmd
  .command('reaper <manifest>')
  .description('Generate a REAPER ReaScript that imports a stem manifest into tracks')
  .option('-n, --name <name>', 'Project name shown in the generated REAPER script')
  .option('-o, --out <path>', 'Output .lua file or directory (default: stems/reaper/<name>-import.lua)')
  .option('--bpm <n>', 'Project tempo to set in REAPER', '120')
  .option('--time-signature <sig>', 'Project time signature, e.g. 4/4', '4/4')
  .option('--flat', 'Create a flat track list instead of group folders')
  .option('--dry-run', 'Preview the generated REAPER import script path without writing it')
  .action(stemReaperCommand);

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
  .command('plan <dossier>')
  .description('Plan role-aware preset generation from a research dossier and optional operational palette')
  .option('--palette <path>', 'Operational palette JSON path')
  .option('--inventory <path>', 'Plugin inventory path (default: plugins/inventory.json)')
  .option('--installed-only', 'Prefer only devices confirmed in the local plugin inventory')
  .option('-o, --out <path>', 'Output path (default: preset-plans/<topic>.json)')
  .option('--print', 'Print the plan JSON instead of saving')
  .action(presetPlanCommand);

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
