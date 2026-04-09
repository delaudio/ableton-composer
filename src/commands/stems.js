import chalk from 'chalk';
import ora from 'ora';
import { basename, join } from 'path';
import { connect, disconnect, setupAudioTracks } from '../lib/ableton.js';
import {
  buildStemTrackDefinitions,
  createStemManifest,
  defaultStemManifestPath,
  loadStemManifestFile,
  mergeStemOverrides,
  scanStemDirectory,
  sortStemsForOrganization,
  writeStemManifestFile,
} from '../lib/stems.js';
import {
  buildReaperStemImportScript,
  defaultReaperStemScriptPath,
  writeReaperStemImportScript,
} from '../lib/reaper.js';

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

    for (const stem of sortStemsForOrganization(mergedStems).slice(0, 12)) {
      const folder = stem.source_dir ? `${stem.source_dir}/` : '';
      console.log(
        `  ${chalk.cyan(stem.display_name || stem.track_name)}` +
        chalk.dim(` [${stem.group}/${stem.role}] order:${stem.order} ← ${folder}${stem.filename}`)
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

export async function stemSetupCommand(manifestPath, options) {
  const spinner = ora();

  try {
    spinner.start(`Loading stem manifest ${basename(manifestPath)}...`);
    const absPath = manifestPath.startsWith('/') ? manifestPath : join(process.cwd(), manifestPath);
    const manifest = await loadStemManifestFile(absPath);
    const requestedTracks = buildStemTrackDefinitions(manifest.stems || [], {
      prefixGroups: options.prefixGroups,
    });
    spinner.succeed(`Loaded ${manifest.name || basename(absPath)}`);

    if (requestedTracks.length === 0) {
      console.log(chalk.yellow('No tracks found in manifest.'));
      return;
    }

    console.log(chalk.bold(`\n  ${manifest.name || basename(absPath)}`));
    console.log(chalk.dim(`  Manifest: ${absPath}`));
    console.log(chalk.dim(`  Tracks:   ${requestedTracks.length}\n`));

    for (const track of requestedTracks.slice(0, 16)) {
      console.log(
        `  ${chalk.cyan(track.name)}` +
        chalk.dim(` [${track.group}/${track.role}] color:${track.color || 'none'} order:${track.order}`)
      );
    }
    if (requestedTracks.length > 16) {
      console.log(chalk.dim(`  … ${requestedTracks.length - 16} more track(s)`));
    }

    if (options.dryRun) {
      console.log(chalk.yellow('\nDRY RUN — no tracks will be created in Ableton.\n'));
      return;
    }

    spinner.start('Connecting to Ableton Live...');
    await connect();
    spinner.succeed('Connected');

    spinner.start('Setting up audio tracks...');
    const result = await setupAudioTracks(requestedTracks);
    spinner.succeed('Audio track setup complete');

    if (result.tracks.length > 0) {
      console.log(chalk.green(`  + Created tracks: ${result.tracks.join(', ')}`));
    }
    if (result.reused.length > 0) {
      console.log(chalk.dim(`  = Reused tracks: ${result.reused.join(', ')}`));
    }
    if (result.colored.length > 0) {
      console.log(chalk.dim(`  • Applied colors: ${result.colored.join(', ')}`));
    }
    if (result.tracks.length === 0 && result.reused.length === 0) {
      console.log(chalk.dim('  (nothing to set up)'));
    }
    console.log('');
  } catch (err) {
    spinner.fail(err.message);
    process.exit(1);
  } finally {
    await disconnect();
  }
}

export async function stemReaperCommand(manifestPath, options) {
  const spinner = ora();

  try {
    spinner.start(`Loading stem manifest ${basename(manifestPath)}...`);
    const absPath = manifestPath.startsWith('/') ? manifestPath : join(process.cwd(), manifestPath);
    const manifest = await loadStemManifestFile(absPath);
    spinner.succeed(`Loaded ${manifest.name || basename(absPath)}`);

    const outputPath = resolveReaperOutputPath(manifest.name || basename(absPath), options.out);
    const script = buildReaperStemImportScript(manifest, {
      bpm: options.bpm,
      timeSignature: options.timeSignature,
      groupFolders: options.flat ? false : true,
      projectName: options.name || manifest.name,
    });

    console.log(chalk.bold(`\n  ${manifest.name || basename(absPath)}`));
    console.log(chalk.dim(`  Manifest: ${absPath}`));
    console.log(chalk.dim(`  Stems:    ${manifest.stem_count || (manifest.stems || []).length}`));
    console.log(chalk.dim(`  BPM:      ${options.bpm || 120}`));
    console.log(chalk.dim(`  Sig:      ${options.timeSignature || '4/4'}`));
    console.log(chalk.dim(`  Layout:   ${options.flat ? 'flat tracks' : 'group folders'}`));

    if (options.dryRun) {
      console.log(chalk.yellow('\nDRY RUN — no ReaScript file written.\n'));
      console.log(chalk.dim(`  Would write: ${outputPath}`));
      return;
    }

    await writeReaperStemImportScript(outputPath, script);
    console.log(chalk.green(`\n✓ Saved REAPER import script to ${outputPath}`));
    console.log(chalk.dim('  Run the generated .lua script inside REAPER to create tracks and import the stem files.'));
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

function resolveReaperOutputPath(name, outOption) {
  if (!outOption) return defaultReaperStemScriptPath(name);

  const absOut = outOption.startsWith('/') ? outOption : join(process.cwd(), outOption);
  if (absOut.endsWith('.lua')) return absOut;
  return join(absOut, `${name}.lua`);
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
    .sort((a, b) => groupBucketOrder(a[0]) - groupBucketOrder(b[0]) || a[0].localeCompare(b[0], 'en'))
    .map(([group, count]) => `${group}:${count}`)
    .join('  ');

  if (summary) {
    console.log(chalk.dim(`  Groups: ${summary}`));
  }
}

function groupBucketOrder(group) {
  const index = GROUP_BUCKET_ORDER.indexOf(group);
  return index === -1 ? GROUP_BUCKET_ORDER.length : index;
}

const GROUP_BUCKET_ORDER = ['Drums', 'Bass', 'Music', 'Vocals', 'FX'];
