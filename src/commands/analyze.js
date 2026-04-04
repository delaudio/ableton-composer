/**
 * analyze command — extract a style profile from one set or a collection of sets.
 *
 * Usage:
 *   ableton-composer analyze sets/my-song/          # single set → profile JSON
 *   ableton-composer analyze sets/my-song.json
 *   ableton-composer analyze sets/pop-collection/   # collection of sets → aggregated profile
 *   ableton-composer analyze sets/my-song/ --out profiles/pop.json
 */

import chalk from 'chalk';
import { writeFile, readdir } from 'fs/promises';
import { join, resolve } from 'path';
import { loadSong, isSetDirectory } from '../lib/storage.js';
import { analyzeSong, aggregateProfiles } from '../lib/analysis.js';

export async function analyzeCommand(target, options) {
  const absTarget = target.startsWith('/') ? target : join(process.cwd(), target);

  try {
    // ── Detect mode: single set vs collection directory ────────────────────
    const isDir = await isSetDirectory(absTarget).catch(() => false);

    if (!isDir && !target.endsWith('.json')) {
      // Could be a collection directory (contains set subdirectories, not a set itself)
      const entries = await readdir(absTarget, { withFileTypes: true }).catch(() => null);
      const subDirs = entries?.filter(e => e.isDirectory()) ?? [];

      if (subDirs.length > 0) {
        await analyzeCollection(absTarget, subDirs, options);
        return;
      }
    }

    // ── Single set ─────────────────────────────────────────────────────────
    await analyzeSingleSet(target, absTarget, options);

  } catch (err) {
    console.error(chalk.red(`✗ ${err.message}`));
    process.exit(1);
  }
}

// ─── single set ───────────────────────────────────────────────────────────────

async function analyzeSingleSet(target, absTarget, options) {
  const { song, filepath } = await loadSong(target);
  const profile = analyzeSong(song, filepath);

  printProfile(profile);
  await saveIfRequested(profile, options, target);
}

// ─── collection ───────────────────────────────────────────────────────────────

async function analyzeCollection(absTarget, subDirs, options) {
  console.log(chalk.bold(`\n Analyzing collection: ${absTarget}\n`));

  const profiles = [];

  for (const entry of subDirs) {
    const setPath = join(absTarget, entry.name);

    // Skip directories that are not set directories (no meta.json)
    const isSet = await isSetDirectory(setPath).catch(() => false);
    if (!isSet) continue;

    try {
      const relPath = join(absTarget, entry.name);
      const { song, filepath } = await loadSong(relPath);
      const profile = analyzeSong(song, filepath);
      profiles.push(profile);
      console.log(chalk.dim(`  ✓ ${entry.name}  (${profile.key}, ${profile.bpm} BPM, ${profile.structure.section_count} sections)`));
    } catch (err) {
      console.log(chalk.yellow(`  ⚠ ${entry.name}: ${err.message}`));
    }
  }

  if (profiles.length === 0) {
    console.log(chalk.yellow('⚠ No valid sets found in collection.'));
    return;
  }

  console.log('');
  const aggregate = aggregateProfiles(profiles);
  printAggregateProfile(aggregate);
  await saveIfRequested(aggregate, options, absTarget);
}

// ─── output helpers ───────────────────────────────────────────────────────────

function printProfile(p) {
  console.log(chalk.bold(`\n Style Profile — ${p._meta.source}\n`));

  console.log(chalk.cyan('  Key & Tempo'));
  console.log(`    Key:            ${chalk.white(p.key)}  (confidence: ${p.key_confidence})`);
  console.log(`    BPM:            ${chalk.white(p.bpm)}`);
  console.log(`    Time signature: ${chalk.white(p.time_signature)}`);

  console.log(chalk.cyan('\n  Structure'));
  console.log(`    Sections:       ${p.structure.section_count}  (${p.structure.bars_per_section} bars each, ${p.structure.total_bars} total)`);
  console.log(`    Sequence:       ${chalk.dim(p.structure.section_sequence.join(' → '))}`);

  console.log(chalk.cyan('\n  Arrangement'));
  for (const [track, presence] of Object.entries(p.arrangement.track_presence)) {
    const bar   = '█'.repeat(Math.round(presence * 10));
    const empty = '░'.repeat(10 - Math.round(presence * 10));
    console.log(`    ${track.padEnd(12)} ${bar}${empty}  ${Math.round(presence * 100)}%`);
  }

  console.log(chalk.cyan('\n  Rhythm  (notes/bar)'));
  for (const [track, npb] of Object.entries(p.rhythm.notes_per_bar)) {
    console.log(`    ${track.padEnd(12)} ${npb}`);
  }

  if (Object.keys(p.pitch.by_track).length > 0) {
    console.log(chalk.cyan('\n  Pitch'));
    for (const [track, info] of Object.entries(p.pitch.by_track)) {
      console.log(`    ${track.padEnd(12)} range ${info.min}–${info.max} (${info.semitones} st)  avg vel ${info.avg_velocity}  avg dur ${info.avg_duration}b`);
    }
    const topPcs = Object.entries(p.pitch.pitch_classes)
      .sort((a, b) => b[1] - a[1]).slice(0, 5).map(([k]) => k).join('  ');
    console.log(`    Top pitch classes: ${chalk.dim(topPcs)}`);
  }

  // Show per-section keys only when there is tonal variation
  const kbs = p.pitch.key_by_section ?? {};
  const kbsEntries = Object.entries(kbs);
  if (kbsEntries.length > 0) {
    const uniqueKeys = new Set(kbsEntries.map(([, v]) => v.key));
    if (uniqueKeys.size > 1) {
      console.log(chalk.cyan('\n  Key by Section  (tonal variation detected)'));
      for (const [name, info] of kbsEntries) {
        console.log(`    ${name.padEnd(14)} ${chalk.white(info.key)}  ${chalk.dim(`conf: ${info.confidence}`)}`);
      }
    }
  }

  console.log('');
}

function printAggregateProfile(p) {
  console.log(chalk.bold(` Collection Profile (${p._meta.sets_analyzed} sets)\n`));

  console.log(chalk.cyan('  Key & Tempo'));
  console.log(`    Key consensus:  ${chalk.white(p.key_consensus)}`);
  console.log(`    Mode consensus: ${chalk.white(p.mode_consensus)}`);
  if (p.bpm_range)
    console.log(`    BPM range:      ${p.bpm_range.min}–${p.bpm_range.max}  (avg ${p.bpm_range.avg})`);

  console.log(chalk.cyan('\n  Structure'));
  if (p.structure.section_count_range)
    console.log(`    Sections:  ${p.structure.section_count_range.min}–${p.structure.section_count_range.max}  (avg ${p.structure.section_count_range.avg})`);
  if (p.structure.bars_per_section_avg)
    console.log(`    Bars/section (avg): ${p.structure.bars_per_section_avg}`);

  console.log(chalk.cyan('\n  Arrangement (avg presence across sets)'));
  for (const [track, presence] of Object.entries(p.arrangement.track_presence)) {
    const bar   = '█'.repeat(Math.round(presence * 10));
    const empty = '░'.repeat(10 - Math.round(presence * 10));
    console.log(`    ${track.padEnd(12)} ${bar}${empty}  ${Math.round(presence * 100)}%`);
  }

  console.log(chalk.cyan('\n  Rhythm (avg notes/bar)'));
  for (const [track, npb] of Object.entries(p.rhythm.notes_per_bar)) {
    console.log(`    ${track.padEnd(12)} ${npb}`);
  }

  console.log('');
}

async function saveIfRequested(profile, options, fallbackTarget) {
  if (!options.out && !options.print) {
    // Default: save to profiles/ directory
    const slug = fallbackTarget
      .replace(/.*\//, '')
      .replace(/\.json$/, '')
      .replace(/[^a-z0-9_-]/gi, '-')
      .toLowerCase();
    const outPath = join(process.cwd(), 'profiles', `${slug}.json`);
    const { mkdir } = await import('fs/promises');
    await mkdir(join(process.cwd(), 'profiles'), { recursive: true });
    await writeFile(outPath, JSON.stringify(profile, null, 2), 'utf-8');
    console.log(chalk.green(`✓ Profile saved to ${outPath}`));
    console.log(chalk.dim('  Use with: ableton-composer generate "<prompt>" --style ' + outPath));
    return;
  }

  if (options.out) {
    const outPath = options.out.startsWith('/') ? options.out : join(process.cwd(), options.out);
    const { mkdir } = await import('fs/promises');
    await mkdir(outPath.replace(/\/[^/]+$/, ''), { recursive: true });
    await writeFile(outPath, JSON.stringify(profile, null, 2), 'utf-8');
    console.log(chalk.green(`✓ Profile saved to ${outPath}`));
  }

  if (options.print) {
    console.log(JSON.stringify(profile, null, 2));
  }
}
