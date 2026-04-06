/**
 * compare command — diff two sets or profiles to measure style fidelity.
 *
 * Usage:
 *   ableton-composer compare sets/source/ sets/generated.json
 *   ableton-composer compare profiles/saw85-92.json sets/new-set.json
 *   ableton-composer compare sets/source/ sets/generated/ --print
 */

import chalk from 'chalk';
import { join } from 'path';
import { writeFile } from 'fs/promises';
import { loadSong } from '../lib/storage.js';
import { analyzeSong, compareProfiles } from '../lib/analysis.js';
import { loadStyleProfile } from '../lib/profiles.js';

export async function compareCommand(sourceArg, generatedArg, options) {
  try {
    const sourceProfile    = await loadProfile(sourceArg);
    const generatedProfile = await loadProfile(generatedArg);

    const report = compareProfiles(sourceProfile, generatedProfile);
    printReport(report, sourceArg, generatedArg);

    if (options.out) {
      const outPath = options.out.startsWith('/') ? options.out : join(process.cwd(), options.out);
      await writeFile(outPath, JSON.stringify(report, null, 2), 'utf-8');
      console.log(chalk.green(`✓ Report saved to ${outPath}`));
    }
  } catch (err) {
    console.error(chalk.red(`✗ ${err.message}`));
    process.exit(1);
  }
}

// ─── helpers ─────────────────────────────────────────────────────────────────

async function loadProfile(target) {
  const abs = target.startsWith('/') ? target : join(process.cwd(), target);

  // Saved profile or bundle JSON
  if (target.endsWith('.json') || target.endsWith('bundle.json')) {
    try {
      const loaded = await loadStyleProfile(abs);
      return normalizeComparableProfile(loaded.profile);
    } catch {
      try {
        const { readFile } = await import('fs/promises');
        const raw = await readFile(abs, 'utf-8');
        const parsed = JSON.parse(raw);
        if (parsed._meta || parsed.bpm_range || parsed.key_consensus) {
          return normalizeComparableProfile(parsed);
        }
      } catch {}
    }
  }

  // If it's a raw song json, treat as set path and analyze on the fly
  if (target.endsWith('.json')) {
    try {
      const { song, filepath } = await loadSong(target);
      return analyzeSong(song, filepath);
    } catch {}
  }

  // Otherwise treat as a set path and analyze on the fly
  const { song, filepath } = await loadSong(target);
  return analyzeSong(song, filepath);
}

function normalizeComparableProfile(profile) {
  if (profile?.bpm != null && profile?.key && profile?.arrangement?.track_presence) {
    return profile;
  }

  const rhythmByTrack = profile?.rhythm?.notes_per_bar
    ? profile.rhythm.notes_per_bar
    : Object.fromEntries(
      Object.entries(profile?.rhythm?.by_track ?? {}).map(([name, info]) => [name, info.notes_per_bar])
    );

  const pitchByTrack = profile?.pitch?.by_track ?? {};
  const chordsByTrack = profile?.pitch?.chords_by_track ?? {};

  return {
    _meta: profile._meta,
    bpm: profile?.bpm ?? profile?.bpm_range?.avg ?? null,
    key: profile?.key ?? profile?.key_consensus ?? 'unknown',
    structure: {
      section_count: profile?.structure?.section_count ?? profile?.structure?.section_count_range?.avg ?? null,
      bars_per_section: profile?.structure?.bars_per_section ?? profile?.structure?.bars_per_section_avg ?? null,
    },
    arrangement: {
      track_presence: profile?.arrangement?.track_presence ?? {},
      role_presence: profile?.arrangement?.role_presence ?? {},
    },
    rhythm: {
      notes_per_bar: rhythmByTrack ?? {},
      notes_per_bar_by_role: profile?.rhythm?.notes_per_bar_by_role ?? {},
    },
    pitch: {
      by_track: pitchByTrack,
      chords_by_track: chordsByTrack,
    },
  };
}

// ─── print ────────────────────────────────────────────────────────────────────

function printReport(r, srcLabel, genLabel) {
  console.log(chalk.bold(`\n Style Fidelity Report`));
  console.log(chalk.dim(`  source:    ${srcLabel}`));
  console.log(chalk.dim(`  generated: ${genLabel}\n`));

  // Overall score
  const score = r.fidelity_score;
  const scoreColor = score >= 80 ? chalk.green : score >= 55 ? chalk.yellow : chalk.red;
  const bar = '█'.repeat(Math.round(score / 10)) + '░'.repeat(10 - Math.round(score / 10));
  console.log(`  Fidelity   ${scoreColor(bar)}  ${scoreColor(`${score}%`)}\n`);

  // Key
  const keyOk = r.key.match ? chalk.green('✓') : r.key.mode_match ? chalk.yellow('~') : chalk.red('✗');
  console.log(chalk.cyan('  Key'));
  console.log(`    ${keyOk} ${r.key.source}  →  ${r.key.generated}${r.key.match ? '' : r.key.mode_match ? '  (same mode)' : '  (different key)'}`);

  // BPM
  if (r.bpm.source != null) {
    const bpmOk = r.bpm.delta === 0 ? chalk.green('✓') : chalk.yellow('~');
    const deltaStr = r.bpm.delta !== 0 ? chalk.dim(`  (${r.bpm.delta > 0 ? '+' : ''}${r.bpm.delta} BPM)`) : '';
    console.log(chalk.cyan('\n  BPM'));
    console.log(`    ${bpmOk} ${r.bpm.source}  →  ${r.bpm.generated}${deltaStr}`);
  }

  // Rhythm density
  const rhythmTracks = Object.keys(r.rhythm);
  if (rhythmTracks.length > 0) {
    console.log(chalk.cyan('\n  Rhythm density  (notes/bar: source → generated)'));
    for (const [t, d] of Object.entries(r.rhythm)) {
      const ratio    = d.ratio ?? 0;
      const ratioStr = d.ratio != null ? chalk.dim(` ×${d.ratio.toFixed(2)}`) : '';
      const icon     = ratio >= 0.75 && ratio <= 1.33 ? chalk.green('✓') : ratio >= 0.5 ? chalk.yellow('~') : chalk.red('✗');
      console.log(`    ${icon} ${t.padEnd(12)} ${d.source} → ${d.generated}${ratioStr}`);
    }
  }

  const rhythmRoles = Object.keys(r.rhythm_roles ?? {});
  if (rhythmRoles.length > 0) {
    console.log(chalk.cyan('\n  Rhythm by Role  (notes/bar: source → generated)'));
    for (const [role, d] of Object.entries(r.rhythm_roles)) {
      const ratio = d.ratio ?? 0;
      const ratioStr = d.ratio != null ? chalk.dim(` ×${d.ratio.toFixed(2)}`) : '';
      const icon = ratio >= 0.75 && ratio <= 1.33 ? chalk.green('✓') : ratio >= 0.5 ? chalk.yellow('~') : chalk.red('✗');
      console.log(`    ${icon} ${role.padEnd(12)} ${d.source} → ${d.generated}${ratioStr}`);
    }
  }

  const rolePresence = Object.keys(r.role_presence ?? {});
  if (rolePresence.length > 0) {
    console.log(chalk.cyan('\n  Role Presence  (% sections active: source → generated)'));
    for (const [role, d] of Object.entries(r.role_presence)) {
      const deltaAbs = Math.abs(d.delta);
      const icon = deltaAbs <= 20 ? chalk.green('✓') : deltaAbs <= 40 ? chalk.yellow('~') : chalk.red('✗');
      const deltaStr = chalk.dim(`  (${d.delta > 0 ? '+' : ''}${d.delta}%)`);
      console.log(`    ${icon} ${role.padEnd(12)} ${d.source}% → ${d.generated}%${deltaStr}`);
    }
  }

  // Pitch ranges
  const pitchTracks = Object.keys(r.pitch);
  if (pitchTracks.length > 0) {
    console.log(chalk.cyan('\n  Pitch range overlap'));
    for (const [t, d] of Object.entries(r.pitch)) {
      const icon = d.overlap_pct >= 75 ? chalk.green('✓') : d.overlap_pct >= 40 ? chalk.yellow('~') : chalk.red('✗');
      const bar  = '█'.repeat(Math.round(d.overlap_pct / 10)) + '░'.repeat(10 - Math.round(d.overlap_pct / 10));
      console.log(`    ${icon} ${t.padEnd(12)} ${bar}  ${d.overlap_pct}%  (src ${d.source.min}–${d.source.max} / gen ${d.generated.min}–${d.generated.max})`);
    }
  }

  // Chord vocabulary
  const chordTracks = Object.keys(r.chords);
  if (chordTracks.length > 0) {
    console.log(chalk.cyan('\n  Chord vocabulary overlap'));
    for (const [t, d] of Object.entries(r.chords)) {
      const icon    = d.overlap_pct >= 60 ? chalk.green('✓') : d.overlap_pct >= 30 ? chalk.yellow('~') : chalk.red('✗');
      const commonStr = d.common.length > 0 ? chalk.dim(` common: ${d.common.join(', ')}`) : chalk.dim(' no common chords');
      console.log(`    ${icon} ${t.padEnd(12)} ${d.overlap_pct}%${commonStr}`);
    }
  }

  console.log('');
}
