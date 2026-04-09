import chalk from 'chalk';
import { createGenreResearchDossier, writeResearchDossier } from '../lib/dossiers.js';

export async function researchGenreCommand(topic, options) {
  try {
    const dossier = createGenreResearchDossier(topic);

    if (options.print) {
      console.log(JSON.stringify(dossier, null, 2));
      return dossier;
    }

    const outPath = resolveResearchOutputPath(dossier.slug, options.out);
    const writtenPath = await writeResearchDossier(dossier, outPath);

    console.log(chalk.green(`✓ Research dossier saved to ${writtenPath}`));
    console.log(chalk.bold(`\n  ${dossier.topic}`));
    console.log(chalk.dim(`  Focus:  ${dossier.focus}`));
    console.log(chalk.dim(`  Facts:  ${dossier.facts.length}`));
    console.log(chalk.dim(`  Hints:  ${dossier.inferences.length}`));
    console.log(chalk.dim(`  Next:   ableton-composer generate \"${dossier.topic}\" --dossier ${writtenPath}`));

    return writtenPath;
  } catch (err) {
    console.error(chalk.red(`✗ ${err.message}`));
    process.exit(1);
  }
}

function resolveResearchOutputPath(slug, outPath) {
  if (outPath) {
    return outPath;
  }

  return `research/${slug || 'research-dossier'}.json`;
}
