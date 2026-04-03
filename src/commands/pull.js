/**
 * pull command — reads clips from Ableton Live and writes them into a song JSON.
 *
 * Output formats:
 *   (no --out)                    creates a new flat JSON in sets/
 *   --out sets/my-song/           writes individual section files into the set directory
 *   --add-to sets/my-song.json    merges into existing flat file
 *   --add-to sets/my-song/        merges into existing set directory
 *
 * Usage:
 *   ableton-composer pull                              # all scenes with clips → new flat JSON
 *   ableton-composer pull --scene 0                   # only scene row 0
 *   ableton-composer pull --scene 2 --name "bridge"   # scene 2, label it "bridge"
 *   ableton-composer pull --out sets/idm-g-minor/     # write section files into directory
 *   ableton-composer pull --scene 1 --add-to sets/idm-g-minor/ --replace
 */

import chalk from 'chalk';
import ora from 'ora';
import { join } from 'path';
import { writeFile } from 'fs/promises';
import { connect, disconnect, getMidiTracks } from '../lib/ableton.js';
import {
  loadSong,
  saveSong,
  saveSectionToDirectory,
  isSetDirectory,
  sectionFilename,
} from '../lib/storage.js';

export async function pullCommand(options) {
  const spinner = ora();

  try {
    // ── 1. Connect ────────────────────────────────────────────────────────────
    spinner.start('Connecting to Ableton Live...');
    const ableton = await connect();
    spinner.succeed('Connected');

    // ── 2. Read Live set metadata ─────────────────────────────────────────────
    const [tempo, sigNum, sigDen] = await Promise.all([
      ableton.song.get('tempo'),
      ableton.song.get('signature_numerator'),
      ableton.song.get('signature_denominator'),
    ]);
    const timeSignature = `${sigNum}/${sigDen}`;
    const beatsPerBar   = sigNum;

    // ── 3. Decide which scene indices to pull ─────────────────────────────────
    const sceneFilter = options.scene !== undefined ? [parseInt(options.scene, 10)] : null;

    // ── 4. Read clips ─────────────────────────────────────────────────────────
    spinner.start('Reading clips from Live...');
    const midiTracks = await getMidiTracks(ableton);

    if (midiTracks.length === 0) {
      spinner.fail('No MIDI tracks found.');
      return;
    }

    const sceneMap = new Map(); // sceneIndex → { sceneIndex, tracks[] }

    for (const { name: trackName, track } of midiTracks) {
      let slots;
      try { slots = await track.get('clip_slots'); } catch { continue; }

      for (let slotIdx = 0; slotIdx < slots.length; slotIdx++) {
        if (sceneFilter && !sceneFilter.includes(slotIdx)) continue;

        const hasClip = await slots[slotIdx].get('has_clip');
        if (!hasClip) continue;

        const clip        = await slots[slotIdx].get('clip');
        const lengthBeats = await clip.get('length');
        const notes       = await clip.getNotes(0, 0, lengthBeats, 128);

        if (!sceneMap.has(slotIdx)) sceneMap.set(slotIdx, { sceneIndex: slotIdx, tracks: [] });
        sceneMap.get(slotIdx).tracks.push({
          ableton_name: trackName,
          clip: {
            length_bars: lengthBeats / beatsPerBar,
            notes: notes.map(({ pitch, time, duration, velocity, muted }) => ({
              pitch, time, duration, velocity, ...(muted ? { muted: true } : {}),
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

    // ── 5. Build sections ─────────────────────────────────────────────────────
    const sortedScenes = [...sceneMap.values()].sort((a, b) => a.sceneIndex - b.sceneIndex);

    const newSections = sortedScenes.map((scene, i) => {
      const maxBars = Math.max(...scene.tracks.map(t => t.clip.length_bars));
      const label   = options.name
        ? (sortedScenes.length === 1 ? options.name : `${options.name}_${i}`)
        : `scene_${scene.sceneIndex}`;

      console.log(
        chalk.cyan(`  [${scene.sceneIndex}] ${label}`) +
        chalk.dim(` — ${scene.tracks.length} tracks, ${maxBars} bars`)
      );
      for (const t of scene.tracks) {
        console.log(chalk.dim(`       ${t.ableton_name}: ${t.clip.notes.length} notes`));
      }

      return { sceneIndex: scene.sceneIndex, section: { name: label, bars: maxBars, tracks: scene.tracks } };
    });

    console.log('');

    // ── 6. Save ───────────────────────────────────────────────────────────────
    const liveMeta = {
      bpm: tempo,
      scale: '',
      genre: '',
      time_signature: timeSignature,
      description: 'Pulled from Ableton Live — fill in scale and genre.',
    };

    const outTarget = options.out || options.addTo;

    if (outTarget) {
      const absTarget = outTarget.startsWith('/') ? outTarget : join(process.cwd(), outTarget);
      const targetIsDir = await isSetDirectory(absTarget).catch(() => false);

      // ── Directory target ──────────────────────────────────────────────────
      if (targetIsDir || outTarget.endsWith('/') || (!outTarget.endsWith('.json'))) {
        for (const { sceneIndex, section } of newSections) {
          const savedPath = await saveSectionToDirectory(section, sceneIndex, absTarget, liveMeta);
          const replaced  = options.replace ? ' (replaced)' : '';
          console.log(chalk.green(`✓ ${sectionFilename(sceneIndex, section.name)}${replaced}`));
        }
        console.log(chalk.dim(`\n  Directory: ${absTarget}`));
        return;
      }

      // ── Flat file target (--add-to) ────────────────────────────────────────
      const { song: existingSong, filepath } = await loadSong(outTarget);

      for (const { section: newSection } of newSections) {
        const idx = existingSong.sections.findIndex(s => s.name === newSection.name);
        if (idx !== -1) {
          if (options.replace) {
            existingSong.sections[idx] = newSection;
            console.log(chalk.yellow(`  ↺ Replaced section "${newSection.name}"`));
          } else {
            const uniqueName = `${newSection.name}_pulled`;
            existingSong.sections.push({ ...newSection, name: uniqueName });
            console.log(chalk.dim(`  + Added as "${uniqueName}" (use --replace to overwrite)`));
          }
        } else {
          existingSong.sections.push(newSection);
          console.log(chalk.green(`  + Added section "${newSection.name}"`));
        }
      }

      const targetPath = outTarget.startsWith('/') ? outTarget : join(process.cwd(), outTarget);
      await writeFile(targetPath, JSON.stringify(existingSong, null, 2), 'utf-8');
      console.log(chalk.green(`\n✓ Saved to ${targetPath}`));

    } else {
      // ── New flat file ─────────────────────────────────────────────────────
      const finalSong = {
        meta: liveMeta,
        sections: newSections.map(({ section }) => section),
      };
      const savedPath = await saveSong(finalSong, options.name || 'pulled');
      console.log(chalk.green(`✓ Saved to ${savedPath}`));
      console.log(chalk.dim(`  Edit the "scale" and "genre" fields in the JSON to complete the metadata.`));
      console.log(chalk.dim(`\n  Split into directory: ableton-composer split ${savedPath}`));
    }

  } catch (err) {
    spinner.fail(err.message);
    process.exit(1);
  } finally {
    await disconnect();
  }
}
