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

const program = new Command();

program
  .name('ableton-composer')
  .description('Generate and push MIDI content into Ableton Live using Claude AI')
  .version('0.1.0');

// ── generate ─────────────────────────────────────────────────────────────────
program
  .command('generate <prompt>')
  .alias('gen')
  .description('Generate a song JSON from a natural language prompt')
  .option('-t, --tracks <names>',  'Comma-separated track names (e.g. "Bass,Drums,Chords,Lead")')
  .option('-L, --live-sync',       'Auto-detect track names from the open Ableton set')
  .option('-w, --weather',         'Fetch weather data and include it in the prompt context')
  .option('-m, --model <model>',   'Claude model to use (overrides CLAUDE_MODEL env var)')
  .option('-n, --name <name>',     'Name hint for the saved filename')
  .option('-o, --output <path>',   'Save to a specific path instead of sets/')
  .option('-s, --style <path>',    'Style profile JSON to guide generation (from "analyze" command)')
  .option('--no-save',             'Print JSON to stdout without saving to disk')
  .action(generateCommand);

// ── push ──────────────────────────────────────────────────────────────────────
program
  .command('push <file>')
  .description('Push a song JSON into the current Ableton Live set')
  .option('--overwrite',           'Replace existing clips in target slots')
  .option('--dry-run',             'Show what would be pushed without writing to Live')
  .option('--sections <names>',    'Only push specific sections (comma-separated, e.g. "intro,verse")')
  .option('--setup',               'Create missing MIDI tracks and scenes before pushing')
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
  .command('analyze <target>')
  .description('Extract a style profile from a set or collection of sets')
  .option('--out <path>',   'Save profile to a specific path (default: profiles/<name>.json)')
  .option('--print',        'Print JSON to stdout instead of saving')
  .action(analyzeCommand);

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
