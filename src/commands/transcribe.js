import chalk from 'chalk';
import ora from 'ora';
import { createHash } from 'crypto';
import { readFile } from 'fs/promises';
import { basename, extname, join } from 'path';
import { createProvenance } from '../lib/provenance.js';
import { importMidiFromFile } from './import-midi-runtime.js';
import { ensureAudioInput, resolveBasicPitchBinary, resolveMidiOutputPath, runBasicPitchCli } from '../lib/basic-pitch.js';
import { saveSetDirectory, saveSong, writeSongFile } from '../lib/storage.js';

export async function transcribeCommand(audioFile, options) {
  const spinner = ora();

  try {
    const engine = String(options.engine || 'basic-pitch').toLowerCase();
    if (engine !== 'basic-pitch') {
      throw new Error(`Unsupported transcription engine: ${engine}. Currently only "basic-pitch" is implemented.`);
    }

    const audioPath = await ensureAudioInput(audioFile);
    const binary = await resolveBasicPitchBinary(options.basicPitchBin);
    const midiOutPath = resolveMidiOutputPath(audioPath, options.out);
    const logPath = join(process.cwd(), 'transcriptions', 'logs', 'basic-pitch.log');

    console.log(chalk.bold(`\n  ${basename(audioPath)}`));
    console.log(chalk.dim(`  Engine:   basic-pitch (${binary})`));
    console.log(chalk.dim(`  MIDI out: ${midiOutPath}`));
    if (options.toSet) console.log(chalk.dim(`  Set out:  ${options.toSet}`));

    if (options.dryRun) {
      console.log(chalk.yellow('\nDRY RUN — Basic Pitch will not be executed.\n'));
      console.log(chalk.dim(`  ${binary} ${join(process.cwd(), 'midis')} ${audioPath}`));
      return;
    }

    spinner.start('Running Basic Pitch transcription...');
    const run = await runBasicPitchCli({
      binary,
      audioPath,
      midiOutPath,
      logPath,
    });
    spinner.succeed(`Transcribed to MIDI → ${run.midiPath}`);

    console.log(chalk.dim(`  Log: ${logPath}`));

    if (options.toSet) {
      spinner.start('Importing transcribed MIDI into AbletonSong...');
      const song = await importMidiFromFile(run.midiPath);
      const sourceHash = await hashFile(audioPath);
      song.meta.provenance = createProvenance({
        sourceType: 'transcribed-audio',
        operation: 'transcribe-audio',
        sourcePath: audioPath,
        sourceFormat: extname(audioPath).replace(/^\./, '').toLowerCase() || 'audio',
        details: {
          engine: 'basic-pitch',
          source_hash: sourceHash,
          output: run.midiPath,
          tracks: song.sections?.[0]?.tracks?.map(track => track.ableton_name) || [],
          sections: song.sections?.length || 0,
        },
      });
      song.meta.description = `Transcribed from ${basename(audioPath)} via Basic Pitch.`;

      const writtenSet = await saveSongOutput(song, options.toSet);
      spinner.succeed(`Imported transcription to ${writtenSet}`);
    }
  } catch (err) {
    spinner.fail(err.message);
    process.exit(1);
  }
}

async function saveSongOutput(song, outPath) {
  if (!outPath) return saveSong(song, song.sections?.[0]?.name || 'transcription');

  const resolved = outPath.startsWith('/') ? outPath : join(process.cwd(), outPath);
  const saveDir = outPath.endsWith('/') || !outPath.endsWith('.json');

  if (saveDir) {
    await saveSetDirectory(song, resolved);
    return `${resolved}/`;
  }

  await writeSongFile(resolved, song);
  return resolved;
}

async function hashFile(pathname) {
  const buffer = await readFile(pathname);
  return createHash('sha256').update(buffer).digest('hex').slice(0, 16);
}
