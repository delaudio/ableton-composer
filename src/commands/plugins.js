import chalk from 'chalk';
import {
  buildPromptSafePluginInventory,
  formatPluginInventorySummary,
  loadPluginInventory,
  normalizePluginFormats,
  scanLocalPlugins,
  writePluginInventory,
} from '../lib/plugins.js';

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
