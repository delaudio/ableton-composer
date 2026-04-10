import chalk from 'chalk';
import { join } from 'path';
import { ensurePedalboardWorker, loadRenderPlanForPedalboard, resolvePythonBinary, runPedalboardWorker } from '../lib/pedalboard.js';

export async function renderStemsCommand(planPath, options) {
  const engine = String(options.engine || 'pedalboard').toLowerCase();
  if (engine !== 'pedalboard') {
    console.error(chalk.red(`✗ Unsupported render-stems engine: ${engine}. Currently only "pedalboard" is implemented.`));
    process.exit(1);
  }

  try {
    const { plan, resolvedPath } = await loadRenderPlanForPedalboard(planPath);
    const pythonBin = await resolvePythonBinary(options.pythonBin);
    const workerPath = await ensurePedalboardWorker(options.worker || 'scripts/pedalboard_render.py');
    const outDir = options.out
      ? (options.out.startsWith('/') ? options.out : join(process.cwd(), options.out))
      : null;

    console.log(chalk.bold(`\n  ${plan.source.song_title}`));
    console.log(chalk.dim(`  Plan:     ${resolvedPath}`));
    console.log(chalk.dim(`  Engine:   pedalboard (${pythonBin})`));
    console.log(chalk.dim(`  Worker:   ${workerPath}`));
    if (outDir) console.log(chalk.dim(`  Output:   ${outDir}`));

    if (options.dryRun) {
      console.log(chalk.yellow('\nDRY RUN — Pedalboard worker will not be executed.\n'));
      console.log(chalk.dim(`  ${pythonBin} ${workerPath} --plan ${resolvedPath} --mode stems${outDir ? ` --out ${outDir}` : ''}`));
      return;
    }

    const logPath = join(process.cwd(), 'renders', 'logs', 'pedalboard-render.log');
    const run = await runPedalboardWorker({
      pythonBin,
      workerPath,
      planPath: resolvedPath,
      outDir,
      mode: 'stems',
      logPath,
    });

    console.log(chalk.green(`\n✓ Pedalboard worker completed`));
    if (run.result?.rendered_tracks != null) {
      console.log(chalk.dim(`  Rendered tracks: ${run.result.rendered_tracks}`));
    }
    console.log(chalk.dim(`  Log: ${logPath}`));
  } catch (err) {
    console.error(chalk.red(`✗ ${err.message}`));
    process.exit(1);
  }
}
