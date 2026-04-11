import chalk from 'chalk';
import ora from 'ora';
import { createHash } from 'crypto';
import { readFile } from 'fs/promises';
import { basename, extname, join } from 'path';
import { createProvenance } from '../lib/provenance.js';
import { importMidiFromFile } from './import-midi-runtime.js';
import { importXmlFromFile } from './import-xml-runtime.js';
import { pushCommand } from './push.js';
import { ensureAudioInput, resolveBasicPitchBinary, resolveMidiOutputPath, runBasicPitchCli } from '../lib/basic-pitch.js';
import {
  copyKlangioArtifacts,
  resolveKlangioApiKey,
  resolveKlangioBaseUrl,
  resolveKlangioCacheDir,
  resolveKlangioFormats,
  resolveMusicXmlOutputPath,
  runKlangioTranscription,
} from '../lib/klangio.js';
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
    validateStemOptions(options);

    if (options.separateFirst && wantsMultiStemWorkflow(options)) {
      await runMultiStemWorkflow(audioFile, options, engine, spinner);
      return;
    }

    const transcriptionInput = await resolveTranscriptionInput(audioFile, options, spinner);
    const audioPath = transcriptionInput.audioPath;
    const result = await runTranscriptionEngine(audioPath, options, spinner, engine);

    if (options.dryRun) {
      if (options.toSet || options.push) {
        console.log(chalk.dim('  Dry run stops before AbletonSong import and push.'));
      }
      return;
    }

    if (options.toSet || options.push) {
      spinner.start(`Importing transcribed ${result.importFormat.toUpperCase()} into AbletonSong...`);
      const song = result.importFormat === 'musicxml'
        ? await importXmlFromFile(result.importPath)
        : await importMidiFromFile(result.importPath);
      const sourceHash = await hashFile(audioPath);
      song.meta.provenance = createProvenance({
        sourceType: 'transcribed-audio',
        operation: 'transcribe-audio',
        engine,
        sourcePath: audioPath,
        sourceFormat: extname(audioPath).replace(/^\./, '').toLowerCase() || 'audio',
        originSourcePath: transcriptionInput.originSourcePath,
        originSourceFormat: transcriptionInput.originSourceFormat,
        originSourceHash: transcriptionInput.originSourceHash,
        stemName: transcriptionInput.stemName,
        separationMetadata: transcriptionInput.separationMetadataPath,
        details: {
          engine,
          source_hash: sourceHash,
          origin_source_path: transcriptionInput.originSourcePath,
          origin_source_format: transcriptionInput.originSourceFormat,
          origin_source_hash: transcriptionInput.originSourceHash,
          stem_name: transcriptionInput.stemName,
          separation_metadata: transcriptionInput.separationMetadataPath,
          output: result.importPath,
          output_midi: result.midiPath || null,
          output_musicxml: result.musicXmlPath || null,
          cache_metadata: result.cacheMetadataPath || null,
          tracks: song.sections?.[0]?.tracks?.map(track => track.ableton_name) || [],
          sections: song.sections?.length || 0,
        },
      });
      song.meta.description = `Transcribed from ${basename(audioPath)} via ${result.engineLabel}.`;

      const writtenSet = await saveSongOutput(song, options.toSet);
      spinner.succeed(`Imported transcription to ${writtenSet}`);

      if (options.push) {
        await pushTranscribedSet(writtenSet, options);
      }
    }
  } catch (err) {
    spinner.fail(err.message);
    process.exit(1);
  }
}

async function runMultiStemWorkflow(audioFile, options, engine, spinner) {
  const requestedStems = resolveRequestedStems(options);
  const sourceAudioPath = await ensureSeparationInput(audioFile);
  const demucsBin = await resolveDemucsBinary(options.demucsBin);
  const separationOut = resolveSeparationOutputDir(sourceAudioPath, options.separationOut);
  const model = String(options.demucsModel || 'htdemucs').trim() || 'htdemucs';
  const separationLog = join(process.cwd(), 'separations', 'logs', 'demucs.log');

  spinner.start(`Separating source audio before transcription (${requestedStems.join(', ')})...`);
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
  console.log(chalk.dim(`  Stems: ${requestedStems.join(', ')}`));
  console.log(chalk.dim(`  Separation metadata: ${separationMetadataPath}`));

  const imported = [];
  for (const stemName of requestedStems) {
    const stemPath = resolveStemPathFromSeparation(separationOut, stemName);
    await ensureAudioInput(stemPath);
    const perStemOptions = buildStemEngineOptions(options, sourceAudioPath, stemName);
    const result = await runTranscriptionEngine(stemPath, perStemOptions, spinner, engine);
    if (options.dryRun) continue;
    spinner.start(`Importing ${stemName} transcription into AbletonSong...`);
    const song = result.importFormat === 'musicxml'
      ? await importXmlFromFile(result.importPath)
      : await importMidiFromFile(result.importPath);
    spinner.succeed(`Imported ${stemName} transcription`);
    imported.push({ stemName, stemPath, song, result });
  }

  if (options.dryRun) {
    console.log(chalk.dim('  Dry run stops before AbletonSong merge and push.'));
    return;
  }

  spinner.start('Merging transcribed stems into a single AbletonSong...');
  const mergedSong = await mergeStemSongs({
    imported,
    engine,
    sourceAudioPath,
    separationMetadataPath,
  });
  const writtenSet = await saveSongOutput(mergedSong, options.toSet);
  spinner.succeed(`Saved merged stem transcription to ${writtenSet}`);

  if (options.push) {
    await pushTranscribedSet(writtenSet, options);
  }
}

async function runBasicPitchEngine(audioPath, options, spinner) {
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
    return {
      engineLabel: 'Basic Pitch',
      importFormat: 'midi',
      importPath: midiOutPath,
      midiPath: midiOutPath,
      musicXmlPath: null,
      cacheMetadataPath: null,
    };
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

  return {
    engineLabel: 'Basic Pitch',
    importFormat: 'midi',
    importPath: run.midiPath,
    midiPath: run.midiPath,
    musicXmlPath: null,
    cacheMetadataPath: null,
  };
}

async function runKlangioEngine(audioPath, options, spinner) {
  const apiKey = await resolveKlangioApiKey(options.klangioApiKey);
  const baseUrl = resolveKlangioBaseUrl(options.klangioBaseUrl);
  const cacheDir = resolveKlangioCacheDir(options.klangioCacheDir);
  const formats = resolveKlangioFormats(options);
  const midiOutPath = formats.includes('midi') ? resolveMidiOutputPath(audioPath, options.out) : null;
  const musicXmlOutPath = formats.includes('musicxml') ? resolveMusicXmlOutputPath(audioPath, options.xmlOut) : null;
  const logPath = join(process.cwd(), 'transcriptions', 'logs', 'klangio.log');

  console.log(chalk.bold(`\n  ${basename(audioPath)}`));
  console.log(chalk.dim(`  Engine:   klangio (${baseUrl})`));
  console.log(chalk.dim(`  Mode:     ${String(options.klangioMode || 'universal').trim() || 'universal'}`));
  console.log(chalk.dim(`  Formats:  ${formats.join(', ')}`));
  console.log(chalk.dim(`  Cache:    ${cacheDir}`));
  if (midiOutPath) console.log(chalk.dim(`  MIDI out: ${midiOutPath}`));
  if (musicXmlOutPath) console.log(chalk.dim(`  XML out:  ${musicXmlOutPath}`));
  if (options.toSet) console.log(chalk.dim(`  Set out:  ${options.toSet}`));

  if (options.dryRun) {
    console.log(chalk.yellow('\nDRY RUN — Klangio will not be executed.\n'));
    console.log(chalk.dim(`  POST ${baseUrl}/jobs`));
    return {
      engineLabel: 'Klangio',
      importFormat: options.preferMusicxml ? 'musicxml' : 'midi',
      importPath: options.preferMusicxml ? musicXmlOutPath : midiOutPath,
      midiPath: midiOutPath,
      musicXmlPath: musicXmlOutPath,
      cacheMetadataPath: null,
    };
  }

  spinner.start('Running Klangio transcription...');
  const run = await runKlangioTranscription({
    apiKey,
    baseUrl,
    audioPath,
    formats,
    mode: String(options.klangioMode || 'universal').trim() || 'universal',
    cacheDir,
    refreshCache: Boolean(options.refreshCache),
    pollMs: Number(options.klangioPollMs || 3000),
    timeoutMs: Number(options.klangioTimeoutMs || 300000),
    logPath,
  });
  const copied = await copyKlangioArtifacts(run, { midiOutPath, musicXmlOutPath });
  spinner.succeed(run.cached ? 'Reused cached Klangio transcription' : `Klangio transcription complete${copied.midiPath ? ` → ${copied.midiPath}` : ''}`);

  console.log(chalk.dim(`  Cache metadata: ${run.metadataPath}`));
  console.log(chalk.dim(`  Log: ${logPath}`));

  const importFormat = resolveImportFormat({
    preferMusicxml: options.preferMusicxml,
    musicXmlPath: copied.musicXmlPath,
    midiPath: copied.midiPath,
  });
  const importPath = importFormat === 'musicxml' ? copied.musicXmlPath : copied.midiPath;

  return {
    engineLabel: 'Klangio',
    importFormat,
    importPath,
    midiPath: copied.midiPath || null,
    musicXmlPath: copied.musicXmlPath || null,
    cacheMetadataPath: run.metadataPath,
  };
}

async function runTranscriptionEngine(audioPath, options, spinner, engine) {
  if (engine === 'basic-pitch') {
    return runBasicPitchEngine(audioPath, options, spinner);
  }
  if (engine === 'klangio') {
    return runKlangioEngine(audioPath, options, spinner);
  }
  throw new Error(`Unsupported transcription engine: ${engine}. Currently supported: basic-pitch, klangio.`);
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

function resolveImportFormat({ preferMusicxml, musicXmlPath, midiPath }) {
  if (preferMusicxml && musicXmlPath) return 'musicxml';
  if (midiPath) return 'midi';
  if (musicXmlPath) return 'musicxml';
  throw new Error('No usable Klangio symbolic output was generated.');
}

function validateStemOptions(options) {
  if (options.stem && options.stems) {
    throw new Error('Use either --stem <name> or --stems <names>, not both.');
  }
  if (options.stem && options.allStems) {
    throw new Error('Use either --stem <name> or --all-stems, not both.');
  }
  if (options.stems && options.allStems) {
    throw new Error('Use either --stems <names> or --all-stems, not both.');
  }
  if ((options.stems || options.allStems) && !options.separateFirst) {
    throw new Error('--stems and --all-stems require --separate-first.');
  }
}

function wantsMultiStemWorkflow(options) {
  return Boolean(options.stems || options.allStems);
}

function resolveRequestedStems(options) {
  if (options.allStems) return [...SUPPORTED_SEPARATION_STEMS];

  const stems = String(options.stems || '')
    .split(',')
    .map(name => name.trim().toLowerCase())
    .filter(Boolean);

  if (stems.length === 0) {
    throw new Error(`--stems requires at least one stem name. Expected one or more of: ${SUPPORTED_SEPARATION_STEMS.join(', ')}.`);
  }

  const invalid = stems.filter(name => !SUPPORTED_SEPARATION_STEMS.includes(name));
  if (invalid.length > 0) {
    throw new Error(`Unsupported stems: ${invalid.join(', ')}. Expected one or more of: ${SUPPORTED_SEPARATION_STEMS.join(', ')}.`);
  }

  return [...new Set(stems)];
}

function buildStemEngineOptions(options, sourceAudioPath, stemName) {
  return {
    ...options,
    out: resolvePerStemOutputPath(options.out, sourceAudioPath, stemName, '.mid'),
    xmlOut: options.xmlOut || options.preferMusicxml
      ? resolvePerStemOutputPath(options.xmlOut, sourceAudioPath, stemName, '.musicxml')
      : null,
    toSet: null,
    push: false,
    separateFirst: false,
    stem: stemName,
    stems: null,
    allStems: false,
  };
}

function resolvePerStemOutputPath(basePath, sourceAudioPath, stemName, extension) {
  const sourceStem = basename(sourceAudioPath, extname(sourceAudioPath));

  if (!basePath) {
    const root = extension === '.mid' ? 'midis' : 'transcriptions';
    return join(process.cwd(), root, slugStem(sourceStem), `${stemName}${extension}`);
  }

  const resolved = basePath.startsWith('/') ? basePath : join(process.cwd(), basePath);
  if (resolved.toLowerCase().endsWith(extension)) {
    throw new Error(`Multi-stem transcription requires ${extension} outputs to point to a directory, not a single file: ${basePath}`);
  }
  return join(resolved, `${stemName}${extension}`);
}

async function mergeStemSongs({ imported, engine, sourceAudioPath, separationMetadataPath }) {
  if (imported.length === 0) {
    throw new Error('No stem transcriptions were produced.');
  }

  const sourceName = basename(sourceAudioPath, extname(sourceAudioPath));
  const sourceHash = await hashFile(sourceAudioPath);
  const templateSong = imported[0].song;
  const timeSignature = templateSong.meta?.time_signature || '4/4';
  const bpm = templateSong.meta?.bpm || 120;
  const bars = Math.max(
    1,
    ...imported.map(entry => Number(entry.song.sections?.[0]?.bars || 0)),
    ...imported.flatMap(entry => (entry.song.sections?.[0]?.tracks || []).map(track => Number(track.clip?.length_bars || 0))),
  );

  const tracks = imported.flatMap(entry =>
    renameStemTracks(entry.song.sections?.[0]?.tracks || [], entry.stemName)
  );

  return {
    meta: {
      bpm,
      scale: '',
      genre: '',
      time_signature: timeSignature,
      description: `Merged stem transcription from ${basename(sourceAudioPath)} via ${imported.map(entry => entry.result.engineLabel).join(', ')}.`,
      provenance: createProvenance({
        sourceType: 'transcribed-audio-stems',
        operation: 'transcribe-audio-stems',
        engine,
        sourcePath: sourceAudioPath,
        sourceFormat: extname(sourceAudioPath).replace(/^\./, '').toLowerCase() || 'audio',
        separationMetadata: separationMetadataPath,
        details: {
          source_hash: sourceHash,
          stems: imported.map(entry => ({
            stem_name: entry.stemName,
            source_path: entry.stemPath,
            import_format: entry.result.importFormat,
            output_midi: entry.result.midiPath || null,
            output_musicxml: entry.result.musicXmlPath || null,
            cache_metadata: entry.result.cacheMetadataPath || null,
            tracks: (entry.song.sections?.[0]?.tracks || []).map(track => track.ableton_name),
          })),
        },
      }),
    },
    sections: [{
      name: sourceName,
      bars,
      tracks,
    }],
  };
}

function renameStemTracks(tracks, stemName) {
  const stemLabel = stemName.charAt(0).toUpperCase() + stemName.slice(1);
  const usedNames = new Set();

  return tracks.map((track, index) => {
    const originalName = String(track.ableton_name || '').trim();
    const generic = /^track\s+\d+$/i.test(originalName) || originalName.length === 0;
    const baseName = tracks.length === 1 && generic
      ? stemLabel
      : generic
        ? `${stemLabel} ${index + 1}`
        : `${stemLabel} ${originalName}`;

    const uniqueName = uniquifyName(baseName, usedNames);
    return {
      ...track,
      ableton_name: uniqueName,
    };
  });
}

function uniquifyName(baseName, usedNames) {
  let candidate = baseName;
  let index = 2;
  while (usedNames.has(candidate)) {
    candidate = `${baseName} ${index}`;
    index += 1;
  }
  usedNames.add(candidate);
  return candidate;
}

function slugStem(value) {
  return String(value || '')
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '') || 'audio';
}

async function pushTranscribedSet(setPath, options) {
  console.log(chalk.dim(`  Push: ${setPath}`));
  await pushCommand(setPath, {
    setup: Boolean(options.pushSetup),
    overwrite: Boolean(options.pushOverwrite),
    dryRun: false,
    sections: undefined,
    humanize: undefined,
  });
}
