/**
 * list command — show saved sets in the /sets directory.
 *
 * Usage:
 *   ableton-composer list
 */

import chalk from 'chalk';
import { listSets, SETS_DIR } from '../lib/storage.js';

export async function listCommand() {
  const sets = await listSets();

  if (sets.length === 0) {
    console.log(chalk.dim(`No sets found in ${SETS_DIR}`));
    console.log(chalk.dim('Run `ableton-composer generate` to create one.'));
    return;
  }

  console.log(chalk.bold(`\n Saved sets (${sets.length})\n`));

  for (const s of sets) {
    const { filename, mtime, meta } = s;
    const age = formatAge(mtime);
    const info = [meta.genre, meta.bpm ? `${meta.bpm} BPM` : null, meta.scale]
      .filter(Boolean)
      .join(' · ');

    console.log(`  ${chalk.cyan(filename)}`);
    if (info) console.log(`  ${chalk.dim(info)}`);
    console.log(`  ${chalk.dim(age)}\n`);
  }

  console.log(chalk.dim(`Push a set: ableton-composer push <filename>`));
}

// ─── helpers ────────────────────────────────────────────────────────────────

function formatAge(date) {
  const diff = Date.now() - date.getTime();
  const minutes = Math.floor(diff / 60000);
  if (minutes < 1) return 'just now';
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  return `${days}d ago`;
}
