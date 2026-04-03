/**
 * push command — reads a song JSON (flat or directory) and writes notes into Ableton Live clips.
 *
 * Formats accepted:
 *   sets/my-song.json                 flat file, all sections
 *   sets/my-song/                     set directory, all sections
 *   sets/my-song/01-main.json         single section file (slot index from filename prefix)
 *
 * Usage:
 *   ableton-composer push sets/my-song/
 *   ableton-composer push sets/my-song/01-main.json --overwrite
 *   ableton-composer push sets/my-song.json --sections intro,verse
 *   ableton-composer push sets/my-song/ --dry-run
 */

import chalk from 'chalk';
import ora from 'ora';
import { join } from 'path';
import {
  loadSong,
  isSetDirectory,
  listSectionFiles,
  loadSetDirectory,
  slotIndexFromFilename,
} from '../lib/storage.js';
import { connect, disconnect, pushSong, pushClip, getTrackByName, getAbleton } from '../lib/ableton.js';

export async function pushCommand(fileOrName, options) {
  const spinner = ora();

  try {
    // ── Resolve absolute path ────────────────────────────────────────────────
    const absPath = fileOrName.startsWith('/')
      ? fileOrName
      : join(process.cwd(), fileOrName);

    // ── Detect single section file ───────────────────────────────────────────
    const slotFromFilename = slotIndexFromFilename(fileOrName);
    const isSingleSection = slotFromFilename !== null && fileOrName.endsWith('.json');

    if (isSingleSection) {
      await pushSingleSection(absPath, slotFromFilename, options, spinner);
      return;
    }

    // ── Load full song (flat file or directory) ──────────────────────────────
    spinner.start(`Loading ${fileOrName}...`);
    const { song, filepath, isDirectory } = await loadSong(fileOrName);
    spinner.succeed(`Loaded: ${filepath}${isDirectory ? '/' : ''}`);

    const { meta, sections } = song;
    console.log(chalk.bold(`\n🎵 ${meta.genre || 'Song'} — ${meta.bpm} BPM — ${meta.scale}`));
    console.log(chalk.dim(`   ${sections.length} section(s), time sig ${meta.time_signature || '4/4'}\n`));

    // ── Filter sections ───────────────────────────────────────────────────────
    let filteredSong = song;
    if (options.sections) {
      const names = options.sections.split(',').map(s => s.trim().toLowerCase());
      filteredSong = {
        ...song,
        sections: song.sections.filter(s => names.includes(s.name.toLowerCase())),
      };
      if (filteredSong.sections.length === 0) {
        console.log(chalk.red(`✗ No sections matched: ${options.sections}`));
        console.log(chalk.dim(`  Available: ${song.sections.map(s => s.name).join(', ')}`));
        process.exit(1);
      }
    }

    // ── Dry run ───────────────────────────────────────────────────────────────
    if (options.dryRun) {
      console.log(chalk.yellow('DRY RUN — nothing will be written to Ableton\n'));
      const result = await pushSong(filteredSong, {
        dryRun: true,
        onProgress: msg => console.log(chalk.dim(msg)),
      });
      console.log(chalk.green(`\n✓ Would push ${result.pushed} clips`));
      return;
    }

    // ── Connect and push ──────────────────────────────────────────────────────
    spinner.start('Connecting to Ableton Live...');
    await connect();
    spinner.succeed('Connected');

    console.log('');
    const result = await pushSong(filteredSong, {
      overwrite: options.overwrite,
      onProgress: msg => {
        if (msg.includes('✓')) console.log(chalk.green(msg));
        else if (msg.includes('✗')) console.log(chalk.red(msg));
        else console.log(chalk.dim(msg));
      },
    });

    console.log('');
    if (result.errors.length > 0) {
      console.log(chalk.yellow(`⚠ Completed with ${result.errors.length} error(s):`));
      for (const e of result.errors) console.log(chalk.red(`  - ${e}`));
    } else {
      console.log(chalk.green(`✓ Pushed ${result.pushed} clips successfully`));
    }
    console.log(chalk.dim('\n  Sections map to scenes in session view.\n'));

  } catch (err) {
    spinner.fail(err.message);
    process.exit(1);
  } finally {
    await disconnect();
  }
}

// ─── single section file ─────────────────────────────────────────────────────

async function pushSingleSection(sectionPath, slotIndex, options, spinner) {
  spinner.start(`Loading section from ${sectionPath}...`);

  const { readFile } = await import('fs/promises');
  const { dirname, join } = await import('path');

  const section = JSON.parse(await readFile(sectionPath, 'utf-8'));

  // Try to get time_signature from parent meta.json
  let timeSignature = '4/4';
  try {
    const meta = JSON.parse(await readFile(join(dirname(sectionPath), 'meta.json'), 'utf-8'));
    if (meta.time_signature) timeSignature = meta.time_signature;
    spinner.succeed(
      `Loaded section "${section.name}" → slot ${slotIndex}  (${meta.genre || ''} ${meta.bpm || ''} BPM)`
    );
  } catch {
    spinner.succeed(`Loaded section "${section.name}" → slot ${slotIndex}`);
  }

  if (options.dryRun) {
    console.log(chalk.yellow('\nDRY RUN'));
    for (const t of section.tracks) {
      console.log(chalk.dim(`  ${t.ableton_name}: ${t.clip.notes.length} notes → slot ${slotIndex}`));
    }
    return;
  }

  spinner.start('Connecting to Ableton Live...');
  await connect();
  spinner.succeed('Connected');

  const ableton = getAbleton();
  console.log('');
  let pushed = 0;
  const errors = [];

  for (const trackDef of section.tracks) {
    try {
      const found = await getTrackByName(ableton, trackDef.ableton_name);
      if (!found) {
        errors.push(`Track "${trackDef.ableton_name}" not found`);
        console.log(chalk.red(`  ✗ ${trackDef.ableton_name}: not found in Live set`));
        continue;
      }
      await pushClip(found.track, slotIndex, trackDef.clip, { overwrite: options.overwrite, timeSignature });
      console.log(chalk.green(`  ✓ ${trackDef.ableton_name} → slot ${slotIndex} (${trackDef.clip.notes.length} notes)`));
      pushed++;
    } catch (err) {
      errors.push(`${trackDef.ableton_name}: ${err.message}`);
      console.log(chalk.red(`  ✗ ${trackDef.ableton_name}: ${err.message}`));
    }
  }

  console.log('');
  if (errors.length > 0) {
    console.log(chalk.yellow(`⚠ ${errors.length} error(s)`));
  } else {
    console.log(chalk.green(`✓ Pushed ${pushed} track(s) to slot ${slotIndex}`));
  }
}
