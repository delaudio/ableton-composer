import chalk from 'chalk';
import ora from 'ora';
import { basename, join } from 'path';
import { exportSongToMusicXml } from '../lib/musicxml.js';
import { loadSong } from '../lib/storage.js';

export async function exportXmlCommand(fileOrName, options) {
  const spinner = ora();

  try {
    spinner.start(`Loading ${fileOrName}...`);
    const { song, filepath, isDirectory } = await loadSong(fileOrName);
    spinner.succeed(`Loaded: ${filepath}${isDirectory ? '/' : ''}`);

    const outPath = options.out
      ? (options.out.startsWith('/') ? options.out : join(process.cwd(), options.out))
      : undefined;

    spinner.start(`Exporting ${basename(filepath)} to MusicXML...`);
    const { outPath: savedPath } = await exportSongToMusicXml(song, outPath);
    spinner.succeed(`Exported to ${savedPath}`);

    console.log(chalk.bold(`\n  ${song.meta?.genre || song.sections?.[0]?.name || 'Song'}`));
    console.log(chalk.dim(`  BPM: ${song.meta?.bpm || 'n/a'}`));
    console.log(chalk.dim(`  Time signature: ${song.meta?.time_signature || '4/4'}`));
    console.log(chalk.dim(`  Scale: ${song.meta?.scale || 'C major'}`));
    console.log(chalk.dim(`  Sections: ${song.sections?.length || 0}`));
    console.log(chalk.green(`\n✓ Saved to ${savedPath}`));
  } catch (err) {
    spinner.fail(err.message);
    process.exit(1);
  }
}
