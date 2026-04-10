import chalk from 'chalk';
import {
  buildPromptSafePluginInventory,
  enrichPluginInventory,
  formatPluginInventorySummary,
  formatPluginMatchReport,
  loadPluginInventory,
  matchPluginsToDossier,
  normalizePluginFormats,
  scanLocalPlugins,
  writePluginMatchReport,
  writePluginInventory,
} from '../lib/plugins.js';
import { loadResearchDossier } from '../lib/dossiers.js';

export async function pluginScanCommand(options) {
  try {
    const formats = normalizePluginFormats(options.formats);
    const inventory = await scanLocalPlugins({ formats });

    if (options.print) {
      const payload = options.promptSafe ? buildPromptSafePluginInventory(inventory) : inventory;
      console.log(JSON.stringify(payload, null, 2));
      return payload;
    }

    const writtenPath = await writePluginInventory(inventory, options.out || 'plugins/inventory.json');

    console.log(chalk.green(`✓ Plugin inventory saved to ${writtenPath}`));
    console.log(chalk.bold(`\n  Plugin inventory`));
    console.log(chalk.dim(`  Plugins:      ${inventory.counts.total}`));
    console.log(chalk.dim(`  Formats:      ${inventory.formats.join(', ')}`));
    console.log(chalk.dim(`  Missing dirs: ${inventory.missing_directories.length}`));
    console.log(chalk.dim(`  Next:         ableton-composer plugins list${options.out ? ` --inventory ${writtenPath}` : ''}`));

    return writtenPath;
  } catch (err) {
    console.error(chalk.red(`✗ ${err.message}`));
    process.exit(1);
  }
}

export async function pluginListCommand(options) {
  try {
    const { inventory, resolvedPath } = await loadPluginInventory(options.inventory || 'plugins/inventory.json');
    const promptSafe = options.promptSafe !== false;
    const view = promptSafe ? buildPromptSafePluginInventory(inventory) : inventory;
    const rows = formatPluginInventorySummary(inventory, { promptSafe });

    console.log(chalk.bold(`\n  Plugin inventory`));
    console.log(chalk.dim(`  Source:       ${resolvedPath}`));
    console.log(chalk.dim(`  Plugins:      ${view.counts.total}`));
    console.log(chalk.dim(`  Formats:      ${Object.entries(view.counts.by_format || {}).map(([name, count]) => `${name}:${count}`).join(', ') || 'none'}`));
    console.log(chalk.dim(`  Types:        ${Object.entries(view.counts.by_type || {}).map(([name, count]) => `${name}:${count}`).join(', ') || 'none'}`));
    console.log(chalk.dim(`  Privacy:      ${promptSafe ? 'prompt-safe view' : 'full paths visible'}`));

    if (rows.length > 0) {
      console.log('');
      for (const row of rows) console.log(row);
    } else {
      console.log(chalk.yellow('\nNo plugins found in the scanned directories.'));
    }

    return view;
  } catch (err) {
    console.error(chalk.red(`✗ ${err.message}`));
    process.exit(1);
  }
}

export async function pluginEnrichCommand(options) {
  try {
    const { inventory } = await loadPluginInventory(options.inventory || 'plugins/inventory.json');
    const enriched = enrichPluginInventory(inventory);

    if (options.print) {
      const payload = options.promptSafe ? buildPromptSafePluginInventory(enriched) : enriched;
      console.log(JSON.stringify(payload, null, 2));
      return payload;
    }

    const writtenPath = await writePluginInventory(enriched, options.out || options.inventory || 'plugins/inventory.json');
    console.log(chalk.green(`✓ Plugin inventory enriched at ${writtenPath}`));
    console.log(chalk.bold(`\n  Plugin enrichment`));
    console.log(chalk.dim(`  Plugins:      ${enriched.counts.total}`));
    console.log(chalk.dim(`  Enriched:     ${enriched.counts.enriched}`));
    console.log(chalk.dim(`  Next:         ableton-composer plugins match research/your-dossier.json --inventory ${writtenPath}`));
    return writtenPath;
  } catch (err) {
    console.error(chalk.red(`✗ ${err.message}`));
    process.exit(1);
  }
}

export async function pluginMatchCommand(dossierPath, options) {
  try {
    const { inventory } = await loadPluginInventory(options.inventory || 'plugins/inventory.json');
    const { dossier } = await loadResearchDossier(dossierPath).catch(() => {
      throw new Error(`Research dossier not found or invalid: ${dossierPath}`);
    });

    const readyInventory = inventory.plugins.some(plugin => plugin.enrichment)
      ? inventory
      : enrichPluginInventory(inventory);
    const report = matchPluginsToDossier(readyInventory, dossier);

    if (options.print) {
      if (options.promptSafe !== false) {
        const promptSafeReport = {
          ...report,
          recommended: report.recommended.map(stripMatchPaths),
          caution: report.caution.map(stripMatchPaths),
          avoid: report.avoid.map(stripMatchPaths),
        };
        console.log(JSON.stringify(promptSafeReport, null, 2));
        return promptSafeReport;
      }
      console.log(JSON.stringify(report, null, 2));
      return report;
    }

    if (options.out) {
      const writtenPath = await writePluginMatchReport(report, options.out);
      console.log(chalk.green(`✓ Plugin match report saved to ${writtenPath}`));
    }

    console.log(chalk.bold(`\n  Plugin match`));
    console.log(chalk.dim(`  Topic:        ${report.topic}`));
    console.log(chalk.dim(`  Recommended:  ${report.counts.recommended}`));
    console.log(chalk.dim(`  Caution:      ${report.counts.caution}`));
    console.log(chalk.dim(`  Avoid:        ${report.counts.avoid}`));
    console.log('');
    for (const line of formatPluginMatchReport(report, { promptSafe: options.promptSafe !== false })) {
      console.log(line);
    }

    return report;
  } catch (err) {
    console.error(chalk.red(`✗ ${err.message}`));
    process.exit(1);
  }
}

function stripMatchPaths(entry) {
  const { path, ...rest } = entry;
  return rest;
}
