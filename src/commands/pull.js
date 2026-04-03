/**
 * pull command — reads clips from Ableton Live and writes them into a song JSON.
 *
 * Usage:
 *   ableton-composer pull                              # all scenes that have at least one clip
 *   ableton-composer pull --scene 0                   # only scene row 0
 *   ableton-composer pull --scene 2 --name "bridge"   # scene 2, label it "bridge"
 *   ableton-composer pull --add-to sets/my-song.json  # merge into existing file instead of creating new
 *   ableton-composer pull --scene 0 --add-to sets/my-song.json --replace  # replace existing section
 */

import chalk from 'chalk';
import ora from 'ora';
import { connect, disconnect, getMidiTracks } from '../lib/ableton.js';
import { loadSong, saveSong } from '../lib/storage.js';

export async function pullCommand(options) {
  const spinner = ora();

  try {
    // ── 1. Connect ───────────────────────────────────────────────────────────
    spinner.start('Connecting to Ableton Live...');
    const ableton = await connect();
    spinner.succeed('Connected');

    // ── 2. Read Live set metadata ────────────────────────────────────────────
    const [tempo, sigNum, sigDen] = await Promise.all([
      ableton.song.get('tempo'),
      ableton.song.get('signature_numerator'),
      ableton.song.get('signature_denominator'),
    ]);
    const timeSignature = `${sigNum}/${sigDen}`;
    const beatsPerBar = sigNum;

    // ── 3. Decide which scene indices to pull ────────────────────────────────
    const sceneFilter = options.scene !== undefined ? [parseInt(options.scene, 10)] : null;

    // ── 4. Read tracks and their clips ───────────────────────────────────────
    spinner.start('Reading clips from Live...');
    const midiTracks = await getMidiTracks(ableton);

    if (midiTracks.length === 0) {
      spinner.fail('No MIDI tracks found in the current Live set.');
      return;
    }

    // Collect all scenes present across all tracks
    const sceneMap = new Map(); // sceneIndex → { name, tracks: [] }

    for (const { name: trackName, track } of midiTracks) {
      let slots;
      try {
        slots = await track.get('clip_slots');
      } catch {
        continue;
      }

      for (let slotIdx = 0; slotIdx < slots.length; slotIdx++) {
        // Skip if we're filtering to specific scene(s)
        if (sceneFilter && !sceneFilter.includes(slotIdx)) continue;

        const slot = slots[slotIdx];
        const hasClip = await slot.get('has_clip');
        if (!hasClip) continue;

        const clip = await slot.get('clip');
        const lengthBeats = await clip.get('length');
        const lengthBars = lengthBeats / beatsPerBar;
        const notes = await clip.getNotes(0, 0, lengthBeats, 128);

        if (!sceneMap.has(slotIdx)) {
          sceneMap.set(slotIdx, { sceneIndex: slotIdx, tracks: [] });
        }
        sceneMap.get(slotIdx).tracks.push({
          ableton_name: trackName,
          clip: {
            length_bars: lengthBars,
            notes: notes.map(n => ({
              pitch:    n.pitch,
              time:     n.time,
              duration: n.duration,
              velocity: n.velocity,
              ...(n.muted ? { muted: true } : {}),
            })),
          },
        });
      }
    }

    spinner.succeed(`Read ${sceneMap.size} scene(s) from Live`);

    if (sceneMap.size === 0) {
      console.log(chalk.yellow('⚠ No clips found in the selected scene(s).'));
      return;
    }

    // ── 5. Build sections ────────────────────────────────────────────────────
    const sortedScenes = [...sceneMap.values()].sort((a, b) => a.sceneIndex - b.sceneIndex);

    const newSections = sortedScenes.map((scene, i) => {
      const maxBars = Math.max(...scene.tracks.map(t => t.clip.length_bars));
      const label = options.name
        ? (sortedScenes.length === 1 ? options.name : `${options.name}_${i}`)
        : `scene_${scene.sceneIndex}`;

      console.log(
        chalk.cyan(`  [${scene.sceneIndex}] ${label}`) +
        chalk.dim(` — ${scene.tracks.length} tracks, ${maxBars} bars`)
      );
      for (const t of scene.tracks) {
        console.log(chalk.dim(`       ${t.ableton_name}: ${t.clip.notes.length} notes, ${t.clip.length_bars} bars`));
      }

      return {
        name: label,
        bars: maxBars,
        tracks: scene.tracks,
      };
    });

    // ── 6. Merge into existing file or create new ────────────────────────────
    let finalSong;
    let saveHint;

    if (options.addTo) {
      spinner.start(`Loading ${options.addTo}...`);
      const { song: existingSong, filepath } = await loadSong(options.addTo);
      spinner.succeed(`Loaded ${filepath}`);

      for (const newSection of newSections) {
        const existingIdx = existingSong.sections.findIndex(s => s.name === newSection.name);

        if (existingIdx !== -1) {
          if (options.replace) {
            existingSong.sections[existingIdx] = newSection;
            console.log(chalk.yellow(`  ↺ Replaced section "${newSection.name}"`));
          } else {
            // Append a numbered duplicate instead of silently overwriting
            const uniqueName = `${newSection.name}_pulled`;
            newSection.name = uniqueName;
            existingSong.sections.push(newSection);
            console.log(chalk.dim(`  + Added as "${uniqueName}" (use --replace to overwrite existing)`));
          }
        } else {
          existingSong.sections.push(newSection);
          console.log(chalk.green(`  + Added section "${newSection.name}"`));
        }
      }

      finalSong = existingSong;
      saveHint = options.addTo;

      // Write back to the same file
      const { writeFile } = await import('fs/promises');
      const { loadSong: _ls, SETS_DIR } = await import('../lib/storage.js');
      const { join } = await import('path');
      const { fileURLToPath } = await import('url');
      const { dirname } = await import('path');
      const __dirname = dirname(fileURLToPath(import.meta.url));
      const targetPath = options.addTo.startsWith('/')
        ? options.addTo
        : join(process.cwd(), options.addTo);
      await writeFile(targetPath, JSON.stringify(finalSong, null, 2), 'utf-8');
      console.log(chalk.green(`\n✓ Saved to ${targetPath}`));

    } else {
      // Build a new song from scratch
      finalSong = {
        meta: {
          bpm: tempo,
          scale: '',
          genre: '',
          time_signature: timeSignature,
          description: 'Pulled from Ableton Live — fill in scale and genre.',
        },
        sections: newSections,
      };

      saveHint = options.name || 'pulled';
      const savedPath = await saveSong(finalSong, saveHint);
      console.log(chalk.green(`\n✓ Saved to ${savedPath}`));
      console.log(chalk.dim(`  Edit the "scale" and "genre" fields in the JSON to complete the metadata.`));
    }

  } catch (err) {
    spinner.fail(err.message);
    process.exit(1);
  } finally {
    await disconnect();
  }
}
