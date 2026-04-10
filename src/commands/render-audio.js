import chalk from 'chalk';
import { join } from 'path';
import {
  buildFfmpegConvertInvocation,
  buildFfmpegMixdownInvocation,
  loadRenderChainPlanFile,
  resolveFfmpegBinary,
  runFfmpeg,
} from '../lib/ffmpeg.js';

export async function renderAudioCommand(planPath, options) {
  try {
    const { plan, resolvedPath } = await loadRenderChainPlanFile(planPath);
    const ffmpegBin = await resolveFfmpegBinary(options.ffmpegBin);
    const invocation = buildFfmpegMixdownInvocation(plan, {
      out: options.out,
      normalize: options.normalize,
    });

    console.log(chalk.bold(`\n  ${plan.source.song_title}`));
    console.log(chalk.dim(`  Plan:     ${resolvedPath}`));
    console.log(chalk.dim(`  Engine:   ffmpeg (${ffmpegBin})`));
    console.log(chalk.dim(`  Tracks:   ${invocation.trackCount}`));
    console.log(chalk.dim(`  Output:   ${invocation.outPath}`));

    if (options.dryRun) {
      console.log(chalk.yellow('\nDRY RUN — ffmpeg will not be executed.\n'));
      console.log(chalk.dim(`  ${ffmpegBin} ${invocation.args.map(quoteArg).join(' ')}`));
      return;
    }

    const logPath = join(process.cwd(), 'renders', 'logs', 'ffmpeg-render.log');
    await runFfmpeg(ffmpegBin, invocation.args, { logPath });
    console.log(chalk.green(`\n✓ Mixed down audio to ${invocation.outPath}`));
    console.log(chalk.dim(`  Log: ${logPath}`));
  } catch (err) {
    console.error(chalk.red(`✗ ${err.message}`));
    process.exit(1);
  }
}

export async function convertAudioCommand(inputPath, options) {
  try {
    const ffmpegBin = await resolveFfmpegBinary(options.ffmpegBin);
    const invocation = buildFfmpegConvertInvocation(
      inputPath.startsWith('/') ? inputPath : join(process.cwd(), inputPath),
      options.out,
      {
        codec: options.codec,
        sampleRate: options.sampleRate,
        channels: options.channels,
        normalize: options.normalize,
      }
    );

    console.log(chalk.bold(`\n  ${inputPath}`));
    console.log(chalk.dim(`  Engine:   ffmpeg (${ffmpegBin})`));
    console.log(chalk.dim(`  Output:   ${invocation.outPath}`));

    if (options.dryRun) {
      console.log(chalk.yellow('\nDRY RUN — ffmpeg will not be executed.\n'));
      console.log(chalk.dim(`  ${ffmpegBin} ${invocation.args.map(quoteArg).join(' ')}`));
      return;
    }

    const logPath = join(process.cwd(), 'renders', 'logs', 'ffmpeg-convert.log');
    await runFfmpeg(ffmpegBin, invocation.args, { logPath });
    console.log(chalk.green(`\n✓ Converted audio to ${invocation.outPath}`));
    console.log(chalk.dim(`  Log: ${logPath}`));
  } catch (err) {
    console.error(chalk.red(`✗ ${err.message}`));
    process.exit(1);
  }
}

function quoteArg(value) {
  const input = String(value);
  return /\s/.test(input) ? `"${input}"` : input;
}
