/**
 * generate command
 *
 * Usage:
 *   ableton-composer generate "trip-hop 90bpm D minor, 4 sections"
 *   ableton-composer generate "..." --weather --output ./sets/my-song.json
 *   ableton-composer generate "..." --tracks "Bass,Drums,Chords,Lead"
 *   ableton-composer generate "..." --no-save   (just print, don't save to disk)
 */

import chalk from 'chalk';
import ora from 'ora';
import { join } from 'path';
import { deriveTonalState, generateSong, getProviderLabel, normalizeProvider } from '../lib/ai.js';
import { saveSetDirectory, loadSong, SETS_DIR, slugify } from '../lib/storage.js';
import { fetchContext } from '../lib/fetchers/index.js';
import { connect, disconnect, getMidiTracks } from '../lib/ableton.js';
import { loadStyleProfile } from '../lib/profiles.js';

export async function generateCommand(prompt, options) {
  const spinner = ora();

  try {
    // ── 0a. Load existing song for --continue ────────────────────────────────
    let existingSong = null;
    if (options.continue) {
      const { song } = await loadSong(options.continue);
      existingSong = song;
      console.log(chalk.dim(`Continuing: ${options.continue} (${existingSong.sections.length} existing sections)`));
    }

    // ── 0b. Load style profile (optional) ───────────────────────────────────
    let styleProfile = null;
    if (options.style) {
      const absStyle = options.style.startsWith('/')
        ? options.style
        : join(process.cwd(), options.style);
      const loaded = await loadStyleProfile(absStyle).catch(() => {
        throw new Error(`Style profile not found: ${absStyle}`);
      });
      styleProfile = loaded.profile;
      const label = loaded.bundle
        ? `${loaded.bundle.scope || 'bundle'} bundle -> ${loaded.resolvedPath} (${styleProfile._meta?.prompt_ready ? 'prompt profile' : 'merged profile'})`
        : (styleProfile._meta?.source || loaded.resolvedPath);
      console.log(chalk.dim(`Style profile: ${label}`));
    }

    // ── 1. Resolve track names ───────────────────────────────────────────────
    let trackNames = [];

    if (options.tracks) {
      // Manual override: --tracks "Bass,Drums,Chords,Lead"
      trackNames = options.tracks.split(',').map(s => s.trim()).filter(Boolean);
      console.log(chalk.dim(`Using provided tracks: ${trackNames.join(', ')}`));
    } else if (options.liveSync) {
      // Auto-detect from open Ableton set
      spinner.start('Connecting to Ableton Live...');
      try {
        const ableton = await connect();
        const midiTracks = await getMidiTracks(ableton);
        await disconnect();
        trackNames = midiTracks.map(t => t.name);
        spinner.succeed(`Found ${trackNames.length} tracks: ${trackNames.join(', ')}`);
      } catch {
        spinner.warn('Could not connect to Ableton. Using --tracks or provide track names manually.');
        await disconnect();
      }
    }

    // Fall back to track names from the style profile
    if (trackNames.length === 0 && styleProfile?.arrangement?.tracks?.length > 0) {
      trackNames = styleProfile.arrangement.tracks;
      console.log(chalk.dim(`Using tracks from style profile: ${trackNames.join(', ')}`));
    }

    if (trackNames.length === 0) {
      console.log(chalk.yellow('⚠ No track names provided. The selected model will suggest track names — make sure your Live set matches them.'));
      console.log(chalk.dim('  Tip: use --tracks "Bass,Drums,Chords,Lead" or --live-sync to auto-detect.'));
    }

    // ── 2. Fetch external context ────────────────────────────────────────────
    const contextOpts = { weather: options.weather };
    const hasContext = Object.values(contextOpts).some(Boolean);

    let context = {};
    if (hasContext) {
      spinner.start('Fetching context data...');
      context = await fetchContext(contextOpts);
      spinner.succeed('Context ready');
    }

    // ── 3. Generate (single or multiple variations) ──────────────────────────
    const variationCount = Math.max(1, parseInt(options.variations, 10) || 1);
    const totalSections  = options.sections ? parseInt(options.sections, 10) : null;
    const chunkSize      = options.chunkSize ? parseInt(options.chunkSize, 10) : null;
    const provider       = normalizeProvider(options.provider || 'api');
    const modelLabel     = getProviderLabel(provider, options.model);
    const savedPaths     = [];

    for (let v = 1; v <= variationCount; v++) {
      const label         = variationCount > 1 ? `v${v}/${variationCount}` : '';
      const providerLabel = provider === 'claude-cli' ? 'Claude Code CLI' : modelLabel;

      let song;

      // ── Chunked generation ───────────────────────────────────────────────
      if (chunkSize && totalSections) {
        const totalChunks = Math.ceil(totalSections / chunkSize);
        let accumulated   = existingSong ? { ...existingSong, sections: [...existingSong.sections] } : null;
        let tonalState    = deriveTonalState(existingSong, styleProfile) ?? null;

        for (let chunk = 0; chunk < totalChunks; chunk++) {
          const from      = chunk * chunkSize + 1;
          const to        = Math.min((chunk + 1) * chunkSize, totalSections);
          const chunkInfo = `[chunk ${chunk + 1}/${totalChunks}: sections ${from}–${to} of ${totalSections}]`;

          spinner.start(
            `${providerLabel}${label ? `  [${label}]` : ''}  ${chalk.dim(chunkInfo)}`
          );

          const tonalInstruction = tonalState
            ? ` Maintain tonal center exactly: ${tonalState.scale || tonalState.key || tonalState.tonal_center}. Do not shift to a different root unless explicitly requested.`
            : '';
          const chunkPrompt = chunk === 0
            ? `${prompt}\n\nGenerate ONLY the first ${to - from + 1} sections (${chunkInfo.slice(1, -1)}).${tonalInstruction}`
            : `${prompt}\n\nGenerate ONLY sections ${from}–${to} (${chunkInfo.slice(1, -1)}). Continue coherently from the existing sections.${tonalInstruction}`;

          const chunkResult = await generateSong({
            prompt:       chunkPrompt,
            trackNames,
            context:      chunk === 0 ? context : {},
            styleProfile,
            existingSong: accumulated,
            tonalState,
            model:        options.model,
            provider,
          });

          tonalState = deriveTonalState(tonalState, accumulated, chunkResult);

          if (!accumulated) {
            accumulated = chunkResult;
          } else {
            accumulated = {
              meta:     { ...accumulated.meta, ...chunkResult.meta },
              sections: [...accumulated.sections, ...chunkResult.sections],
            };
          }

          spinner.succeed(
            `Generated ${chunkResult.sections.length} section(s)  ${chalk.dim(chunkInfo)}` +
            (label ? `  [${label}]` : '')
          );
        }

        song = accumulated;

        // Also strip sections from --continue baseline (already in accumulated from the start)
        if (existingSong) {
          song.meta = { ...existingSong.meta, ...song.meta };
        }

      } else {
        // ── Single-shot generation (original behaviour) ────────────────────
        const sectionHint = totalSections ? ` Generate exactly ${totalSections} sections.` : '';
        spinner.start(`Generating with ${providerLabel}${label ? `  [${label}]` : ''}...`);

        song = await generateSong({
          prompt:       sectionHint ? `${prompt}\n\n${sectionHint}` : prompt,
          trackNames,
          context,
          styleProfile,
          existingSong,
          model:        options.model,
          provider,
        });

        if (existingSong) {
          song.meta     = { ...existingSong.meta, ...song.meta };
          song.sections = [...existingSong.sections, ...song.sections];
        }

        spinner.succeed(`Song generated${label ? `  [${label}]` : ''}`);
      }

      // ── Print summary ───────────────────────────────────────────────────
      const { meta, sections } = song;
      console.log('');
      if (variationCount > 1) console.log(chalk.bold(`  ── Variation ${v} ──`));
      console.log(chalk.bold(`🎵 ${meta.genre || 'Song'} — ${meta.bpm} BPM — ${meta.scale}`));
      if (meta.mood) console.log(chalk.dim(`   mood: ${meta.mood}`));
      if (meta.description) console.log(chalk.dim(`   ${meta.description}`));
      console.log('');

      for (const [i, section] of sections.entries()) {
        const noteCount = section.tracks.reduce((sum, t) => sum + t.clip.notes.length, 0);
        console.log(
          chalk.cyan(`  [${i}] ${section.name}`) +
          chalk.dim(` — ${section.bars} bars, ${section.tracks.length} tracks, ${noteCount} notes total`)
        );
        for (const track of section.tracks) {
          console.log(chalk.dim(`       ${track.ableton_name}: ${track.clip.notes.length} notes`));
        }
      }

      console.log('');

      // ── Save ────────────────────────────────────────────────────────────
      if (options.save !== false) {
        const nameHint = options.name
          ? (variationCount > 1 ? `${options.name}_v${v}` : options.name)
          : `${meta.genre || 'song'}-${meta.bpm}bpm`;

        let savedPath;
        if (options.output) {
          // --output: flat JSON if path ends with .json, directory otherwise
          if (options.output.endsWith('.json')) {
            savedPath = await writeOutputFile(song, options.output);
          } else {
            await saveSetDirectory(song, options.output);
            savedPath = options.output;
          }
        } else {
          // Default: save as set directory in sets/<slug>/
          const slug    = slugify(nameHint);
          const dirPath = join(SETS_DIR, slug);
          await saveSetDirectory(song, dirPath);
          savedPath = dirPath;
        }

        savedPaths.push(savedPath);
        console.log(chalk.green(`✓ Saved to ${savedPath}`));
        console.log('');
      } else {
        console.log(JSON.stringify(song, null, 2));
      }
    }

    // ── Final summary for multiple variations ───────────────────────────────
    if (variationCount > 1 && savedPaths.length > 0) {
      console.log(chalk.bold('  Generated variations:'));
      savedPaths.forEach((p, i) => {
        console.log(`    ${chalk.cyan(`v${i + 1}`)}  ${p}`);
        console.log(chalk.dim(`         ableton-composer push ${p}`));
      });
      console.log('');
    } else if (savedPaths.length === 1) {
      console.log(chalk.dim(`  Next: ableton-composer push ${savedPaths[0]}`));
    }

    return savedPaths;

  } catch (err) {
    spinner.fail(err.message);
    process.exit(1);
  }
}

// ─── helpers ─────────────────────────────────────────────────────────────────

async function writeOutputFile(song, outputPath) {
  const { writeFile } = await import('fs/promises');
  await writeFile(outputPath, JSON.stringify(song, null, 2), 'utf-8');
  return outputPath;
}
