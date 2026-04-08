import { mkdir, readdir, readFile, stat, writeFile } from 'fs/promises';
import { basename, dirname, extname, join, relative } from 'path';
import { fileURLToPath } from 'url';
import { slugify } from './storage.js';

const __dirname = dirname(fileURLToPath(import.meta.url));

export const STEMS_DIR = join(__dirname, '../../stems');

export const STEM_MANIFEST_FORMAT = Object.freeze({
  name: 'AbletonStemManifest',
  version: '0.1',
});

const AUDIO_EXTENSIONS = new Set([
  '.wav',
  '.wave',
  '.aif',
  '.aiff',
  '.flac',
  '.mp3',
  '.m4a',
  '.aac',
  '.ogg',
  '.opus',
  '.caf',
]);

export async function scanStemDirectory(rootDir) {
  const absRoot = rootDir.startsWith('/') ? rootDir : join(process.cwd(), rootDir);
  const files = await collectAudioFiles(absRoot);

  const stems = await Promise.all(
    files.map(async filePath => {
      const info = await stat(filePath);
      const relativePath = relative(absRoot, filePath).replace(/\\/g, '/');
      const filename = basename(filePath);
      const base = basename(filename, extname(filename));

      return classifyStem({
        id: slugify(relativePath.replace(/\//g, '-')) || slugify(base) || 'stem',
        filename,
        basename: base,
        ext: extname(filename).replace(/^\./, '').toLowerCase(),
        source_path: filePath,
        relative_path: relativePath,
        source_dir: dirname(relativePath) === '.' ? '' : dirname(relativePath).replace(/\\/g, '/'),
        track_name: deriveTrackName(base),
        size_bytes: info.size,
      });
    })
  );

  stems.sort((a, b) => a.relative_path.localeCompare(b.relative_path, 'en'));
  return { absRoot, stems };
}

export function createStemManifest({ name, sourceRoot, stems }) {
  return {
    _format: { ...STEM_MANIFEST_FORMAT },
    name,
    source_root: sourceRoot,
    scanned_at: new Date().toISOString(),
    stem_count: stems.length,
    stems,
  };
}

export async function loadStemManifestFile(filePath) {
  return JSON.parse(await readFile(filePath, 'utf-8'));
}

export async function writeStemManifestFile(outputPath, manifest) {
  await mkdir(dirname(outputPath), { recursive: true });
  await writeFile(outputPath, JSON.stringify(manifest, null, 2), 'utf-8');
  return outputPath;
}

export function defaultStemManifestPath(name) {
  return join(STEMS_DIR, 'manifests', `${slugify(name) || 'stems'}.stems.json`);
}

export function mergeStemOverrides(stems, existingManifest) {
  const existingStems = Array.isArray(existingManifest?.stems) ? existingManifest.stems : [];
  const byPath = new Map(existingStems.map(stem => [stem.relative_path, stem]));

  return stems.map(stem => {
    const existing = byPath.get(stem.relative_path);
    if (!existing) return stem;

    return {
      ...stem,
      track_name: coalesceOverride(existing.track_name, stem.track_name),
      role: coalesceOverride(existing.role, stem.role),
      group: coalesceOverride(existing.group, stem.group),
      color: coalesceOverride(existing.color, stem.color),
    };
  });
}

async function collectAudioFiles(dir, bucket = []) {
  const entries = await readdir(dir, { withFileTypes: true });

  for (const entry of entries) {
    if (entry.name.startsWith('.')) continue;

    const fullPath = join(dir, entry.name);
    if (entry.isDirectory()) {
      await collectAudioFiles(fullPath, bucket);
      continue;
    }

    if (entry.isFile() && AUDIO_EXTENSIONS.has(extname(entry.name).toLowerCase())) {
      bucket.push(fullPath);
    }
  }

  return bucket;
}

function deriveTrackName(base) {
  const normalized = String(base)
    .replace(/[_-]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();

  if (!normalized) return 'Stem';

  return normalized
    .split(' ')
    .map(token => token ? token.charAt(0).toUpperCase() + token.slice(1) : token)
    .join(' ');
}

function classifyStem(stem) {
  const haystack = [
    stem.relative_path,
    stem.basename,
    stem.source_dir,
  ]
    .filter(Boolean)
    .join(' ')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ');

  const role = detectRole(haystack);
  const group = groupForRole(role);
  const trackName = role ? canonicalTrackName(role, stem.track_name) : stem.track_name;

  return {
    ...stem,
    track_name: trackName,
    role,
    group,
    color: colorForGroup(group),
  };
}

function detectRole(haystack) {
  for (const rule of STEM_ROLE_RULES) {
    if (rule.patterns.some(pattern => pattern.test(haystack))) return rule.role;
  }
  return 'other';
}

function groupForRole(role) {
  return ROLE_GROUPS[role] || 'Music';
}

function colorForGroup(group) {
  return GROUP_COLORS[group] || 'gray';
}

function canonicalTrackName(role, fallback) {
  return ROLE_NAMES[role] || fallback || 'Stem';
}

function coalesceOverride(value, fallback) {
  return value === undefined || value === null || value === '' ? fallback : value;
}

const STEM_ROLE_RULES = [
  { role: 'vocal-lead', patterns: [/\blead vox\b/, /\blead vocal\b/, /\bmain vox\b/, /\bmain vocal\b/, /\bvocal lead\b/, /\bvox lead\b/] },
  { role: 'vocal-backing', patterns: [/\bbv\b/, /\bbacking vocal\b/, /\bbacking vox\b/, /\bharmony vocal\b/, /\bdouble vocal\b/, /\bdouble vox\b/] },
  { role: 'vocal', patterns: [/\bvox\b/, /\bvocal\b/, /\bvoice\b/, /\bchoir\b/] },
  { role: 'kick', patterns: [/\bkick\b/, /\bbd\b/, /\bbass drum\b/] },
  { role: 'snare', patterns: [/\bsnare\b/, /\bsd\b/] },
  { role: 'clap', patterns: [/\bclap\b/] },
  { role: 'hihat', patterns: [/\bhi hat\b/, /\bhihat\b/, /\bhat\b/, /\bhh\b/] },
  { role: 'tom', patterns: [/\btom\b/] },
  { role: 'cymbal', patterns: [/\bcymbal\b/, /\bcrash\b/, /\bride\b/, /\boverhead\b/, /\boh\b/] },
  { role: 'percussion', patterns: [/\bperc\b/, /\bpercussion\b/, /\bconga\b/, /\bbongo\b/, /\bshaker\b/, /\btamb\b/, /\btambourine\b/] },
  { role: 'drums', patterns: [/\bdrum\b/, /\bkit\b/, /\bbeat\b/] },
  { role: 'bass', patterns: [/\bbass\b/, /\bsub\b/, /\b808\b/] },
  { role: 'lead', patterns: [/\blead\b/, /\bmelody\b/, /\bhook\b/] },
  { role: 'pad', patterns: [/\bpad\b/, /\bstring\b/, /\batmos\b/, /\batmosphere\b/] },
  { role: 'keys', patterns: [/\bpiano\b/, /\bkeys\b/, /\bkey\b/, /\brhodes\b/, /\borgan\b/] },
  { role: 'guitar', patterns: [/\bguitar\b/, /\bgtr\b/] },
  { role: 'synth', patterns: [/\bsynth\b/, /\barp\b/, /\bpluck\b/, /\bchord\b/, /\bstab\b/] },
  { role: 'brass', patterns: [/\bbrass\b/, /\bhorn\b/, /\btrumpet\b/, /\btrombone\b/, /\bsax\b/] },
  { role: 'strings', patterns: [/\bstrings\b/, /\bviolin\b/, /\bviola\b/, /\bcello\b/] },
  { role: 'fx', patterns: [/\bfx\b/, /\bsfx\b/, /\bris(er|e)\b/, /\bimpact\b/, /\bsweep\b/, /\btransition\b/, /\bnoise\b/] },
];

const ROLE_GROUPS = {
  kick: 'Drums',
  snare: 'Drums',
  clap: 'Drums',
  hihat: 'Drums',
  tom: 'Drums',
  cymbal: 'Drums',
  percussion: 'Drums',
  drums: 'Drums',
  bass: 'Bass',
  lead: 'Music',
  pad: 'Music',
  keys: 'Music',
  guitar: 'Music',
  synth: 'Music',
  brass: 'Music',
  strings: 'Music',
  'vocal-lead': 'Vocals',
  'vocal-backing': 'Vocals',
  vocal: 'Vocals',
  fx: 'FX',
  other: 'Music',
};

const GROUP_COLORS = {
  Drums: 'red',
  Bass: 'blue',
  Music: 'purple',
  Vocals: 'green',
  FX: 'yellow',
};

const ROLE_NAMES = {
  kick: 'Kick',
  snare: 'Snare',
  clap: 'Clap',
  hihat: 'Hi-Hat',
  tom: 'Tom',
  cymbal: 'Cymbal',
  percussion: 'Percussion',
  drums: 'Drums',
  bass: 'Bass',
  lead: 'Lead',
  pad: 'Pad',
  keys: 'Keys',
  guitar: 'Guitar',
  synth: 'Synth',
  brass: 'Brass',
  strings: 'Strings',
  'vocal-lead': 'Lead Vocal',
  'vocal-backing': 'Backing Vocal',
  vocal: 'Vocal',
  fx: 'FX',
  other: 'Other',
};
