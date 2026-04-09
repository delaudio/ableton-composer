import chalk from 'chalk';
import { mkdir, writeFile } from 'fs/promises';
import { dirname, join } from 'path';
import { buildSongReport, renderSongReportMarkdown } from '../lib/report.js';
import { loadSong, slugify } from '../lib/storage.js';

export async function reportCommand(fileOrName, options) {
  try {
    const { song, filepath, isDirectory } = await loadSong(fileOrName);
    const report = buildSongReport(song, `${filepath}${isDirectory ? '/' : ''}`);
    const markdown = renderSongReportMarkdown(report);
    const outPath = resolveReportPath(report.summary.title, options.out);

    await mkdir(dirname(outPath), { recursive: true });
    await writeFile(outPath, markdown, 'utf-8');

    console.log(chalk.green(`✓ Report saved to ${outPath}`));
    console.log(chalk.bold(`\n  ${report.summary.title}`));
    console.log(chalk.dim(`  Source:   ${filepath}${isDirectory ? '/' : ''}`));
    console.log(chalk.dim(`  Sections: ${report.summary.sections}`));
    console.log(chalk.dim(`  Tracks:   ${report.summary.tracks}`));
    console.log(chalk.dim(`  Notes:    ${report.summary.notes}`));
  } catch (err) {
    console.error(chalk.red(`✗ ${err.message}`));
    process.exit(1);
  }
}

function resolveReportPath(title, outPath) {
  if (outPath) {
    return outPath.startsWith('/') ? outPath : join(process.cwd(), outPath);
  }

  const base = slugify(title || 'song-report') || 'song-report';
  return join(process.cwd(), 'reports', `${base}.md`);
}
