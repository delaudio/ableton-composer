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

  // If it looks like a saved profile JSON (in profiles/ or ends with .json and
  // has a _meta.source key), load it directly
  if (target.endsWith('.json')) {
    try {
      const { readFile } = await import('fs/promises');
      const raw = await readFile(abs, 'utf-8');
      const parsed = JSON.parse(raw);
      // A style profile has _meta.source; a song JSON has meta.bpm
      if (parsed._meta?.source !== undefined) return parsed;
    } catch { /* fall through to loadSong */ }
  }

  // Otherwise treat as a set path and analyze on the fly
  const { song, filepath } = await loadSong(target);
  return analyzeSong(song, filepath);
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
