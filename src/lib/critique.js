import { readFile } from 'fs/promises';
import { dirname, join } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const CRITIQUE_PROMPTS_DIR = join(__dirname, '../../prompts/critique');

export async function loadCritiqueRubric(name) {
  const normalized = normalizeRubricName(name);
  const path = join(CRITIQUE_PROMPTS_DIR, `${normalized}.md`);
  const content = await readFile(path, 'utf-8').catch(() => {
    throw new Error(`Unknown critique rubric "${name}". Add prompts/critique/${normalized}.md or use a built-in rubric name.`);
  });

  return {
    name: normalized,
    prompt: content,
  };
}

export function autoDetectCritiqueRubric(song, requestedName = '') {
  const normalized = normalizeRubricName(requestedName);
  if (normalized && normalized !== 'auto') return normalized;

  const trackNames = (song.sections || [])
    .flatMap(section => (section.tracks || []).map(track => String(track.ableton_name || '').toLowerCase()));

  const quartet = ['violin i', 'violin ii', 'viola', 'cello'];
  if (quartet.every(name => trackNames.includes(name))) return 'string-quartet';

  return 'general';
}

function normalizeRubricName(name) {
  return String(name || '').trim().toLowerCase();
}
