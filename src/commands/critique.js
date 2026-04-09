import chalk from 'chalk';
import { readFile, writeFile } from 'fs/promises';
import { dirname, join } from 'path';
import { fileURLToPath } from 'url';
import { analyzeSong } from '../lib/analysis.js';
import { critiqueSongObject, getProviderLabel } from '../lib/ai.js';
import { autoDetectCritiqueRubric, loadCritiqueRubric } from '../lib/critique.js';
import { loadSong } from '../lib/storage.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const CRITIQUE_PROMPT = join(__dirname, '../../prompts/critique.md');

export async function critiqueCommand(fileOrName, options) {
  try {
    const { song, filepath, isDirectory } = await loadSong(fileOrName);
    const rubricName = autoDetectCritiqueRubric(song, options.rubric);
    const rubric = await loadCritiqueRubric(rubricName);
    const provider = options.provider || 'anthropic';
    const model = options.model;
    const analysis = analyzeSong(song, filepath);
    const systemPrompt = await readFile(CRITIQUE_PROMPT, 'utf-8');
    const userMessage = buildCritiqueUserMessage(song, analysis, filepath, rubric);

    const critique = await critiqueSongObject({
      systemPrompt,
      userMessage,
      model,
      provider,
    });

    printCritique(critique, filepath, isDirectory, provider, model);

    if (options.out) {
      const outPath = options.out.startsWith('/') ? options.out : join(process.cwd(), options.out);
      await writeFile(outPath, JSON.stringify(critique, null, 2), 'utf-8');
      console.log(chalk.green(`\n✓ Report saved to ${outPath}`));
    }
  } catch (err) {
    console.error(chalk.red(`✗ ${err.message}`));
    process.exit(1);
  }
}

function buildCritiqueUserMessage(song, analysis, filepath, rubric) {
  const compactSong = {
    meta: {
      bpm: song.meta?.bpm ?? null,
      scale: song.meta?.scale ?? '',
      genre: song.meta?.genre ?? '',
      time_signature: song.meta?.time_signature ?? '4/4',
    },
    sections: (song.sections || []).map(section => ({
      name: section.name,
      bars: section.bars,
      harmony: section.harmony ?? [],
      tracks: (section.tracks || []).map(track => ({
        ableton_name: track.ableton_name,
        note_count: track.clip?.notes?.length || 0,
        length_bars: track.clip?.length_bars || 0,
        pitch_range: summarizePitchRange(track.clip?.notes || []),
      })),
    })),
  };

  return [
    `Rubric: ${rubric.name}`,
    '',
    'Rubric prompt:',
    rubric.prompt,
    '',
    `Source path: ${filepath}`,
    '',
    'Analytical summary JSON:',
    JSON.stringify(analysis, null, 2),
    '',
    'Song summary JSON:',
    JSON.stringify(compactSong, null, 2),
    '',
    'Return a critique that is useful, technically specific, and framed as guidance rather than objective truth.',
  ].join('\n');
}

function summarizePitchRange(notes) {
  if (!notes.length) return null;
  const pitches = notes.map(note => Number(note.pitch)).filter(Number.isFinite);
  if (!pitches.length) return null;
  return { min: Math.min(...pitches), max: Math.max(...pitches) };
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
