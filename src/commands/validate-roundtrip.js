import chalk from 'chalk';
import { join } from 'path';
import { mkdir, writeFile } from 'fs/promises';
import { loadSong } from '../lib/storage.js';
import { validateRoundtrip } from '../lib/roundtrip.js';

export async function validateRoundtripCommand(fileOrName, options) {
  try {
    const via = normalizeVia(options.via);
    const { song, filepath, isDirectory } = await loadSong(fileOrName);
    const report = await validateRoundtrip(song, { via });

    printReport(report, filepath, isDirectory);

    if (options.out) {
      const outPath = options.out.startsWith('/') ? options.out : join(process.cwd(), options.out);
      await mkdir(join(outPath, '..'), { recursive: true }).catch(() => {});
      await writeFile(outPath, JSON.stringify(report, null, 2), 'utf-8');
      console.log(chalk.green(`\n✓ Report saved to ${outPath}`));
    }
  } catch (err) {
    console.error(chalk.red(`✗ ${err.message}`));
    process.exit(1);
  }
}

function normalizeVia(via) {
  const value = String(via || '').toLowerCase();
  if (value === 'midi' || value === 'musicxml' || value === 'mxl') return value;
  throw new Error(`Unsupported --via value: ${via}. Use midi, musicxml, or mxl.`);
}

function printReport(report, filepath, isDirectory) {
  const cmp = report.comparison;
  const noteScore = cmp.note_match_pct >= 90 ? chalk.green(`${cmp.note_match_pct}%`) : cmp.note_match_pct >= 70 ? chalk.yellow(`${cmp.note_match_pct}%`) : chalk.red(`${cmp.note_match_pct}%`);
  const trackScore = cmp.track_name_overlap_pct >= 90 ? chalk.green(`${cmp.track_name_overlap_pct}%`) : cmp.track_name_overlap_pct >= 70 ? chalk.yellow(`${cmp.track_name_overlap_pct}%`) : chalk.red(`${cmp.track_name_overlap_pct}%`);

  console.log(chalk.bold(`\n Round-Trip Validation`));
  console.log(chalk.dim(`  source: ${filepath}${isDirectory ? '/' : ''}`));
  console.log(chalk.dim(`  via:    ${report.format}\n`));

  console.log(chalk.cyan('  Source'));
  console.log(`    sections: ${report.source.sections}`);
  console.log(`    tracks:   ${report.source.tracks.join(', ') || '(none)'}`);
  console.log(`    notes:    ${report.source.note_count}`);
  console.log(`    bpm:      ${report.source.bpm}`);
  console.log(`    sig:      ${report.source.time_signature}`);

  console.log(chalk.cyan('\n  Imported'));
  console.log(`    sections: ${report.imported.sections}`);
  console.log(`    tracks:   ${report.imported.tracks.join(', ') || '(none)'}`);
  console.log(`    notes:    ${report.imported.note_count}`);
  console.log(`    bpm:      ${report.imported.bpm}`);
  console.log(`    sig:      ${report.imported.time_signature}`);

  console.log(chalk.cyan('\n  Comparison'));
  console.log(`    note match:       ${noteScore}`);
  console.log(`    track overlap:    ${trackScore}`);
  console.log(`    bpm match:        ${cmp.bpm_match ? chalk.green('yes') : chalk.red('no')}`);
  console.log(`    time sig match:   ${cmp.time_signature_match ? chalk.green('yes') : chalk.red('no')}`);
  console.log(`    note delta:       ${cmp.note_count_delta > 0 ? '+' : ''}${cmp.note_count_delta}`);
  console.log(`    section delta:    ${cmp.section_count_delta > 0 ? '+' : ''}${cmp.section_count_delta}`);
  console.log(`    missing tracks:   ${cmp.missing_tracks.join(', ') || '(none)'}`);
  console.log(`    extra tracks:     ${cmp.extra_tracks.join(', ') || '(none)'}`);
  console.log(`    pitch mismatches: ${cmp.pitch_mismatch_count}`);
  console.log(`    time mismatches:  ${cmp.timing_mismatch_count}`);
  console.log(`    dur mismatches:   ${cmp.duration_mismatch_count}`);
  console.log('');
}
