/**
 * import-midi command — converts a .mid file directly to an AbletonSong JSON.
 *
 * No Ableton Live required. Uses @tonejs/midi for parsing.
 *
 * Track naming via --tracks:
 *   Positional:   --tracks "Bass,Drums,Pad"         renames active MIDI tracks in order
 *   Mapping:      --tracks "Piano Right:Pad,Bass:Bass"  renames by original MIDI track name
 *
 * Output formats:
 *   (no --out)              flat JSON in sets/
 *   --out sets/my-song/     set directory (one file per section + meta.json)
 *   --out sets/my-song.json flat file at exact path
 *
 * Usage:
 *   ableton-composer import-midi song.mid
 *   ableton-composer import-midi song.mid --name "jazz-blues" --split-every 8
 *   ableton-composer import-midi song.mid --tracks "Piano:Pad,Bass:Bass,Drums:Drums"
 *   ableton-composer import-midi song.mid --out sets/jazz-blues/
 */

import chalk from 'chalk';
import ora from 'ora';
import { readFile, writeFile } from 'fs/promises';
import { join, basename, extname } from 'path';
import { saveSong, saveSetDirectory } from '../lib/storage.js';

export async function importMidiCommand(midiFile, options) {
  const spinner = ora();

  try {
    // ── Load parser ──────────────────────────────────────────────────────────
    const { Midi } = (await import('@tonejs/midi')).default;

    // ── Read and parse ───────────────────────────────────────────────────────
    const absPath = midiFile.startsWith('/') ? midiFile : join(process.cwd(), midiFile);
    spinner.start(`Parsing ${basename(midiFile)}...`);
    const buffer = await readFile(absPath);
    const midi = new Midi(buffer);
    spinner.succeed(`Parsed ${basename(midiFile)}`);

    // ── Extract header metadata ──────────────────────────────────────────────
    const ppq = midi.header.ppq;
    const bpm = midi.header.tempos.length > 0
      ? Math.round(midi.header.tempos[0].bpm)
      : 120;
    const rawSig = midi.header.timeSignatures.length > 0
      ? midi.header.timeSignatures[0].timeSignature
      : [4, 4];
    const timeSignature = `${rawSig[0]}/${rawSig[1]}`;
    const beatsPerBar = rawSig[0];

    console.log(chalk.bold(`\n  ${bpm} BPM — ${timeSignature}`));
    console.log(chalk.dim(`  PPQ: ${ppq},  tracks in file: ${midi.tracks.length}\n`));

    // ── Filter tracks that contain notes ─────────────────────────────────────
    const activeTracks = midi.tracks
      .map((track, i) => ({ track, index: i, name: track.name || `Track ${i + 1}` }))
      .filter(({ track }) => track.notes && track.notes.length > 0);

    if (activeTracks.length === 0) {
      spinner.fail('No tracks with notes found in this MIDI file.');
      process.exit(1);
    }

    // ── Apply --tracks renaming ───────────────────────────────────────────────
    const trackNameMap = buildTrackNameMap(options.tracks, activeTracks);
    for (const t of activeTracks) {
      if (trackNameMap[t.index] !== undefined) t.name = trackNameMap[t.index];
    }

    for (const { name, track } of activeTracks) {
      console.log(chalk.cyan(`  ${name}`) + chalk.dim(` — ${track.notes.length} notes`));
    }
    console.log('');

    // ── Total length in bars ─────────────────────────────────────────────────
    const totalTicks = Math.max(...activeTracks.map(({ track }) => {
      const last = track.notes[track.notes.length - 1];
      return last.ticks + last.durationTicks;
    }));
    const totalBars = Math.ceil(totalTicks / ppq / beatsPerBar);

    // ── Build section windows ─────────────────────────────────────────────────
    const splitEvery = options.splitEvery ? parseInt(options.splitEvery, 10) : null;
    const nameHint   = options.name || basename(midiFile, extname(midiFile));
    const windows    = buildWindows(totalBars, splitEvery, nameHint);

    console.log(chalk.dim(`  Total: ${totalBars} bar(s) → ${windows.length} section(s)\n`));

    // ── Build AbletonSong sections ────────────────────────────────────────────
    const sections = [];

    for (const win of windows) {
      const winStartTicks = win.startBar * beatsPerBar * ppq;
      const winEndTicks   = win.endBar   * beatsPerBar * ppq;
      const winBars       = win.endBar - win.startBar;

      const tracks = [];

      for (const { name, track } of activeTracks) {
        const notes = track.notes
          .filter(n => n.ticks >= winStartTicks && n.ticks < winEndTicks)
          .map(n => ({
            pitch:    n.midi,
            time:     round3(( n.ticks - winStartTicks) / ppq),
            duration: Math.max(0.0625, round3(n.durationTicks / ppq)),
            velocity: Math.min(127, Math.max(1, Math.round(n.velocity * 127))),
          }));

        if (notes.length > 0) {
          tracks.push({ ableton_name: name, clip: { length_bars: winBars, notes } });
        }
      }

      if (tracks.length === 0) continue;

      const noteCount = tracks.reduce((s, t) => s + t.clip.notes.length, 0);
      console.log(
        chalk.cyan(`  [${sections.length}] ${win.name}`) +
        chalk.dim(` — ${tracks.length} track(s), ${winBars} bar(s), ${noteCount} notes`)
      );

      sections.push({ name: win.name, bars: winBars, tracks });
    }

    console.log('');

    if (sections.length === 0) {
      spinner.fail('No notes mapped to any section.');
      process.exit(1);
    }

    // ── Assemble song ─────────────────────────────────────────────────────────
    const song = {
      meta: {
        bpm,
        scale: '',
        genre: '',
        time_signature: timeSignature,
        description: `Imported from ${basename(midiFile)} — fill in scale and genre.`,
      },
      sections,
    };

    // ── Save ──────────────────────────────────────────────────────────────────
    if (options.out) {
      const absOut  = options.out.startsWith('/') ? options.out : join(process.cwd(), options.out);
      const saveDir = options.out.endsWith('/') || !options.out.endsWith('.json');

      if (saveDir) {
        await saveSetDirectory(song, absOut);
        console.log(chalk.green(`✓ Saved to ${absOut}/`));
        console.log(chalk.dim('  Edit "scale" and "genre" in meta.json to complete metadata.'));
      } else {
        await writeFile(absOut, JSON.stringify(song, null, 2), 'utf-8');
        console.log(chalk.green(`✓ Saved to ${absOut}`));
      }
    } else {
      const savedPath = await saveSong(song, nameHint);
      console.log(chalk.green(`✓ Saved to ${savedPath}`));
      console.log(chalk.dim('  Edit "scale" and "genre" fields to complete metadata.'));
      console.log(chalk.dim(`\n  Push into Ableton: ableton-composer push ${savedPath} --setup`));
      console.log(chalk.dim(`  Split into directory: ableton-composer split ${savedPath}`));
    }

  } catch (err) {
    spinner.fail(err.message);
    process.exit(1);
  }
}

// ─── helpers ─────────────────────────────────────────────────────────────────

/**
 * Build a map of MIDI track index → new name from the --tracks option.
 *
 * Two modes:
 *  - Positional: "Bass,Drums,Pad"           → rename active tracks in order
 *  - Mapping:    "Piano Right:Pad,Bass:Bass" → rename by original MIDI track name
 */
function buildTrackNameMap(tracksOption, activeTracks) {
  const map = {};
  if (!tracksOption) return map;

  const parts    = tracksOption.split(',').map(s => s.trim()).filter(Boolean);
  const isMapMode = parts.some(p => p.includes(':'));

  if (isMapMode) {
    for (const part of parts) {
      const colonIdx = part.indexOf(':');
      if (colonIdx === -1) continue;
      const orig    = part.slice(0, colonIdx).trim();
      const newName = part.slice(colonIdx + 1).trim();
      const found   = activeTracks.find(t => t.name === orig);
      if (found) map[found.index] = newName;
    }
  } else {
    // Positional — rename active tracks in order
    for (let j = 0; j < parts.length && j < activeTracks.length; j++) {
      map[activeTracks[j].index] = parts[j];
    }
  }

  return map;
}

/**
 * Divide totalBars into section windows.
 * If splitEvery is null, one window covers the entire file.
 */
function buildWindows(totalBars, splitEvery, nameHint) {
  if (!splitEvery) {
    return [{ name: nameHint, startBar: 0, endBar: totalBars }];
  }

  const windows = [];
  for (let start = 0; start < totalBars; start += splitEvery) {
    const end   = Math.min(start + splitEvery, totalBars);
    const index = windows.length;
    windows.push({
      name:     `${nameHint}_${index}`,
      startBar: start,
      endBar:   end,
    });
  }
  return windows;
}

/** Round to 3 decimal places. */
function round3(n) {
  return Math.round(n * 1000) / 1000;
}
