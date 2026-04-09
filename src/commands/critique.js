import chalk from 'chalk';
import { join } from 'path';
import { getProviderLabel } from '../lib/ai.js';
import { runSongCritique, saveCritiqueReport } from '../lib/critique-runner.js';
import { loadSong } from '../lib/storage.js';

export async function critiqueCommand(fileOrName, options) {
  try {
    const { song, filepath, isDirectory } = await loadSong(fileOrName);
    const provider = options.provider || 'anthropic';
    const model = options.model;
    const critique = await runSongCritique(song, filepath, {
      rubric: options.rubric,
      model,
      provider,
    });

    printCritique(critique, filepath, isDirectory, provider, model);

    const outPath = options.out
      ? (options.out.startsWith('/') ? options.out : join(process.cwd(), options.out))
      : null;

    if (outPath) {
      await saveCritiqueReport(critique, outPath);
      console.log(chalk.green(`\n✓ Report saved to ${outPath}`));
    }
  } catch (err) {
    console.error(chalk.red(`✗ ${err.message}`));
    process.exit(1);
  }
}

function printCritique(report, filepath, isDirectory, provider, model) {
  const scoreColor = report.score >= 80 ? chalk.green : report.score >= 60 ? chalk.yellow : chalk.red;

  console.log(chalk.bold(`\n Composition Critique`));
  console.log(chalk.dim(`  source:   ${filepath}${isDirectory ? '/' : ''}`));
  console.log(chalk.dim(`  rubric:   ${report.rubric}`));
  console.log(chalk.dim(`  provider: ${getProviderLabel(provider, model)}\n`));

  console.log(`  Score: ${scoreColor(`${report.score}/100`)}`);
  console.log(`  ${report.summary}\n`);

  if (report.issues?.length) {
    console.log(chalk.cyan('  Findings'));
    for (const issue of report.issues) {
      const sev = issue.severity === 'high' ? chalk.red(issue.severity) : issue.severity === 'medium' ? chalk.yellow(issue.severity) : chalk.dim(issue.severity);
      const scope = [issue.section, issue.track].filter(Boolean).join(' / ');
      console.log(`  - [${sev}] ${issue.category}${scope ? ` (${scope})` : ''}: ${issue.message}`);
      if (issue.suggestion) console.log(chalk.dim(`    ${issue.suggestion}`));
    }
    console.log('');
  }

  if (report.strengths?.length) {
    console.log(chalk.cyan('  Strengths'));
    for (const item of report.strengths) console.log(`  - ${item}`);
    console.log('');
  }

  if (report.suggested_revisions?.length) {
    console.log(chalk.cyan('  Suggested Revisions'));
    for (const item of report.suggested_revisions) console.log(`  - ${item}`);
    console.log('');
  }

  if (report.followup_commands?.length) {
    console.log(chalk.cyan('  Follow-up Commands'));
    for (const item of report.followup_commands) console.log(`  - ${item}`);
    console.log('');
  }
}
