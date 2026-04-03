/**
 * clear command — removes clips and notes from the current Ableton Live set.
 *
 * Session view:    slots are fully deleted (clip disappears)
 * Arrangement:     notes are removed from each clip — the empty container remains
 *                  (ableton-js has no API to delete arrangement clip containers)
 *
 * Usage:
 *   ableton-composer clear                  # clears session view (default)
 *   ableton-composer clear --arrangement    # empties arrangement clips
 *   ableton-composer clear --all            # both session and arrangement
 *   ableton-composer clear --tracks "Bass,Drums"   # only specific tracks
 *   ableton-composer clear --scenes 0,1,2   # only specific scene rows (session)
 *   ableton-composer clear --dry-run
 */

import chalk from 'chalk';
import ora from 'ora';
import { connect, disconnect, getMidiTracks } from '../lib/ableton.js';

export async function clearCommand(options) {
  const spinner = ora();

  const doSession     = options.all || (!options.arrangement);
  const doArrangement = options.all || options.arrangement;

  const trackFilter = options.tracks
    ? options.tracks.split(',').map(s => s.trim())
    : null;

  const sceneFilter = options.scenes
    ? options.scenes.split(',').map(s => parseInt(s.trim(), 10))
    : null;

  try {
    spinner.start('Connecting to Ableton Live...');
    await connect();
    spinner.succeed('Connected');

    const { getAbleton } = await import('../lib/ableton.js');
    const ableton = getAbleton();
    const tracks  = await getMidiTracks(ableton);

    const filtered = trackFilter
      ? tracks.filter(t => trackFilter.includes(t.name))
      : tracks;

    if (filtered.length === 0) {
      console.log(chalk.yellow('⚠ No matching tracks found.'));
      return;
    }

    let clearedSession     = 0;
    let clearedArrangement = 0;
    const errors = [];

    // ── Session view ──────────────────────────────────────────────────────────
    if (doSession) {
      console.log(chalk.dim('\nSession view:'));

      for (const { name, track } of filtered) {
        try {
          const slots = await track.get('clip_slots');

          for (let i = 0; i < slots.length; i++) {
            if (sceneFilter && !sceneFilter.includes(i)) continue;

            const hasClip = await slots[i].get('has_clip');
            if (!hasClip) continue;

            if (options.dryRun) {
              console.log(chalk.dim(`  [dry] ${name} slot ${i} — would delete`));
              clearedSession++;
              continue;
            }

            await slots[i].deleteClip();
            console.log(chalk.green(`  ✓ ${name} slot ${i} deleted`));
            clearedSession++;
          }
        } catch (err) {
          errors.push(`${name} (session): ${err.message}`);
          console.log(chalk.red(`  ✗ ${name}: ${err.message}`));
        }
      }
    }

    // ── Arrangement view ──────────────────────────────────────────────────────
    if (doArrangement) {
      console.log(chalk.dim('\nArrangement view:'));
      console.log(chalk.dim('  (notes removed — empty clip containers remain, ableton-js cannot delete them)'));

      for (const { name, track } of filtered) {
        try {
          const arrangementClips = await track.get('arrangement_clips');

          if (!arrangementClips || arrangementClips.length === 0) continue;

          for (const clip of arrangementClips) {
            const length = await clip.get('length');

            if (options.dryRun) {
              console.log(chalk.dim(`  [dry] ${name} — would remove notes from clip (${length} beats)`));
              clearedArrangement++;
              continue;
            }

            await clip.removeNotes(0, 0, length, 128);
            console.log(chalk.green(`  ✓ ${name} — notes removed (${length} beats)`));
            clearedArrangement++;
          }
        } catch (err) {
          errors.push(`${name} (arrangement): ${err.message}`);
          console.log(chalk.red(`  ✗ ${name}: ${err.message}`));
        }
      }
    }

    // ── Summary ───────────────────────────────────────────────────────────────
    console.log('');

    if (options.dryRun) {
      console.log(chalk.yellow('DRY RUN — nothing was changed'));
      if (doSession)     console.log(chalk.dim(`  Session:     ${clearedSession} clip(s) would be deleted`));
      if (doArrangement) console.log(chalk.dim(`  Arrangement: ${clearedArrangement} clip(s) would be emptied`));
      return;
    }

    if (errors.length > 0) {
      console.log(chalk.yellow(`⚠ Completed with ${errors.length} error(s):`));
      for (const e of errors) console.log(chalk.red(`  - ${e}`));
    }

    if (doSession)     console.log(chalk.green(`✓ Session:     ${clearedSession} clip(s) deleted`));
    if (doArrangement) console.log(chalk.green(`✓ Arrangement: ${clearedArrangement} clip(s) emptied`));

    if (doArrangement && !options.dryRun && clearedArrangement > 0) {
      console.log(chalk.dim('\n  Tip: to fully remove empty arrangement containers,'));
      console.log(chalk.dim('  select all in arrangement view (Cmd+A) and press Delete.'));
    }

  } catch (err) {
    spinner.fail(err.message);
    process.exit(1);
  } finally {
    await disconnect();
  }
}
