import { readFile, writeFile } from 'fs/promises';
import { dirname, join } from 'path';
import { fileURLToPath } from 'url';
import { analyzeSong } from './analysis.js';
import { critiqueSongObject } from './ai.js';
import { autoDetectCritiqueRubric, loadCritiqueRubric } from './critique.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const CRITIQUE_PROMPT = join(__dirname, '../../prompts/critique.md');

export async function runSongCritique(song, sourcePath, options = {}) {
  const rubricName = autoDetectCritiqueRubric(song, options.rubric);
  const rubric = await loadCritiqueRubric(rubricName);
  const analysis = analyzeSong(song, sourcePath || '');
  const systemPrompt = await readFile(CRITIQUE_PROMPT, 'utf-8');
  const userMessage = buildCritiqueUserMessage(song, analysis, sourcePath || '', rubric);

  const critique = await critiqueSongObject({
    systemPrompt,
    userMessage,
    model: options.model,
    provider: options.provider,
  });

  return critique;
}

export async function saveCritiqueReport(report, outPath) {
  await writeFile(outPath, JSON.stringify(report, null, 2), 'utf-8');
  return outPath;
}

export function defaultCritiqueReportPath(savedPath) {
  return `${savedPath}.critique.json`;
}

function buildCritiqueUserMessage(song, analysis, sourcePath, rubric) {
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
    `Source path: ${sourcePath}`,
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
