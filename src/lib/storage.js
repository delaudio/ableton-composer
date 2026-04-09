/**
 * File-based storage for song sets.
 *
 * Supports two formats:
 *
 * 1. Flat file:  sets/my-song_2026-04-03.json      → full AbletonSong in one file
 * 2. Directory:  sets/my-song/                     → split format
 *                  meta.json                        → song meta (bpm, scale, genre…)
 *                  00-intro.json                    → section 0
 *                  01-main.json                     → section 1
 *                  02-break.json                    → section 2
 *
 * The numeric prefix (00-, 01-…) maps directly to the Ableton session slot index.
 */

import { readdir, readFile, writeFile, mkdir, stat } from 'fs/promises';
import { join, basename, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
export const SETS_DIR = join(__dirname, '../../sets');

export const ABLETON_SONG_FORMAT = Object.freeze({
  name:    'AbletonSong',
  version: '0.3',
});

/**
 * Return a copy of a full AbletonSong with the current persisted format marker.
 */
export function formatSongForSave(song) {
  if (!song?.meta || !Array.isArray(song.sections)) return song;
  return {
    ...song,
    _format: { ...ABLETON_SONG_FORMAT },
    meta:    stripMetaFormat(song.meta),
  };
}

/**
 * Normalize a loaded song. Older unversioned files are left usable; directory
 * format markers stored in meta.json are lifted to the full-song level.
 */
export function normalizeLoadedSong(song) {
  if (!song?.meta || !Array.isArray(song.sections)) return song;

  const format = normalizeSongFormat(song._format ?? song.meta?._format);
  const normalized = {
    ...song,
    meta: stripMetaFormat(song.meta),
  };

  if (format) normalized._format = format;
  return normalized;
}

export function stringifySong(song) {
  return JSON.stringify(formatSongForSave(song), null, 2);
}

export async function writeSongFile(filepath, song) {
  await writeFile(filepath, stringifySong(song), 'utf-8');
  return filepath;
}

// ─── flat file ───────────────────────────────────────────────────────────────

/**
 * Save a song as a flat JSON file in sets/.
 */
export async function saveSong(song, nameHint) {
  const slug = nameHint ? slugify(nameHint) : slugify(song.meta.genre || 'song');
  const timestamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
  const filepath = join(SETS_DIR, `${slug}_${timestamp}.json`);
  await writeSongFile(filepath, song);
  return filepath;
}

// ─── directory format ────────────────────────────────────────────────────────

/**
 * Return true if the path is a set directory (contains meta.json).
 */
export async function isSetDirectory(p) {
  try {
    const info = await stat(p);
    if (!info.isDirectory()) return false;
    await stat(join(p, 'meta.json'));
    return true;
  } catch {
    return false;
  }
}

/**
 * Canonical filename for a section file inside a set directory.
 * e.g. sectionFilename(1, 'main') → '01-main.json'
 */
export function sectionFilename(slotIndex, sectionName) {
  return `${String(slotIndex).padStart(2, '0')}-${slugify(sectionName)}.json`;
}

/**
 * Extract the slot index from a section filename.
 * e.g. '01-main.json' → 1
 * Returns null if the filename has no numeric prefix.
 */
export function slotIndexFromFilename(filename) {
  const m = basename(filename).match(/^(\d+)-/);
  return m ? parseInt(m[1], 10) : null;
}

/**
 * List section files in a set directory, sorted by slot index.
 * Returns [{filepath, slotIndex, filename}]
 */
export async function listSectionFiles(dirPath) {
  const files = await readdir(dirPath);
  return files
    .filter(f => f.endsWith('.json') && f !== 'meta.json')
    .map(f => ({ filename: f, filepath: join(dirPath, f), slotIndex: slotIndexFromFilename(f) }))
    .filter(f => f.slotIndex !== null)
    .sort((a, b) => a.slotIndex - b.slotIndex);
}

/**
 * Load a full AbletonSong from a set directory.
 */
export async function loadSetDirectory(dirPath) {
  const rawMeta = JSON.parse(await readFile(join(dirPath, 'meta.json'), 'utf-8'));
  const { _format, ...meta } = rawMeta;
  const sectionFiles = await listSectionFiles(dirPath);

  if (sectionFiles.length === 0) {
    throw new Error(`No section files found in ${dirPath}`);
  }

  const sections = await Promise.all(
    sectionFiles.map(({ filepath }) =>
      readFile(filepath, 'utf-8').then(JSON.parse)
    )
  );

  return normalizeLoadedSong({ _format, meta, sections });
}

/**
 * Save a full AbletonSong as a set directory.
 * Creates the directory if it doesn't exist.
 */
export async function saveSetDirectory(song, dirPath) {
  const formatted = formatSongForSave(song);
  await mkdir(dirPath, { recursive: true });
  await writeFile(
    join(dirPath, 'meta.json'),
    JSON.stringify({ _format: formatted._format, ...formatted.meta }, null, 2),
    'utf-8',
  );

  for (let i = 0; i < formatted.sections.length; i++) {
    const section = formatted.sections[i];
    const filename = sectionFilename(i, section.name);
    await writeFile(join(dirPath, filename), JSON.stringify(section, null, 2), 'utf-8');
  }
}

/**
 * Save or update a single section file in a set directory.
 * If meta.json doesn't exist yet, creates it from the provided meta object.
 */
export async function saveSectionToDirectory(section, slotIndex, dirPath, meta = null) {
  await mkdir(dirPath, { recursive: true });

  const metaPath = join(dirPath, 'meta.json');
  try {
    await stat(metaPath);
    const existingMeta = JSON.parse(await readFile(metaPath, 'utf-8'));
    if (!existingMeta._format) {
      await writeFile(
        metaPath,
        JSON.stringify({ _format: { ...ABLETON_SONG_FORMAT }, ...existingMeta }, null, 2),
        'utf-8',
      );
    }
  } catch {
    if (meta) {
      const formattedMeta = { _format: { ...ABLETON_SONG_FORMAT }, ...stripMetaFormat(meta) };
      await writeFile(metaPath, JSON.stringify(formattedMeta, null, 2), 'utf-8');
    }
  }

  // Remove any existing file for this slot index (name might have changed)
  const existing = await listSectionFiles(dirPath);
  const old = existing.find(f => f.slotIndex === slotIndex);
  if (old && old.filename !== sectionFilename(slotIndex, section.name)) {
    const { unlink } = await import('fs/promises');
    await unlink(old.filepath).catch(() => {});
  }

  const filename = sectionFilename(slotIndex, section.name);
  await writeFile(join(dirPath, filename), JSON.stringify(section, null, 2), 'utf-8');
  return join(dirPath, filename);
}

// ─── unified load ─────────────────────────────────────────────────────────────

/**
 * Load a song from:
 *   - an absolute path (file or directory)
 *   - a relative path from CWD
 *   - a filename or partial name inside sets/
 *
 * Returns { song: AbletonSong, filepath: string, isDirectory: boolean }
 */
export async function loadSong(nameOrPath) {
  const candidates = [];

  if (nameOrPath.startsWith('/')) {
    candidates.push(nameOrPath);
  } else {
    candidates.push(join(process.cwd(), nameOrPath));
    candidates.push(join(SETS_DIR, nameOrPath));
    if (!nameOrPath.endsWith('.json')) {
      candidates.push(join(SETS_DIR, `${nameOrPath}.json`));
    }
  }

  for (const p of candidates) {
    try {
      const info = await stat(p);

      if (info.isDirectory()) {
        const song = await loadSetDirectory(p);
        return { song, filepath: p, isDirectory: true };
      }

      if (info.isFile()) {
        const song = JSON.parse(await readFile(p, 'utf-8'));
        // Single section file (has no meta at top level)
        if (!song.meta && song.name && song.tracks) {
          return { song, filepath: p, isDirectory: false, isSectionFile: true };
        }
        return { song: normalizeLoadedSong(song), filepath: p, isDirectory: false };
      }
    } catch {
      // Try next candidate
    }
  }

  // Partial match against flat files and directories in sets/
  const entries = await listSets();
  const match = entries.find(e => e.filename.includes(nameOrPath));
  if (match) {
    if (match.isDirectory) {
      const song = await loadSetDirectory(match.filepath);
      return { song, filepath: match.filepath, isDirectory: true };
    }
    const song = JSON.parse(await readFile(match.filepath, 'utf-8'));
    return { song: normalizeLoadedSong(song), filepath: match.filepath, isDirectory: false };
  }

  throw new Error(`No set found matching "${nameOrPath}". Run \`list\` to see available sets.`);
}

// ─── list ─────────────────────────────────────────────────────────────────────

/**
 * List all saved sets (flat files and directories), sorted by mtime (newest first).
 */
export async function listSets() {
  let entries;
  try {
    entries = await readdir(SETS_DIR);
  } catch {
    return [];
  }

  const results = await Promise.all(
    entries
      .filter(e => e !== '.gitkeep')
      .map(async name => {
        const filepath = join(SETS_DIR, name);
        const info = await stat(filepath);

        if (info.isDirectory()) {
          let meta = {};
          let sectionCount = 0;
          try {
            meta = JSON.parse(await readFile(join(filepath, 'meta.json'), 'utf-8'));
            const sf = await listSectionFiles(filepath);
            sectionCount = sf.length;
          } catch {}
          return { filename: name, filepath, mtime: info.mtime, meta, isDirectory: true, sectionCount };
        }

        if (name.endsWith('.json')) {
          let meta = {};
          try {
            meta = JSON.parse(await readFile(filepath, 'utf-8')).meta || {};
          } catch {}
          return { filename: name, filepath, mtime: info.mtime, meta, isDirectory: false };
        }

        return null;
      })
  );

  return results
    .filter(Boolean)
    .sort((a, b) => b.mtime - a.mtime);
}

// ─── helpers ─────────────────────────────────────────────────────────────────

export function slugify(str) {
  return str
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '')
    .slice(0, 40);
}

function normalizeSongFormat(format) {
  if (!format || typeof format !== 'object') return null;
  const name = typeof format.name === 'string' ? format.name : ABLETON_SONG_FORMAT.name;
  const version = typeof format.version === 'string' || typeof format.version === 'number'
    ? String(format.version)
    : null;
  if (!version) return null;
  return { name, version };
}

function stripMetaFormat(meta = {}) {
  const { _format, ...rest } = meta;
  return rest;
}
