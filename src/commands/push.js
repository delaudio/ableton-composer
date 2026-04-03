/**
 * push command — reads a song JSON and writes notes into Ableton Live clips.
 *
 * Usage:
 *   ableton-composer push sets/trip-hop_2026-04-03.json
 *   ableton-composer push sets/trip-hop_2026-04-03.json --overwrite
 *   ableton-composer push sets/trip-hop_2026-04-03.json --dry-run
 *   ableton-composer push sets/trip-hop_2026-04-03.json --sections intro,verse
 */

import chalk from 'chalk';
import ora from 'ora';
import { loadSong } from '../lib/storage.js';
import { connect, disconnect, pushSong } from '../lib/ableton.js';

export async function pushCommand(fileOrName, options) {
  const spinner = ora();

  try {
    // ── 1. Load the song JSON ────────────────────────────────────────────────
    spinner.start(`Loading ${fileOrName}...`);
    const { song, filepath } = await loadSong(fileOrName);
    spinner.succeed(`Loaded: ${filepath}`);

    const { meta, sections } = song;
    console.log(chalk.bold(`\n🎵 ${meta.genre || 'Song'} — ${meta.bpm} BPM — ${meta.scale}`));
    console.log(chalk.dim(`   ${sections.length} sections, time sig ${meta.time_signature || '4/4'}\n`));

    // ── 2. Filter sections if requested ─────────────────────────────────────
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

    // ── 3. Dry run — just show what would happen ─────────────────────────────
    if (options.dryRun) {
      console.log(chalk.yellow('DRY RUN — nothing will be written to Ableton\n'));
      const result = await pushSong(filteredSong, {
        dryRun: true,
        onProgress: msg => console.log(chalk.dim(msg)),
      });
      console.log(chalk.green(`\n✓ Would push ${result.pushed} clips`));
      return;
    }

    // ── 4. Connect to Ableton ────────────────────────────────────────────────
    spinner.start('Connecting to Ableton Live...');
    await connect();
    spinner.succeed('Connected');

    // ── 5. Push ──────────────────────────────────────────────────────────────
    console.log('');
    const result = await pushSong(filteredSong, {
      overwrite: options.overwrite,
      onProgress: msg => {
        if (msg.includes('✓')) console.log(chalk.green(msg));
        else if (msg.includes('✗')) console.log(chalk.red(msg));
        else console.log(chalk.dim(msg));
      },
    });

    // ── 6. Summary ───────────────────────────────────────────────────────────
    console.log('');

    if (result.errors.length > 0) {
      console.log(chalk.yellow(`⚠ Completed with ${result.errors.length} error(s):`));
      for (const e of result.errors) console.log(chalk.red(`  - ${e}`));
    } else {
      console.log(chalk.green(`✓ Pushed ${result.pushed} clips successfully`));
    }

    console.log(chalk.dim(`\n  Hint: sections map to scenes in session view.`));
    console.log(chalk.dim(`  Trigger a scene in Live to audition the section.\n`));

  } catch (err) {
    spinner.fail(err.message);
    process.exit(1);
  } finally {
    await disconnect();
  }
}
