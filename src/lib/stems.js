import { mkdir, readdir, stat, writeFile } from 'fs/promises';
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

      return {
        id: slugify(relativePath.replace(/\//g, '-')) || slugify(base) || 'stem',
        filename,
        basename: base,
        ext: extname(filename).replace(/^\./, '').toLowerCase(),
        source_path: filePath,
        relative_path: relativePath,
        source_dir: dirname(relativePath) === '.' ? '' : dirname(relativePath).replace(/\\/g, '/'),
        track_name: deriveTrackName(base),
        role: null,
        group: null,
        color: null,
        size_bytes: info.size,
      };
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

export async function writeStemManifestFile(outputPath, manifest) {
  await mkdir(dirname(outputPath), { recursive: true });
  await writeFile(outputPath, JSON.stringify(manifest, null, 2), 'utf-8');
  return outputPath;
}

export function defaultStemManifestPath(name) {
  return join(STEMS_DIR, 'manifests', `${slugify(name) || 'stems'}.stems.json`);
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
