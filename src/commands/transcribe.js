import chalk from 'chalk';
import ora from 'ora';
import { createHash } from 'crypto';
import { readFile } from 'fs/promises';
import { basename, extname, join } from 'path';
import { createProvenance } from '../lib/provenance.js';
import { importMidiFromFile } from './import-midi-runtime.js';
import { ensureAudioInput, resolveBasicPitchBinary, resolveMidiOutputPath, runBasicPitchCli } from '../lib/basic-pitch.js';
import {
  ensureSeparationInput,
  findSeparationContext,
  resolveDemucsBinary,
  resolveSeparationOutputDir,
  resolveStemPathFromSeparation,
  runDemucsSeparation,
  SUPPORTED_SEPARATION_STEMS,
  writeSeparationMetadata,
} from '../lib/separation.js';
import { saveSetDirectory, saveSong, writeSongFile } from '../lib/storage.js';

export async function transcribeCommand(audioFile, options) {
  const spinner = ora();

  try {
    const engine = String(options.engine || 'basic-pitch').toLowerCase();
    if (engine !== 'basic-pitch') {
      throw new Error(`Unsupported transcription engine: ${engine}. Currently only "basic-pitch" is implemented.`);
    }

    const transcriptionInput = await resolveTranscriptionInput(audioFile, options, spinner);
    const audioPath = transcriptionInput.audioPath;
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
        originSourcePath: transcriptionInput.originSourcePath,
        originSourceFormat: transcriptionInput.originSourceFormat,
        originSourceHash: transcriptionInput.originSourceHash,
        stemName: transcriptionInput.stemName,
        separationMetadata: transcriptionInput.separationMetadataPath,
        details: {
          engine: 'basic-pitch',
          source_hash: sourceHash,
          origin_source_path: transcriptionInput.originSourcePath,
          origin_source_format: transcriptionInput.originSourceFormat,
          origin_source_hash: transcriptionInput.originSourceHash,
          stem_name: transcriptionInput.stemName,
          separation_metadata: transcriptionInput.separationMetadataPath,
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

async function resolveTranscriptionInput(audioFile, options, spinner) {
  if (!options.separateFirst) {
    const audioPath = await ensureAudioInput(audioFile);
    const separationContext = await findSeparationContext(audioPath);
    if (!separationContext) {
      return {
        audioPath,
        stemName: null,
        originSourcePath: null,
        originSourceFormat: null,
        originSourceHash: null,
        separationMetadataPath: null,
      };
    }

    return {
      audioPath,
      stemName: separationContext.stem?.name || null,
      originSourcePath: separationContext.metadata?.source_audio?.path || null,
      originSourceFormat: separationContext.metadata?.source_audio?.format || null,
      originSourceHash: separationContext.metadata?.source_audio?.hash || null,
      separationMetadataPath: separationContext.metadataPath,
    };
  }

  const requestedStem = String(options.stem || '').trim().toLowerCase();
  if (!requestedStem) {
    throw new Error(`--separate-first requires --stem <name>. Expected one of: ${SUPPORTED_SEPARATION_STEMS.join(', ')}.`);
  }
  if (!SUPPORTED_SEPARATION_STEMS.includes(requestedStem)) {
    throw new Error(`Unsupported stem for --separate-first: ${requestedStem}. Expected one of: ${SUPPORTED_SEPARATION_STEMS.join(', ')}.`);
  }

  const sourceAudioPath = await ensureSeparationInput(audioFile);
  const demucsBin = await resolveDemucsBinary(options.demucsBin);
  const separationOut = resolveSeparationOutputDir(sourceAudioPath, options.separationOut);
  const model = String(options.demucsModel || 'htdemucs').trim() || 'htdemucs';
  const separationLog = join(process.cwd(), 'separations', 'logs', 'demucs.log');

  spinner.start(`Separating source audio before transcription (${requestedStem})...`);
  const run = await runDemucsSeparation({
    binary: demucsBin,
    audioPath: sourceAudioPath,
    outputDir: separationOut,
    model,
    logPath: separationLog,
  });
  const separationMetadataPath = await writeSeparationMetadata({
    sourcePath: sourceAudioPath,
    engine: 'demucs',
    model,
    outputDir: separationOut,
    outputs: run.outputs,
  });
  spinner.succeed(`Separated source audio to ${separationOut}`);
  console.log(chalk.dim(`  Stem chosen: ${requestedStem}`));
  console.log(chalk.dim(`  Separation metadata: ${separationMetadataPath}`));

  const stemPath = resolveStemPathFromSeparation(separationOut, requestedStem);
  await ensureAudioInput(stemPath);

  return {
    audioPath: stemPath,
    stemName: requestedStem,
    originSourcePath: sourceAudioPath,
    originSourceFormat: extname(sourceAudioPath).replace(/^\./, '').toLowerCase() || 'audio',
    originSourceHash: await hashFile(sourceAudioPath),
    separationMetadataPath,
  };
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
