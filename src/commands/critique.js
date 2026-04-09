import chalk from 'chalk';
import { readFile, writeFile } from 'fs/promises';
import { dirname, join } from 'path';
import { fileURLToPath } from 'url';
import { analyzeSong } from '../lib/analysis.js';
import { critiqueSongObject, getProviderLabel } from '../lib/ai.js';
import { loadSong } from '../lib/storage.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const CRITIQUE_PROMPT = join(__dirname, '../../prompts/critique.md');

export async function critiqueCommand(fileOrName, options) {
  try {
    const { song, filepath, isDirectory } = await loadSong(fileOrName);
    const rubric = normalizeRubric(options.rubric, song);
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
    `Rubric intent: ${rubric.description}`,
    '',
    'Rubric criteria:',
    ...rubric.criteria.map(item => `- ${item}`),
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

function normalizeRubric(input, song) {
  const value = String(input || '').trim().toLowerCase();
  if (value && RUBRICS[value]) return { name: value, ...RUBRICS[value] };

  const trackNames = (song.sections || []).flatMap(section => (section.tracks || []).map(track => track.ableton_name.toLowerCase()));
  const quartet = ['violin i', 'violin ii', 'viola', 'cello'];
  if (quartet.every(name => trackNames.includes(name))) return { name: 'string-quartet', ...RUBRICS['string-quartet'] };

  return { name: 'general', ...RUBRICS.general };
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

const RUBRICS = {
  general: {
    description: 'Evaluate coherence, structure, balance, role clarity, tonal stability, and section contrast.',
    criteria: [
      'structural coherence across sections',
      'clarity of roles and arrangement balance',
      'tonal and rhythmic consistency',
      'section contrast without losing continuity',
      'idiomatic use of ranges and densities where inferable',
    ],
  },
  'string-quartet': {
    description: 'Evaluate idiomatic string writing, independence of voices, register balance, and quartet texture.',
    criteria: [
      'idiomatic ranges for violin, viola, and cello',
      'independence of voices instead of excessive doubling',
      'inner-voice motion and balance',
      'cello function and upper-voice contrast',
      'motivic clarity and section development',
    ],
  },
  'synth-pop': {
    description: 'Evaluate hook clarity, role separation, groove, palette consistency, and section lift in synth-pop contexts.',
    criteria: [
      'hook and lead clarity',
      'bass, drums, pad, and chord separation',
      'groove consistency and restraint',
      'palette coherence for the intended style',
      'useful contrast between verse/chorus or equivalent sections',
    ],
  },
  'chicago-house': {
    description: 'Evaluate groove function, bass/chord interaction, DJ-friendly structure, and historical palette coherence.',
    criteria: [
      'four-on-the-floor groove function',
      'bass and chord stab interaction',
      'economy of melodic material',
      'intro/outro and mix-friendly structure',
      'style coherence for early house references',
    ],
  },
};
