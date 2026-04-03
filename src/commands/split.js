/**
 * split command — converts a flat song JSON into a set directory.
 *
 * Usage:
 *   ableton-composer split sets/idm-g-minor-110bpm_2026-04-03.json
 *   ableton-composer split sets/idm-g-minor-110bpm_2026-04-03.json --out sets/idm-g-minor
 */

import chalk from 'chalk';
import { loadSong, saveSetDirectory, sectionFilename } from '../lib/storage.js';
import { join, basename } from 'path';

export async function splitCommand(fileOrName, options) {
  try {
    const { song, filepath } = await loadSong(fileOrName);

    if (!song.meta || !song.sections) {
      console.log(chalk.red('✗ File does not look like a full AbletonSong (missing meta or sections).'));
      process.exit(1);
    }

    // Determine output directory
    const outDir = options.out
      ? (options.out.startsWith('/') ? options.out : join(process.cwd(), options.out))
      : filepath.replace(/(_\d{4}-\d{2}-\d{2}T[\d-]+)?\.json$/, '');

    await saveSetDirectory(song, outDir);

    console.log(chalk.green(`✓ Split into ${outDir}`));
    console.log('');
    console.log(chalk.dim('  meta.json'));
    for (let i = 0; i < song.sections.length; i++) {
      const s = song.sections[i];
      const noteCount = s.tracks.reduce((n, t) => n + t.clip.notes.length, 0);
      console.log(chalk.dim(`  ${sectionFilename(i, s.name)}  (${s.tracks.length} tracks, ${noteCount} notes)`));
    }
    console.log('');
    console.log(chalk.dim(`  Push a single section:  ableton-composer push ${outDir}/00-${song.sections[0]?.name ?? 'section'}.json`));
    console.log(chalk.dim(`  Push all sections:      ableton-composer push ${outDir}/`));

  } catch (err) {
    console.error(chalk.red(`✗ ${err.message}`));
    process.exit(1);
  }
}
