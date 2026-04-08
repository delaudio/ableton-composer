/**
 * expand command — adds new accompaniment tracks to an existing set using an AI provider.
 *
 * The model receives a harmonic summary (pitch classes per bar) for each section
 * and writes complementary parts for the requested instruments.
 *
 * Usage:
 *   ableton-composer expand sets/fingerbib.json --add "Strings,Cello,Bass"
 *   ableton-composer expand sets/fingerbib.json --add "Strings" --style "orchestral ambient"
 *   ableton-composer expand sets/fingerbib.json --add "Strings,Bass" --sections "fingerbib_0,fingerbib_1"
 *   ableton-composer expand sets/fingerbib.json --add "Strings" --out sets/fingerbib-orchestrated.json
 */

import chalk from 'chalk';
import ora from 'ora';
import { join } from 'path';
import { loadSong, saveSong, writeSongFile } from '../lib/storage.js';
import { expandSong, getDefaultModel, getProviderLabel, normalizeProvider } from '../lib/ai.js';
import { appendProvenance } from '../lib/provenance.js';

export async function expandCommand(fileArg, options) {
  const spinner = ora();

  try {
    if (!options.add) {
      console.error(chalk.red('✗ --add is required. Example: --add "Strings,Cello"'));
      process.exit(1);
    }

    const tracksToAdd = options.add.split(',').map(s => s.trim()).filter(Boolean);
    const provider = normalizeProvider(options.provider || 'api');

    // ── Load set ──────────────────────────────────────────────────────────────
    spinner.start(`Loading ${fileArg}...`);
    const { song, filepath } = await loadSong(fileArg);
    spinner.succeed(`Loaded: ${filepath}  (${song.sections.length} sections)`);

    const { meta, sections } = song;
    console.log(chalk.bold(`\n  ${meta.genre || 'Song'} — ${meta.bpm} BPM — ${meta.scale || '?'}`));
    console.log(chalk.dim(`  Adding: ${tracksToAdd.join(', ')}\n`));

    // ── Section filter ────────────────────────────────────────────────────────
    let sectionsFilter = null;
    if (options.sections) {
      sectionsFilter = options.sections.split(',').map(s => s.trim());
      const matched = sections.filter(s => sectionsFilter.includes(s.name));
      if (matched.length === 0) {
        console.error(chalk.red(`✗ No sections matched: ${options.sections}`));
        console.error(chalk.dim(`  Available: ${sections.map(s => s.name).join(', ')}`));
        process.exit(1);
      }
      console.log(chalk.dim(`  Sections: ${matched.map(s => s.name).join(', ')} (${matched.length}/${sections.length})\n`));
    }

    // ── Dry run ───────────────────────────────────────────────────────────────
    if (options.dryRun) {
      const target = sectionsFilter ? sections.filter(s => sectionsFilter.includes(s.name)) : sections;
      console.log(chalk.yellow('DRY RUN — would add these tracks:\n'));
      for (const section of target) {
        console.log(`  ${chalk.cyan(section.name)} (${section.bars} bars)`);
        for (const t of tracksToAdd) {
          console.log(chalk.dim(`    + ${t}`));
        }
      }
      return;
    }

    // ── Ask model ─────────────────────────────────────────────────────────────
    const providerLabel = getProviderLabel(provider, options.model);
    spinner.start(`Asking ${providerLabel} to write ${tracksToAdd.join(', ')} parts...`);

    const result = await expandSong({
      song,
      tracksToAdd,
      styleHint:      options.style || '',
      sectionsFilter,
      model:          options.model,
      provider,
    });

    spinner.succeed(`${providerLabel} finished`);

    if (!result.sections || result.sections.length === 0) {
      throw new Error(`${providerLabel} returned no sections.`);
    }

    // ── Merge new tracks into the song ────────────────────────────────────────
    console.log('');
    let totalAdded = 0;

    for (const generated of result.sections) {
      const section = sections.find(s => s.name === generated.name);
      if (!section) {
        console.log(chalk.yellow(`  ⚠ Unknown section "${generated.name}" — skipped`));
        continue;
      }

      for (const newTrack of (generated.new_tracks ?? [])) {
        const noteCount = newTrack.clip?.notes?.length ?? 0;

        // Skip if track already exists and --overwrite not set
        const existing = section.tracks.findIndex(t => t.ableton_name === newTrack.ableton_name);
        if (existing !== -1) {
          if (options.overwrite) {
            section.tracks[existing] = newTrack;
            console.log(chalk.yellow(`  ↺ ${section.name} / ${newTrack.ableton_name} — replaced (${noteCount} notes)`));
          } else {
            console.log(chalk.dim(`  ~ ${section.name} / ${newTrack.ableton_name} — already exists, skipped (use --overwrite)`));
          }
          continue;
        }

        section.tracks.push(newTrack);
        console.log(chalk.green(`  ✓ ${section.name} / ${newTrack.ableton_name} — ${noteCount} notes`));
        totalAdded++;
      }
    }

    console.log('');
    console.log(chalk.green(`✓ Added ${totalAdded} track(s) across ${result.sections.length} section(s)`));

    // ── Save ──────────────────────────────────────────────────────────────────
    const updatedSong = { meta, sections };
    appendProvenance(updatedSong, 'expand', {
      provider,
      model: getDefaultModel(provider, options.model),
      prompt: options.style || undefined,
      tracks: tracksToAdd,
      sections: result.sections.length,
    });

    if (options.out) {
      const absOut = options.out.startsWith('/') ? options.out : join(process.cwd(), options.out);
      await writeSongFile(absOut, updatedSong);
      console.log(chalk.green(`✓ Saved to ${absOut}`));
    } else {
      // Overwrite the source file
      await writeSongFile(filepath, updatedSong);
      console.log(chalk.green(`✓ Updated ${filepath}`));
    }

    console.log(chalk.dim(`\n  Push into Ableton: ableton-composer push ${options.out || fileArg} --setup --overwrite`));

  } catch (err) {
    spinner.fail(err.message);
    process.exit(1);
  }
}
