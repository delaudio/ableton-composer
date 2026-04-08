import chalk from 'chalk';
import ora from 'ora';
import { basename, join } from 'path';
import {
  createStemManifest,
  defaultStemManifestPath,
  loadStemManifestFile,
  mergeStemOverrides,
  scanStemDirectory,
  writeStemManifestFile,
} from '../lib/stems.js';

export async function stemScanCommand(sourceDir, options) {
  const spinner = ora();

  try {
    spinner.start(`Scanning ${basename(sourceDir)} for stems...`);
    const { absRoot, stems } = await scanStemDirectory(sourceDir);

    if (stems.length === 0) {
      spinner.fail(`No supported audio files found in ${absRoot}`);
      process.exit(1);
    }

    const outputPath = resolveOutputPath(options.name || basename(absRoot), options.out);
    const existingManifest = await maybeLoadExistingManifest(outputPath);
    const resolvedName = options.name || existingManifest?.name || basename(absRoot);
    const mergedStems = existingManifest ? mergeStemOverrides(stems, existingManifest) : stems;

    const name = resolvedName;
    const manifest = createStemManifest({
      name,
      sourceRoot: absRoot,
      stems: mergedStems,
    });
    await writeStemManifestFile(outputPath, manifest);
    spinner.succeed(`Scanned ${mergedStems.length} stem(s)`);

    console.log(chalk.green(`✓ Saved manifest to ${outputPath}`));
    console.log(chalk.bold(`\n  ${name}`));
    console.log(chalk.dim(`  Source: ${absRoot}`));
    console.log(chalk.dim(`  Files:  ${mergedStems.length}\n`));

    for (const stem of mergedStems.slice(0, 12)) {
      const folder = stem.source_dir ? `${stem.source_dir}/` : '';
      console.log(
        `  ${chalk.cyan(stem.track_name)}` +
        chalk.dim(` [${stem.group}/${stem.role}] ← ${folder}${stem.filename}`)
      );
    }

    if (mergedStems.length > 12) {
      console.log(chalk.dim(`  … ${mergedStems.length - 12} more stem(s)`));
    }

    console.log('');
    if (existingManifest) {
      console.log(chalk.dim('  Existing manual overrides for track_name/role/group/color were preserved.'));
    }
    printGroupSummary(mergedStems);
    console.log(chalk.dim('\n  Next: use the manifest as input for audio-track setup and Ableton stem loading.'));
  } catch (err) {
    spinner.fail(err.message);
    process.exit(1);
  }
}

function resolveOutputPath(name, outOption) {
  if (!outOption) return defaultStemManifestPath(name);

  const absOut = outOption.startsWith('/') ? outOption : join(process.cwd(), outOption);
  if (absOut.endsWith('.json')) return absOut;
  return join(absOut, `${name}.stems.json`);
}

async function maybeLoadExistingManifest(outputPath) {
  try {
    return await loadStemManifestFile(outputPath);
  } catch {
    return null;
  }
}

function printGroupSummary(stems) {
  const counts = new Map();
  for (const stem of stems) {
    counts.set(stem.group, (counts.get(stem.group) || 0) + 1);
  }

  const summary = Array.from(counts.entries())
    .sort((a, b) => a[0].localeCompare(b[0], 'en'))
    .map(([group, count]) => `${group}:${count}`)
    .join('  ');

  if (summary) {
    console.log(chalk.dim(`  Groups: ${summary}`));
  }
}
