/**
 * arrange command — places session view clips into the arrangement timeline.
 *
 * Each section is laid out sequentially. If the clip loop is shorter than
 * the section's bar count, the clip is duplicated to fill the full length.
 *
 * Usage:
 *   ableton-composer arrange sets/my-song.json
 *   ableton-composer arrange sets/my-song.json --start 8     # start at bar 8
 *   ableton-composer arrange sets/my-song.json --gap 2       # 2-bar gap between sections
 *   ableton-composer arrange sets/my-song.json --dry-run
 *   ableton-composer arrange sets/my-song.json --sections intro,main
 *
 * Requirements:
 *   The clips must already exist in the session view (run `push` first).
 */

import chalk from 'chalk';
import ora from 'ora';
import { connect, disconnect, getMidiTracks } from '../lib/ableton.js';
import { loadSong } from '../lib/storage.js';

export async function arrangeCommand(fileOrName, options) {
  const spinner = ora();

  try {
    // ── 1. Load song JSON ────────────────────────────────────────────────────
    spinner.start(`Loading ${fileOrName}...`);
    const { song, filepath } = await loadSong(fileOrName);
    spinner.succeed(`Loaded: ${filepath}`);

    const { meta, sections } = song;
    const beatsPerBar = parseBeatsPerBar(meta.time_signature || '4/4');

    console.log(chalk.bold(`\n🎵 ${meta.genre || 'Song'} — ${meta.bpm} BPM — ${meta.scale}`));

    // ── 2. Filter sections if requested ─────────────────────────────────────
    let activeSections = sections;
    if (options.sections) {
      const names = options.sections.split(',').map(s => s.trim().toLowerCase());
      activeSections = sections.filter(s => names.includes(s.name.toLowerCase()));
      if (activeSections.length === 0) {
        console.log(chalk.red(`✗ No sections matched: ${options.sections}`));
        process.exit(1);
      }
    }

    // ── 3. Build arrangement timeline ────────────────────────────────────────
    const startBar  = parseFloat(options.start || '0');
    const gapBars   = parseFloat(options.gap || '0');
    let cursorBeat  = startBar * beatsPerBar;

    const plan = []; // { section, trackName, sessionSlot, startBeat, repeat, clipLenBeats }[]

    for (let i = 0; i < activeSections.length; i++) {
      const section = activeSections[i];
      // The session slot index is the section's position in the ORIGINAL array
      const sessionSlot = sections.indexOf(section);
      const sectionBeats = section.bars * beatsPerBar;
      const sectionStart = cursorBeat;

      for (const trackDef of section.tracks) {
        const clipLenBeats = trackDef.clip.length_bars * beatsPerBar;
        const repeats = Math.ceil(sectionBeats / clipLenBeats);

        for (let r = 0; r < repeats; r++) {
          plan.push({
            sectionName: section.name,
            trackName:   trackDef.ableton_name,
            sessionSlot,
            startBeat:   sectionStart + r * clipLenBeats,
            clipLenBeats,
          });
        }
      }

      cursorBeat = sectionStart + sectionBeats + gapBars * beatsPerBar;
    }

    // ── 4. Print plan ────────────────────────────────────────────────────────
    console.log('');
    let lastSection = null;
    for (const step of plan) {
      if (step.sectionName !== lastSection) {
        const startBar = step.startBeat / beatsPerBar;
        console.log(chalk.cyan(`  "${step.sectionName}"`) + chalk.dim(` starts at bar ${startBar}`));
        lastSection = step.sectionName;
      }
      if (options.dryRun) {
        console.log(chalk.dim(`    ${step.trackName} → bar ${step.startBeat / beatsPerBar}`));
      }
    }
    console.log('');

    const totalBars = cursorBeat / beatsPerBar - gapBars;
    console.log(chalk.dim(`  Total arrangement length: ${totalBars} bars`));
    console.log('');

    if (options.dryRun) {
      console.log(chalk.yellow('DRY RUN — nothing written to Ableton'));
      return;
    }

    // ── 5. Connect and execute ────────────────────────────────────────────────
    spinner.start('Connecting to Ableton Live...');
    const ableton = await connect();
    spinner.succeed('Connected');

    const midiTracks = await getMidiTracks(ableton);
    const trackIndex = Object.fromEntries(midiTracks.map(t => [t.name, t]));

    let placed = 0;
    const errors = [];

    for (const step of plan) {
      const found = trackIndex[step.trackName];
      if (!found) {
        errors.push(`Track "${step.trackName}" not found in Live set`);
        continue;
      }

      try {
        const slots = await found.track.get('clip_slots');
        const slot  = slots[step.sessionSlot];

        if (!slot) {
          errors.push(`${step.trackName}: no slot at index ${step.sessionSlot} — run push first`);
          continue;
        }

        const hasClip = await slot.get('has_clip');
        if (!hasClip) {
          errors.push(`${step.trackName} slot ${step.sessionSlot} is empty — run push first`);
          continue;
        }

        const clip = await slot.get('clip');
        await found.track.duplicateClipToArrangement(clip, step.startBeat);

        console.log(
          chalk.green(`  ✓ ${step.trackName}`) +
          chalk.dim(` → bar ${step.startBeat / beatsPerBar}`)
        );
        placed++;
      } catch (err) {
        const msg = `${step.trackName} at beat ${step.startBeat}: ${err.message}`;
        errors.push(msg);
        console.log(chalk.red(`  ✗ ${msg}`));
      }
    }

    // ── 6. Summary ────────────────────────────────────────────────────────────
    console.log('');
    if (errors.length > 0) {
      console.log(chalk.yellow(`⚠ Completed with ${errors.length} error(s):`));
      for (const e of errors) console.log(chalk.red(`  - ${e}`));
    } else {
      console.log(chalk.green(`✓ Placed ${placed} clip(s) into the arrangement`));
    }

    console.log(chalk.dim('\n  Switch to arrangement view in Live to see the result.'));
    console.log(chalk.dim('  Tip: set the BPM in Live to match before playing.\n'));

  } catch (err) {
    spinner.fail(err.message);
    process.exit(1);
  } finally {
    await disconnect();
  }
}

// ─── helpers ─────────────────────────────────────────────────────────────────

function parseBeatsPerBar(timeSignature) {
  const [num] = timeSignature.split('/').map(Number);
  return num ?? 4;
}
