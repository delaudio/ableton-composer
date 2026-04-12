import { readFile } from 'fs/promises';
import { dirname, join } from 'path';
import { fileURLToPath } from 'url';
import { analyzeSong } from './analysis.js';
import { generateStructuredObject } from './ai.js';
import { runSongCritique } from './critique-runner.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const REVISE_PROMPT = join(__dirname, '../../prompts/revise.md');
const SONG_SCHEMA = join(__dirname, '../../schema/song.schema.json');

export async function runSongRevision(song, sourcePath, options = {}) {
  const critique = options.critique || await runSongCritique(song, sourcePath, {
    rubric: options.rubric,
    model: options.critiqueModel || options.model,
    provider: options.critiqueProvider || options.provider,
  });

  const analysis = analyzeSong(song, sourcePath || '');
  const systemPrompt = await readFile(REVISE_PROMPT, 'utf-8');
  const responseSchema = JSON.parse(await readFile(SONG_SCHEMA, 'utf-8'));
  const userMessage = buildRevisionUserMessage(song, critique, analysis, sourcePath || '');

  const revisedSong = await generateStructuredObject({
    provider: options.provider,
    model: options.model,
    systemPrompt,
    userMessage,
    responseSchema,
    schemaName: 'song_revision',
  });

  return { revisedSong, critique };
}

export async function loadCritiqueReport(pathname) {
  const resolved = pathname.startsWith('/') ? pathname : join(process.cwd(), pathname);
  const raw = await readFile(resolved, 'utf-8');
  return { critique: JSON.parse(raw), resolvedPath: resolved };
}

function buildRevisionUserMessage(song, critique, analysis, sourcePath) {
  return [
    `Source path: ${sourcePath}`,
    '',
    'Existing song JSON:',
    JSON.stringify(song, null, 2),
    '',
    'Existing song analysis JSON:',
    JSON.stringify(analysis, null, 2),
    '',
    'Critique JSON:',
    JSON.stringify(critique, null, 2),
    '',
    'Revise the song to address the critique while preserving strengths, overall identity, and track naming where practical.',
    'Return a complete valid AbletonSong JSON object, not a patch.',
  ].join('\n');
}
