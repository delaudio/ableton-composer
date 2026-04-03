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
import { listCommand }     from '../src/commands/list.js';
import { infoCommand }     from '../src/commands/info.js';

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
  .option('--no-save',             'Print JSON to stdout without saving to disk')
  .action(generateCommand);

// ── push ──────────────────────────────────────────────────────────────────────
program
  .command('push <file>')
  .description('Push a song JSON into the current Ableton Live set')
  .option('--overwrite',           'Replace existing clips in target slots')
  .option('--dry-run',             'Show what would be pushed without writing to Live')
  .option('--sections <names>',    'Only push specific sections (comma-separated, e.g. "intro,verse")')
  .action(pushCommand);

// ── pull ──────────────────────────────────────────────────────────────────────
program
  .command('pull')
  .description('Read clips from the current Ableton Live set and save to JSON')
  .option('-s, --scene <index>',    'Pull only this scene row (0-indexed). Omit to pull all scenes with clips.')
  .option('-n, --name <name>',      'Section name to use in the JSON (default: "scene_N")')
  .option('--add-to <file>',        'Merge into an existing song JSON instead of creating a new file')
  .option('--replace',              'When used with --add-to, replace an existing section with the same name')
  .action(pullCommand);

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
