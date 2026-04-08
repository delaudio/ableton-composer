import chalk from 'chalk';
import ora from 'ora';
import { basename, join } from 'path';
import {
  createStemManifest,
  defaultStemManifestPath,
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

    const name = options.name || basename(absRoot);
    const manifest = createStemManifest({
      name,
      sourceRoot: absRoot,
      stems,
    });

    const outputPath = resolveOutputPath(name, options.out);
    await writeStemManifestFile(outputPath, manifest);
    spinner.succeed(`Scanned ${stems.length} stem(s)`);

    console.log(chalk.green(`✓ Saved manifest to ${outputPath}`));
    console.log(chalk.bold(`\n  ${name}`));
    console.log(chalk.dim(`  Source: ${absRoot}`));
    console.log(chalk.dim(`  Files:  ${stems.length}\n`));

    for (const stem of stems.slice(0, 12)) {
      const folder = stem.source_dir ? `${stem.source_dir}/` : '';
      console.log(
        `  ${chalk.cyan(stem.track_name)}` +
        chalk.dim(` ← ${folder}${stem.filename}`)
      );
    }

    if (stems.length > 12) {
      console.log(chalk.dim(`  … ${stems.length - 12} more stem(s)`));
    }

    console.log('');
    console.log(chalk.dim('  role/group/color stay null until classification is added.'));
    console.log(chalk.dim('  Next: ableton-composer stems scan <dir> --out stems/manifests/custom.stems.json'));
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
