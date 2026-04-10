import chalk from 'chalk';
import { basename, join } from 'path';
import { loadSong, slugify } from '../lib/storage.js';
import { buildRenderChainPlan, defaultRenderChainPath, writeRenderChainPlan } from '../lib/render-chain.js';
import { loadStemManifestFile } from '../lib/stems.js';

export async function renderPlanCommand(source, options) {
  try {
    const { song, filepath, isDirectory } = await loadSong(source);
    const stemManifestPath = options.stems
      ? (options.stems.startsWith('/') ? options.stems : join(process.cwd(), options.stems))
      : null;
    const stemManifest = stemManifestPath ? await loadStemManifestFile(stemManifestPath) : null;

    const plan = buildRenderChainPlan(song, `${filepath}${isDirectory ? '/' : ''}`, {
      sampleRate: options.sampleRate,
      bitDepth: options.bitDepth,
      channels: options.channels,
      stemManifest,
      stemManifestPath,
    });

    const outputPath = resolveRenderPlanPath(song?.meta?.genre || basename(filepath), options.out);
    await writeRenderChainPlan(outputPath, plan);

    console.log(chalk.green(`✓ Render chain saved to ${outputPath}`));
    console.log(chalk.bold(`\n  ${plan.source.song_title}`));
    console.log(chalk.dim(`  Source:   ${plan.source.song_path}`));
    console.log(chalk.dim(`  Tracks:   ${plan.tracks.length}`));
    console.log(chalk.dim(`  Stems:    ${stemManifest ? (stemManifest.stem_count || stemManifest.stems?.length || 0) : 0}`));
    console.log(chalk.dim(`  Render:   ${plan.render_settings.sample_rate} Hz / ${plan.render_settings.bit_depth}-bit / ${plan.render_settings.channels} ch`));
    console.log(chalk.dim('\n  Next: use this plan as the portable contract for ffmpeg fallback or Pedalboard rendering.'));
  } catch (err) {
    console.error(chalk.red(`✗ ${err.message}`));
    process.exit(1);
  }
}

function resolveRenderPlanPath(title, outPath) {
  if (outPath) {
    return outPath.startsWith('/') ? outPath : join(process.cwd(), outPath);
  }
  return defaultRenderChainPath(slugify(title) || 'render');
}
