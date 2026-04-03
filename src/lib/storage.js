/**
 * File-based storage for song sets.
 * Sets are saved as JSON files in the /sets directory.
 * File name: {slug}_{timestamp}.json
 */

import { readdir, readFile, writeFile, stat } from 'fs/promises';
import { join, basename } from 'path';
import { fileURLToPath } from 'url';
import { dirname } from 'path';

const __dirname = dirname(fileURLToPath(import.meta.url));
export const SETS_DIR = join(__dirname, '../../sets');

/**
 * Save a song to the sets directory.
 * @param {object} song         - AbletonSong object
 * @param {string} [nameHint]   - Optional name hint for the filename slug
 * @returns {Promise<string>}   - Full path of saved file
 */
export async function saveSong(song, nameHint) {
  const slug = nameHint
    ? slugify(nameHint)
    : slugify(song.meta.genre || 'song');

  const timestamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
  const filename = `${slug}_${timestamp}.json`;
  const filepath = join(SETS_DIR, filename);

  await writeFile(filepath, JSON.stringify(song, null, 2), 'utf-8');
  return filepath;
}

/**
 * Load a song from the sets directory by filename or partial match.
 * @param {string} nameOrPath - Full filename, partial name, relative path, or absolute path
 * @returns {Promise<{song: object, filepath: string}>}
 */
export async function loadSong(nameOrPath) {
  // Absolute path
  if (nameOrPath.startsWith('/')) {
    const content = await readFile(nameOrPath, 'utf-8');
    return { song: JSON.parse(content), filepath: nameOrPath };
  }

  // Relative path from CWD (e.g. "sets/foo.json" or "./sets/foo.json")
  const fromCwd = join(process.cwd(), nameOrPath);
  try {
    const content = await readFile(fromCwd, 'utf-8');
    return { song: JSON.parse(content), filepath: fromCwd };
  } catch {
    // Fall through
  }

  // Exact filename in sets/
  const exactPath = join(SETS_DIR, nameOrPath.endsWith('.json') ? nameOrPath : `${nameOrPath}.json`);
  try {
    const content = await readFile(exactPath, 'utf-8');
    return { song: JSON.parse(content), filepath: exactPath };
  } catch {
    // Fall through to partial match
  }

  // Partial match (most recent matching file)
  const files = await listSets();
  const match = files.find(f => f.filename.includes(nameOrPath));
  if (!match) {
    throw new Error(`No set found matching "${nameOrPath}". Run \`list\` to see available sets.`);
  }

  const content = await readFile(match.filepath, 'utf-8');
  return { song: JSON.parse(content), filepath: match.filepath };
}

/**
 * List all saved sets, sorted by modification time (newest first).
 * @returns {Promise<Array<{filename, filepath, mtime, meta}>>}
 */
export async function listSets() {
  let files;
  try {
    files = await readdir(SETS_DIR);
  } catch {
    return [];
  }

  const jsonFiles = files.filter(f => f.endsWith('.json') && f !== '.gitkeep');

  const entries = await Promise.all(
    jsonFiles.map(async filename => {
      const filepath = join(SETS_DIR, filename);
      const info = await stat(filepath);
      let meta = {};
      try {
        const content = await readFile(filepath, 'utf-8');
        meta = JSON.parse(content).meta || {};
      } catch {
        // Skip malformed files
      }
      return { filename, filepath, mtime: info.mtime, meta };
    })
  );

  return entries.sort((a, b) => b.mtime - a.mtime);
}

// ─── helpers ────────────────────────────────────────────────────────────────

function slugify(str) {
  return str
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '')
    .slice(0, 40);
}
