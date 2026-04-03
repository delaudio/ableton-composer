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
import { generateSong } from '../lib/claude.js';
import { saveSong } from '../lib/storage.js';
import { fetchContext } from '../lib/fetchers/index.js';
import { connect, disconnect, getMidiTracks } from '../lib/ableton.js';

export async function generateCommand(prompt, options) {
  const spinner = ora();

  try {
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

    if (trackNames.length === 0) {
      console.log(chalk.yellow('⚠ No track names provided. Claude will suggest track names — make sure your Live set matches them.'));
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

    // ── 3. Generate with Claude ──────────────────────────────────────────────
    spinner.start(`Generating with ${options.model || process.env.CLAUDE_MODEL || 'claude-opus-4-5'}...`);

    const song = await generateSong({
      prompt,
      trackNames,
      context,
      model: options.model,
    });

    spinner.succeed('Song generated');

    // ── 4. Print summary ─────────────────────────────────────────────────────
    const { meta, sections } = song;
    console.log('');
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

    // ── 5. Save ───────────────────────────────────────────────────────────────
    if (options.save !== false) {
      const nameHint = options.name || `${meta.genre || 'song'}-${meta.bpm}bpm`;
      const savedPath = options.output
        ? await writeOutputFile(song, options.output)
        : await saveSong(song, nameHint);

      console.log(chalk.green(`✓ Saved to ${savedPath}`));
      console.log('');
      console.log(chalk.dim(`  Next: ableton-composer push ${savedPath}`));
    } else {
      // Just print the JSON
      console.log(JSON.stringify(song, null, 2));
    }

    return song;

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
