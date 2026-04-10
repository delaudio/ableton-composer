import chalk from 'chalk';
import ora from 'ora';
import { join } from 'path';
import { basename } from 'path';
import {
  ensureSeparationInput,
  resolveDemucsBinary,
  resolveSeparationOutputDir,
  runDemucsSeparation,
  writeSeparationMetadata,
} from '../lib/separation.js';
import { createStemManifest, mergeStemOverrides, scanStemDirectory, writeStemManifestFile } from '../lib/stems.js';
import { resolveSeparatedManifestOutput } from './stems.js';

export async function separateCommand(audioFile, options) {
  const spinner = ora();

  try {
    const engine = String(options.engine || 'demucs').toLowerCase();
    if (engine !== 'demucs') {
      throw new Error(`Unsupported separation engine: ${engine}. Currently only "demucs" is implemented.`);
    }

    const audioPath = await ensureSeparationInput(audioFile);
    const binary = await resolveDemucsBinary(options.demucsBin);
    const outputDir = resolveSeparationOutputDir(audioPath, options.out);
    const model = String(options.model || 'htdemucs').trim() || 'htdemucs';
    const logPath = join(process.cwd(), 'separations', 'logs', 'demucs.log');

    console.log(chalk.bold(`\n  ${audioPath}`));
    console.log(chalk.dim(`  Engine:   demucs (${binary})`));
    console.log(chalk.dim(`  Model:    ${model}`));
    console.log(chalk.dim(`  Output:   ${outputDir}`));

    if (options.dryRun) {
      console.log(chalk.yellow('\nDRY RUN — Demucs will not be executed.\n'));
      console.log(chalk.dim(`  ${binary} --out ${join(outputDir, '_demucs-temp')} -n ${model} ${audioPath}`));
      return;
    }

    spinner.start('Running source separation...');
    const run = await runDemucsSeparation({
      binary,
      audioPath,
      outputDir,
      model,
      logPath,
    });
    spinner.succeed(`Separated stems written to ${outputDir}`);

    const metadataPath = await writeSeparationMetadata({
      sourcePath: audioPath,
      engine: 'demucs',
      model,
      outputDir,
      outputs: run.outputs,
    });

    console.log(chalk.dim(`  Stems: ${run.outputs.map(entry => entry.stem).join(', ')}`));
    console.log(chalk.dim(`  Metadata: ${metadataPath}`));
    console.log(chalk.dim(`  Log: ${logPath}`));

    if (options.manifest) {
      const { absRoot, stems, separation } = await scanStemDirectory(outputDir);
      const manifestPath = resolveSeparatedManifestOutput(outputDir, options.manifestOut);
      const existingManifest = await maybeLoadManifest(manifestPath);
      const manifest = createStemManifest({
        name: basename(outputDir),
        sourceRoot: absRoot,
        stems: existingManifest ? mergeStemOverrides(stems, existingManifest) : stems,
        separation,
      });
      await writeStemManifestFile(manifestPath, manifest);
      console.log(chalk.green(`  Manifest: ${manifestPath}`));
    }
  } catch (err) {
    spinner.fail(err.message);
    process.exit(1);
  }
}

async function maybeLoadManifest(pathname) {
  try {
    const { loadStemManifestFile } = await import('../lib/stems.js');
    return await loadStemManifestFile(pathname);
  } catch {
    return null;
  }
}
