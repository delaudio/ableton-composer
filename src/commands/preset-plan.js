import chalk from 'chalk';
import { createPresetPlan, formatPresetPlanSummary, resolvePresetPlanOutputPath, writePresetPlan } from '../lib/preset-plans.js';

export async function presetPlanCommand(dossierPath, options) {
  try {
    const plan = await createPresetPlan({
      dossierPath,
      palettePath: options.palette,
      inventoryPath: options.inventory || 'plugins/inventory.json',
      installedOnly: Boolean(options.installedOnly),
    });

    if (options.print) {
      console.log(JSON.stringify(plan, null, 2));
      return plan;
    }

    const outPath = resolvePresetPlanOutputPath(plan.slug || plan.topic, options.out);
    const writtenPath = await writePresetPlan(plan, outPath);

    console.log(chalk.green(`✓ Preset plan saved to ${writtenPath}`));
    console.log(chalk.bold(`\n  ${plan.topic}`));
    console.log(chalk.dim(`  Roles:         ${plan.roles.length}`));
    console.log(chalk.dim(`  Installed-only:${plan.installed_only ? ' yes' : ' no'}`));
    console.log(chalk.dim(`  Next:          ableton-composer preset generate <profile.json> \"<prompt from plan>\"`));
    console.log('');
    for (const line of formatPresetPlanSummary(plan).slice(0, 24)) {
      console.log(line);
    }

    return writtenPath;
  } catch (err) {
    console.error(chalk.red(`✗ ${err.message}`));
    process.exit(1);
  }
}
