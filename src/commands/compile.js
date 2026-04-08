/**
 * compile command — merges a set directory into a single flat song JSON.
 *
 * Usage:
 *   ableton-composer compile sets/idm-g-minor/
 *   ableton-composer compile sets/idm-g-minor/ --out sets/idm-g-minor-full.json
 */

import chalk from 'chalk';
import { join, basename } from 'path';
import { loadSetDirectory, isSetDirectory, saveSong, listSectionFiles, writeSongFile } from '../lib/storage.js';

export async function compileCommand(dirOrName, options) {
  try {
    const dirPath = dirOrName.startsWith('/')
      ? dirOrName
      : join(process.cwd(), dirOrName);

    const isDir = await isSetDirectory(dirPath);
    if (!isDir) {
      console.error(chalk.red(`✗ "${dirOrName}" is not a set directory (no meta.json found).`));
      process.exit(1);
    }

    const song = await loadSetDirectory(dirPath);
    const sections = await listSectionFiles(dirPath);

    // Write output
    let outPath;
    if (options.out) {
      outPath = options.out.startsWith('/') ? options.out : join(process.cwd(), options.out);
      await writeSongFile(outPath, song);
    } else {
      // Save next to the directory with a timestamp
      const nameHint = `${basename(dirPath)}`;
      outPath = await saveSong(song, nameHint);
    }

    console.log(chalk.green(`✓ Compiled ${sections.length} section(s) → ${outPath}`));
    console.log('');

    for (const s of song.sections) {
      const noteCount = s.tracks.reduce((n, t) => n + t.clip.notes.length, 0);
      console.log(chalk.dim(`  ${s.name}: ${s.tracks.length} tracks, ${noteCount} notes`));
    }

  } catch (err) {
    console.error(chalk.red(`✗ ${err.message}`));
    process.exit(1);
  }
}
