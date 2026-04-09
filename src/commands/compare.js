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
import { compareProfiles } from '../lib/analysis.js';
import { loadComparableProfile } from '../lib/comparison.js';

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
  return loadComparableProfile(target);
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

  if ((r.component_scores ?? []).length > 0) {
    console.log(chalk.cyan('  Score Components'));
    for (const item of r.component_scores) {
      const color = item.score >= 80 ? chalk.green : item.score >= 55 ? chalk.yellow : chalk.red;
      console.log(`    ${color(String(item.score).padStart(3) + '%')}  ${item.name.padEnd(18)} ${chalk.dim(`weight ${Math.round(item.weight * 100)}%`)}`);
    }
    console.log('');
  }

  if (r.context?.aggregate_source) {
    console.log(chalk.dim('  Aggregate source: scoring emphasizes role presence, structure, and role-level rhythm over exact track matches.\n'));
  }

  if (r.structure) {
    const countIcon = r.structure.section_count.score >= 80 ? chalk.green('✓') : r.structure.section_count.score >= 55 ? chalk.yellow('~') : chalk.red('✗');
    const barsIcon = r.structure.bars_per_section.score >= 80 ? chalk.green('✓') : r.structure.bars_per_section.score >= 55 ? chalk.yellow('~') : chalk.red('✗');
    console.log(chalk.cyan('  Structure'));
    console.log(`    ${countIcon} sections        ${r.structure.section_count.source_label} → ${r.structure.section_count.generated}`);
    console.log(`    ${barsIcon} bars/section    ${r.structure.bars_per_section.source_label} → ${r.structure.bars_per_section.generated}`);
  }

  // Key
  const keyOk = r.key.match ? chalk.green('✓') : r.key.mode_match ? chalk.yellow('~') : chalk.red('✗');
  console.log(chalk.cyan('\n  Key'));
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
