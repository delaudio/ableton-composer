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
import { analyzeSong, aggregateProfiles, analyzeHarmony, aggregateHarmonyProfiles, analyzeRhythm, aggregateRhythmProfiles, analyzeArrangement, aggregateArrangementProfiles } from '../lib/analysis.js';
import { enrichProfileMetadata, saveProfileSetWithBundle } from '../lib/profiles.js';

export async function analyzeCommand(targets, options) {
  try {
    // ── Multiple explicit targets → aggregate directly ─────────────────────
    if (targets.length > 1) {
      await analyzeMultipleTargets(targets, options);
      return;
    }

    // ── Single target ──────────────────────────────────────────────────────
    const target    = targets[0];
    const absTarget = target.startsWith('/') ? target : join(process.cwd(), target);
    const isDir     = await isSetDirectory(absTarget).catch(() => false);

    if (!isDir && !target.endsWith('.json')) {
      // Could be a collection directory (contains set subdirectories, not a set itself)
      const entries = await readdir(absTarget, { withFileTypes: true }).catch(() => null);
      const subDirs = entries?.filter(e => e.isDirectory()) ?? [];

      if (subDirs.length > 0) {
        await analyzeCollection(absTarget, subDirs, options);
        return;
      }
    }

    await analyzeSingleSet(target, absTarget, options);

  } catch (err) {
    console.error(chalk.red(`✗ ${err.message}`));
    process.exit(1);
  }
}

// ─── single set ───────────────────────────────────────────────────────────────

async function analyzeSingleSet(target, absTarget, options) {
  const { song, filepath } = await loadSong(target);
  const profile = enrichProfileMetadata(analyzeSong(song, filepath), {
    scope: options.scope || 'song',
    domain: 'core',
    artist: options.artist || null,
    album: options.album || null,
    song: options.song || target.replace(/.*\//, '').replace(/\.json$/, ''),
    sourcePaths: [filepath],
  });
  const harmonyProfile = enrichProfileMetadata(analyzeHarmony(song, filepath), {
    scope: options.scope || 'song',
    domain: 'harmony',
    artist: options.artist || null,
    album: options.album || null,
    song: options.song || target.replace(/.*\//, '').replace(/\.json$/, ''),
    sourcePaths: [filepath],
  });
  const rhythmProfile = enrichProfileMetadata(analyzeRhythm(song, filepath), {
    scope: options.scope || 'song',
    domain: 'rhythm',
    artist: options.artist || null,
    album: options.album || null,
    song: options.song || target.replace(/.*\//, '').replace(/\.json$/, ''),
    sourcePaths: [filepath],
  });
  const arrangementProfile = enrichProfileMetadata(analyzeArrangement(song, filepath), {
    scope: options.scope || 'song',
    domain: 'arrangement',
    artist: options.artist || null,
    album: options.album || null,
    song: options.song || target.replace(/.*\//, '').replace(/\.json$/, ''),
    sourcePaths: [filepath],
  });

  printProfile(profile);
  printHarmonyProfile(harmonyProfile);
  printRhythmProfile(rhythmProfile);
  printArrangementProfile(arrangementProfile);
  await saveIfRequested({ core: profile, harmony: harmonyProfile, rhythm: rhythmProfile, arrangement: arrangementProfile }, options, target);
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
  const aggregate = enrichProfileMetadata(aggregateProfiles(profiles), {
    scope: options.scope || 'album',
    domain: 'core',
    artist: options.artist || null,
    album: options.album || absTarget.replace(/.*\//, ''),
    song: null,
    sourcePaths: profiles.map(p => p._meta?.source).filter(Boolean),
  });
  const aggregateHarmony = enrichProfileMetadata(aggregateHarmonyProfiles(
    await Promise.all(
      subDirs
        .filter(Boolean)
        .map(async entry => {
          const setPath = join(absTarget, entry.name);
          const isSet = await isSetDirectory(setPath).catch(() => false);
          if (!isSet) return null;
          const relPath = join(absTarget, entry.name);
          const { song, filepath } = await loadSong(relPath);
          return analyzeHarmony(song, filepath);
        })
    ).then(items => items.filter(Boolean))
  ), {
    scope: options.scope || 'album',
    domain: 'harmony',
    artist: options.artist || null,
    album: options.album || absTarget.replace(/.*\//, ''),
    song: null,
    sourcePaths: profiles.map(p => p._meta?.source).filter(Boolean),
  });
  const aggregateRhythm = enrichProfileMetadata(aggregateRhythmProfiles(
    await Promise.all(
      subDirs
        .filter(Boolean)
        .map(async entry => {
          const setPath = join(absTarget, entry.name);
          const isSet = await isSetDirectory(setPath).catch(() => false);
          if (!isSet) return null;
          const relPath = join(absTarget, entry.name);
          const { song, filepath } = await loadSong(relPath);
          return analyzeRhythm(song, filepath);
        })
    ).then(items => items.filter(Boolean))
  ), {
    scope: options.scope || 'album',
    domain: 'rhythm',
    artist: options.artist || null,
    album: options.album || absTarget.replace(/.*\//, ''),
    song: null,
    sourcePaths: profiles.map(p => p._meta?.source).filter(Boolean),
  });
  const aggregateArrangement = enrichProfileMetadata(aggregateArrangementProfiles(
    await Promise.all(
      subDirs
        .filter(Boolean)
        .map(async entry => {
          const setPath = join(absTarget, entry.name);
          const isSet = await isSetDirectory(setPath).catch(() => false);
          if (!isSet) return null;
          const relPath = join(absTarget, entry.name);
          const { song, filepath } = await loadSong(relPath);
          return analyzeArrangement(song, filepath);
        })
    ).then(items => items.filter(Boolean))
  ), {
    scope: options.scope || 'album',
    domain: 'arrangement',
    artist: options.artist || null,
    album: options.album || absTarget.replace(/.*\//, ''),
    song: null,
    sourcePaths: profiles.map(p => p._meta?.source).filter(Boolean),
  });
  printAggregateProfile(aggregate);
  printHarmonyProfile(aggregateHarmony);
  printRhythmProfile(aggregateRhythm);
  printArrangementProfile(aggregateArrangement);
  await saveIfRequested({ core: aggregate, harmony: aggregateHarmony, rhythm: aggregateRhythm, arrangement: aggregateArrangement }, options, absTarget);
}

// ─── multiple explicit targets ───────────────────────────────────────────────

async function analyzeMultipleTargets(targets, options) {
  console.log(chalk.bold(`\n Analyzing ${targets.length} sets...\n`));

  const profiles = [];

  for (const target of targets) {
    const absTarget = target.startsWith('/') ? target : join(process.cwd(), target);
    try {
      const { song, filepath } = await loadSong(target);
      const profile = analyzeSong(song, filepath);
      profiles.push(profile);
      console.log(chalk.dim(`  ✓ ${target}  (${profile.key}, ${profile.bpm} BPM, ${profile.structure.section_count} sections)`));
    } catch (err) {
      console.log(chalk.yellow(`  ⚠ ${target}: ${err.message}`));
    }
  }

  if (profiles.length === 0) {
    console.log(chalk.yellow('⚠ No valid sets could be analyzed.'));
    return;
  }

  console.log('');
  const aggregate = enrichProfileMetadata(aggregateProfiles(profiles), {
    scope: options.scope || 'collection',
    domain: 'core',
    artist: options.artist || null,
    album: options.album || null,
    song: null,
    sourcePaths: profiles.map(p => p._meta?.source).filter(Boolean),
  });
  const harmonyProfiles = [];
  for (const target of targets) {
    try {
      const { song, filepath } = await loadSong(target);
      harmonyProfiles.push(analyzeHarmony(song, filepath));
    } catch {}
  }
  const aggregateHarmony = enrichProfileMetadata(aggregateHarmonyProfiles(harmonyProfiles), {
    scope: options.scope || 'collection',
    domain: 'harmony',
    artist: options.artist || null,
    album: options.album || null,
    song: null,
    sourcePaths: profiles.map(p => p._meta?.source).filter(Boolean),
  });
  const rhythmProfiles = [];
  for (const target of targets) {
    try {
      const { song, filepath } = await loadSong(target);
      rhythmProfiles.push(analyzeRhythm(song, filepath));
    } catch {}
  }
  const aggregateRhythm = enrichProfileMetadata(aggregateRhythmProfiles(rhythmProfiles), {
    scope: options.scope || 'collection',
    domain: 'rhythm',
    artist: options.artist || null,
    album: options.album || null,
    song: null,
    sourcePaths: profiles.map(p => p._meta?.source).filter(Boolean),
  });
  const arrangementProfiles = [];
  for (const target of targets) {
    try {
      const { song, filepath } = await loadSong(target);
      arrangementProfiles.push(analyzeArrangement(song, filepath));
    } catch {}
  }
  const aggregateArrangement = enrichProfileMetadata(aggregateArrangementProfiles(arrangementProfiles), {
    scope: options.scope || 'collection',
    domain: 'arrangement',
    artist: options.artist || null,
    album: options.album || null,
    song: null,
    sourcePaths: profiles.map(p => p._meta?.source).filter(Boolean),
  });

  // Use a combined label for the default output filename
  const label = targets
    .map(t => t.replace(/.*\//, '').replace(/\.json$/, ''))
    .join('_+_')
    .slice(0, 60);

  printAggregateProfile(aggregate);
  printHarmonyProfile(aggregateHarmony);
  printRhythmProfile(aggregateRhythm);
  printArrangementProfile(aggregateArrangement);
  await saveIfRequested({ core: aggregate, harmony: aggregateHarmony, rhythm: aggregateRhythm, arrangement: aggregateArrangement }, options, label);
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

    const chords = p.pitch.chords_by_track ?? {};
    if (Object.keys(chords).length > 0) {
      console.log(chalk.cyan('\n  Chords  (most frequent per track)'));
      for (const [track, list] of Object.entries(chords)) {
        const str = list.map(c => `${c.chord}×${c.count}`).join('  ');
        console.log(`    ${track.padEnd(12)} ${chalk.dim(str)}`);
      }
    }
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

function printHarmonyProfile(profile) {
  const h = profile?.harmony;
  if (!h) return;

  console.log(chalk.cyan('  Harmony'));
  console.log(`    Harmonic rhythm: ${h.harmonic_rhythm_avg ?? 0} changes/bar`);
  if ((h.top_chords ?? []).length > 0) {
    console.log(`    Top chords:      ${chalk.dim(h.top_chords.slice(0, 5).map(entry => `${entry.value}×${entry.count}`).join('  '))}`);
  }
  if ((h.top_progressions ?? []).length > 0) {
    console.log(`    Progressions:    ${chalk.dim(h.top_progressions.slice(0, 5).map(entry => `${entry.value}×${entry.count}`).join('  '))}`);
  }
  if ((h.top_bass_root_motion ?? []).length > 0) {
    console.log(`    Bass motion:     ${chalk.dim(h.top_bass_root_motion.slice(0, 5).map(entry => `${entry.value}×${entry.count}`).join('  '))}`);
  }
  console.log('');
}

function printRhythmProfile(profile) {
  const r = profile?.rhythm;
  if (!r) return;

  console.log(chalk.cyan('  Rhythm fingerprint'));
  console.log(`    Avg section density: ${r.avg_section_density ?? 0} notes/bar`);

  const trackEntries = Object.entries(r.by_track ?? {}).slice(0, 6);
  for (const [track, info] of trackEntries) {
    const topSteps = (info.onset_histogram_16 ?? [])
      .map((value, index) => ({ index, value }))
      .sort((a, b) => b.value - a.value)
      .slice(0, 4)
      .map(entry => entry.index)
      .join(', ');
    const dominantPatterns = (info.dominant_patterns_16 ?? [])
      .slice(0, 2)
      .map(entry => `${entry.value}×${entry.count}`)
      .join('  ');
    console.log(`    ${track.padEnd(12)} npb ${String(info.notes_per_bar ?? 0).padEnd(4)}  sync ${String(info.syncopation ?? 0).padEnd(4)}  top steps [${topSteps}]${dominantPatterns ? `  patterns ${chalk.dim(dominantPatterns)}` : ''}`);
  }
  console.log('');
}

function printArrangementProfile(profile) {
  const a = profile?.arrangement;
  if (!a) return;

  console.log(chalk.cyan('  Arrangement fingerprint'));
  if (a.avg_active_tracks_per_section != null) {
    console.log(`    Avg active tracks/section: ${a.avg_active_tracks_per_section}`);
  }
  if (a.avg_section_energy != null) {
    console.log(`    Avg section energy:        ${a.avg_section_energy}`);
  }

  const entryOrder = Object.entries(a.entry_order ?? {}).slice(0, 8);
  for (const [track, entry] of entryOrder) {
    const value = entry.first_section_name
      ? `${entry.first_section_name} (#${entry.first_section_index})`
      : entry.avg_first_section_index != null
        ? `avg #${entry.avg_first_section_index}`
        : 'n/a';
    console.log(`    ${track.padEnd(12)} enters ${value}`);
  }

  if ((a.top_layer_combinations ?? []).length > 0) {
    console.log(`    Layer combos: ${chalk.dim(a.top_layer_combinations.slice(0, 4).map(entry => `${entry.value}×${entry.count}`).join('  '))}`);
  }
  console.log('');
}

async function saveIfRequested(profileSet, options, fallbackTarget) {
  const coreProfile = profileSet.core;
  if (!options.out && !options.print) {
    const { paths, bundlePath } = await saveProfileSetWithBundle({
      profiles: profileSet,
      options,
      fallbackTarget: fallbackTarget
        .replace(/.*\//, '')
        .replace(/\.json$/, ''),
      defaultScope: coreProfile._meta?.scope || 'song',
      writeBundle: true,
    });
    for (const [domain, path] of Object.entries(paths)) {
      console.log(chalk.green(`✓ ${domain[0].toUpperCase() + domain.slice(1)} profile saved to ${path}`));
    }
    if (bundlePath) {
      console.log(chalk.green(`✓ Bundle saved to ${bundlePath}`));
      console.log(chalk.dim('  Use with: ableton-composer generate "<prompt>" --style ' + bundlePath));
    } else {
      console.log(chalk.dim('  Use with: ableton-composer generate "<prompt>" --style ' + paths.core));
    }
    return;
  }

  if (options.out) {
    const outPath = options.out.startsWith('/') ? options.out : join(process.cwd(), options.out);
    const { mkdir } = await import('fs/promises');
    await mkdir(outPath.replace(/\/[^/]+$/, ''), { recursive: true });
    await writeFile(outPath, JSON.stringify(coreProfile, null, 2), 'utf-8');
    console.log(chalk.green(`✓ Core profile saved to ${outPath}`));
  }

  if (options.print) {
    console.log(JSON.stringify(coreProfile, null, 2));
  }
}
