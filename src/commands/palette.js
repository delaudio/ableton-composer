import chalk from 'chalk';
import { createOperationalPaletteFromDossier, writeOperationalPalette } from '../lib/palettes.js';
import { loadResearchDossier, normalizeHistoricalStrictness } from '../lib/dossiers.js';

export async function paletteGenerateCommand(dossierPath, options) {
  try {
    const { dossier } = await loadResearchDossier(dossierPath).catch(() => {
      throw new Error(`Research dossier not found or invalid: ${dossierPath}`);
    });

    const trackNames = String(options.tracks || '')
      .split(',')
      .map(value => value.trim())
      .filter(Boolean);

    if (trackNames.length === 0) {
      throw new Error('Palette generation requires --tracks "Bass,Drums,Pad,Lead,Chords,FX"');
    }

    const historicalStrictness = normalizeHistoricalStrictness(options.historicalStrictness || 'loose');
    const palette = createOperationalPaletteFromDossier(dossier, trackNames, { historicalStrictness });

    if (options.print) {
      console.log(JSON.stringify(palette, null, 2));
      return palette;
    }

    const outPath = resolvePaletteOutputPath(palette.slug, options.out);
    const writtenPath = await writeOperationalPalette(palette, outPath);

    console.log(chalk.green(`✓ Operational palette saved to ${writtenPath}`));
    console.log(chalk.bold(`\n  ${palette.topic}`));
    console.log(chalk.dim(`  Tracks:      ${palette.tracks.length}`));
    console.log(chalk.dim(`  Strictness:  ${palette.historical_strictness}`));
    console.log(chalk.dim(`  Next:        ableton-composer generate \"${palette.topic}\" --dossier ${dossierPath} --palette ${writtenPath}`));

    return writtenPath;
  } catch (err) {
    console.error(chalk.red(`✗ ${err.message}`));
    process.exit(1);
  }
}

function resolvePaletteOutputPath(slug, outPath) {
  if (outPath) return outPath;
  return `palettes/${slug || 'operational-palette'}.json`;
}
