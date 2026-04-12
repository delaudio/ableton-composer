import chalk from 'chalk';
import ora from 'ora';
import { join } from 'path';
import { loadSong, saveSong, writeSongFile } from '../lib/storage.js';
import { getProviderLabel, normalizeProvider, getDefaultModel } from '../lib/ai.js';
import { appendProvenance } from '../lib/provenance.js';
import { loadCritiqueReport, runSongRevision } from '../lib/revise-runner.js';

export async function reviseCommand(fileArg, options) {
  const spinner = ora();

  try {
    const provider = normalizeProvider(options.provider || 'api');

    spinner.start(`Loading ${fileArg}...`);
    const { song, filepath, isDirectory } = await loadSong(fileArg);
    spinner.succeed(`Loaded: ${filepath}${isDirectory ? '/' : ''}`);

    console.log(chalk.bold(`\n  ${song.meta?.genre || 'Song'} — ${song.meta?.bpm} BPM — ${song.meta?.scale || '?'}`));
    console.log(chalk.dim(`  Provider: ${getProviderLabel(provider, options.model)}`));

    let critique = null;
    let critiquePath = null;

    if (options.critique) {
      spinner.start(`Loading critique ${options.critique}...`);
      const loaded = await loadCritiqueReport(options.critique);
      critique = loaded.critique;
      critiquePath = loaded.resolvedPath;
      spinner.succeed(`Loaded critique: ${critiquePath}`);
    } else {
      spinner.start('Generating critique for revision input...');
      const revisionInput = await runSongRevision(song, filepath, {
        rubric: options.rubric,
        model: options.model,
        provider,
      });
      critique = revisionInput.critique;
      spinner.succeed(`Critique ready (${critique.score}/100)`);

      spinner.start(`Revising with ${getProviderLabel(provider, options.model)}...`);
      const revisedSong = revisionInput.revisedSong;
      finalizeRevision(revisedSong, { filepath, critique, critiquePath, provider, model: options.model });
      const savedPath = await saveRevisionOutput(revisedSong, options.out);
      spinner.succeed(`Saved revised set to ${savedPath}`);
      return;
    }

    spinner.start(`Revising with ${getProviderLabel(provider, options.model)}...`);
    const { revisedSong } = await runSongRevision(song, filepath, {
      critique,
      rubric: options.rubric,
      model: options.model,
      provider,
    });
    finalizeRevision(revisedSong, { filepath, critique, critiquePath, provider, model: options.model });
    const savedPath = await saveRevisionOutput(revisedSong, options.out);
    spinner.succeed(`Saved revised set to ${savedPath}`);
  } catch (err) {
    spinner.fail(err.message);
    process.exit(1);
  }
}

function finalizeRevision(song, { filepath, critique, critiquePath, provider, model }) {
  appendProvenance(song, 'revise-from-critique', {
    source_path: filepath,
    provider,
    model: getDefaultModel(provider, model),
    output: critiquePath || 'generated-inline',
    sections: song.sections?.length ?? 0,
    tracks: [...new Set((song.sections || []).flatMap(section => (section.tracks || []).map(track => track.ableton_name)))],
  });
}

async function saveRevisionOutput(song, outPath) {
  if (outPath) {
    const resolved = outPath.startsWith('/') ? outPath : join(process.cwd(), outPath);
    const saveDir = outPath.endsWith('/') || !outPath.endsWith('.json');

    if (saveDir) {
      const { saveSetDirectory } = await import('../lib/storage.js');
      await saveSetDirectory(song, resolved);
      return `${resolved}/`;
    }

    await writeSongFile(resolved, song);
    return resolved;
  }

  return saveSong(song, `${song.meta?.genre || 'song'}-revised`);
}
