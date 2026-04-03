/**
 * list command — show saved sets in the /sets directory.
 * Shows both flat JSON files and set directories.
 */

import chalk from 'chalk';
import { listSets, SETS_DIR } from '../lib/storage.js';

export async function listCommand() {
  const sets = await listSets();

  if (sets.length === 0) {
    console.log(chalk.dim(`No sets found in ${SETS_DIR}`));
    console.log(chalk.dim('Run `ableton-composer generate` or `ableton-composer pull` to create one.'));
    return;
  }

  console.log(chalk.bold(`\n Saved sets (${sets.length})\n`));

  for (const s of sets) {
    const { filename, mtime, meta, isDirectory, sectionCount } = s;
    const age  = formatAge(mtime);
    const info = [meta.genre, meta.bpm ? `${meta.bpm} BPM` : null, meta.scale]
      .filter(Boolean).join(' · ');

    if (isDirectory) {
      console.log(`  ${chalk.cyan(filename + '/')} ${chalk.dim('[directory]')}`);
      if (info) console.log(`  ${chalk.dim(info)}`);
      if (sectionCount) console.log(`  ${chalk.dim(`${sectionCount} section file(s)`)}`);
    } else {
      console.log(`  ${chalk.cyan(filename)}`);
      if (info) console.log(`  ${chalk.dim(info)}`);
    }
    console.log(`  ${chalk.dim(age)}\n`);
  }

  console.log(chalk.dim('  Push:    ableton-composer push <name>'));
  console.log(chalk.dim('  Split:   ableton-composer split <file.json>'));
  console.log(chalk.dim('  Compile: ableton-composer compile <dir/>'));
}

function formatAge(date) {
  const diff = Date.now() - date.getTime();
  const minutes = Math.floor(diff / 60000);
  if (minutes < 1) return 'just now';
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  return `${Math.floor(hours / 24)}d ago`;
}
