import crypto from 'crypto';
import { mkdir, readdir, readFile, stat, writeFile } from 'fs/promises';
import { dirname, extname, basename, join } from 'path';

const DEFAULT_INVENTORY_PATH = 'plugins/inventory.json';

const PLUGIN_FORMATS = {
  au: {
    label: 'Audio Unit',
    extensions: ['.component'],
    directories: [
      '/Library/Audio/Plug-Ins/Components',
      '~/Library/Audio/Plug-Ins/Components',
    ],
  },
  vst: {
    label: 'VST',
    extensions: ['.vst'],
    directories: [
      '/Library/Audio/Plug-Ins/VST',
      '~/Library/Audio/Plug-Ins/VST',
    ],
  },
  vst3: {
    label: 'VST3',
    extensions: ['.vst3'],
    directories: [
      '/Library/Audio/Plug-Ins/VST3',
      '~/Library/Audio/Plug-Ins/VST3',
    ],
  },
  clap: {
    label: 'CLAP',
    extensions: ['.clap'],
    directories: [
      '/Library/Audio/Plug-Ins/CLAP',
      '~/Library/Audio/Plug-Ins/CLAP',
    ],
  },
};

const INSTRUMENT_KEYWORDS = [
  'synth',
  'sampler',
  'kontakt',
  'piano',
  'bass',
  'drum',
  'rompler',
  'organ',
  'string',
  'pad',
  'lead',
];

const EFFECT_KEYWORDS = [
  'reverb',
  'delay',
  'chorus',
  'flanger',
  'phaser',
  'compressor',
  'limiter',
  'eq',
  'filter',
  'distortion',
  'saturator',
  'gate',
  'transient',
  'shaper',
  'shifter',
  'de-esser',
  'deesser',
  'modulator',
  'echo',
];

export const SUPPORTED_PLUGIN_FORMATS = Object.keys(PLUGIN_FORMATS);

export async function scanLocalPlugins(options = {}) {
  const formats = normalizePluginFormats(options.formats);
  const entries = [];
  const scannedDirectories = [];
  const missingDirectories = [];
  const errors = [];

  for (const format of formats) {
    const config = PLUGIN_FORMATS[format];
    for (const rawDir of config.directories) {
      const directory = expandHomeDirectory(rawDir);
      const status = await readDirectoryIfExists(directory);

      if (!status.exists) {
        missingDirectories.push({ format, directory });
        continue;
      }

      scannedDirectories.push({ format, directory });

      for (const child of status.entries) {
        const candidatePath = join(directory, child.name);
        try {
          if (!(await isPluginCandidate(candidatePath, config.extensions))) continue;

          const plugin = await buildPluginEntry({
            candidatePath,
            directory,
            format,
            platform: options.platform || process.platform,
          });

          if (plugin) entries.push(plugin);
        } catch (err) {
          errors.push({
            format,
            path: candidatePath,
            message: err.message,
          });
        }
      }
    }
  }

  entries.sort((left, right) => {
    const byName = left.name.localeCompare(right.name);
    if (byName !== 0) return byName;
    return left.format.localeCompare(right.format);
  });

  return {
    type: 'plugin-inventory',
    version: '0.1',
    generated_at: new Date().toISOString(),
    platform: options.platform || process.platform,
    privacy_mode: 'local-full-paths',
    formats,
    scanned_directories: scannedDirectories,
    missing_directories: missingDirectories,
    errors,
    counts: buildInventoryCounts(entries),
    plugins: entries,
  };
}

export async function writePluginInventory(inventory, outPath = DEFAULT_INVENTORY_PATH) {
  const resolvedPath = resolveInventoryPath(outPath);
  await mkdir(dirname(resolvedPath), { recursive: true });
  await writeFile(resolvedPath, JSON.stringify(inventory, null, 2), 'utf-8');
  return resolvedPath;
}

export async function loadPluginInventory(pathname = DEFAULT_INVENTORY_PATH) {
  const resolvedPath = resolveInventoryPath(pathname);
  const raw = await readFile(resolvedPath, 'utf-8');
  const inventory = JSON.parse(raw);
  validatePluginInventory(inventory, resolvedPath);
  return { inventory, resolvedPath };
}

export function buildPromptSafePluginInventory(inventory) {
  validatePluginInventory(inventory, 'plugin inventory');

  return {
    type: inventory.type,
    version: inventory.version,
    generated_at: inventory.generated_at,
    platform: inventory.platform,
    formats: inventory.formats,
    counts: inventory.counts,
    plugins: inventory.plugins.map(plugin => ({
      name: plugin.name,
      manufacturer: plugin.manufacturer || null,
      format: plugin.format,
      plugin_type: plugin.plugin_type,
      install_scope: plugin.install_scope,
      path_hash: plugin.path_hash,
      tags: Array.isArray(plugin.tags) ? plugin.tags : [],
    })),
  };
}

export function formatPluginInventorySummary(inventory, options = {}) {
  validatePluginInventory(inventory, 'plugin inventory');
  const promptSafe = options.promptSafe !== false;

  return inventory.plugins.map(plugin => {
    const details = [
      plugin.format.toUpperCase(),
      plugin.plugin_type || 'unknown',
    ];

    if (plugin.manufacturer) details.push(plugin.manufacturer);
    if (plugin.install_scope) details.push(plugin.install_scope);
    if (promptSafe) {
      details.push(`hash:${String(plugin.path_hash || '').slice(0, 10)}`);
    } else if (plugin.path) {
      details.push(plugin.path);
    }

    return `${plugin.name}  [${details.join(' · ')}]`;
  });
}

export function normalizePluginFormats(value) {
  if (!value) return SUPPORTED_PLUGIN_FORMATS;

  const formats = String(value)
    .split(',')
    .map(entry => entry.trim().toLowerCase())
    .filter(Boolean);

  if (formats.length === 0) return SUPPORTED_PLUGIN_FORMATS;

  const invalid = formats.filter(format => !SUPPORTED_PLUGIN_FORMATS.includes(format));
  if (invalid.length > 0) {
    throw new Error(`Unsupported plugin formats: ${invalid.join(', ')}. Expected one or more of ${SUPPORTED_PLUGIN_FORMATS.join(', ')}.`);
  }

  return [...new Set(formats)];
}

function resolveInventoryPath(pathname) {
  return pathname.startsWith('/') ? pathname : join(process.cwd(), pathname);
}

function expandHomeDirectory(pathname) {
  if (!pathname.startsWith('~/')) return pathname;
  return join(process.env.HOME || '', pathname.slice(2));
}

async function readDirectoryIfExists(directory) {
  try {
    const stats = await stat(directory);
    if (!stats.isDirectory()) return { exists: false, entries: [] };
    const entries = await readdir(directory, { withFileTypes: true });
    return { exists: true, entries };
  } catch {
    return { exists: false, entries: [] };
  }
}

async function isPluginCandidate(candidatePath, extensions) {
  const extension = extname(candidatePath).toLowerCase();
  if (extensions.includes(extension)) return true;

  const stats = await stat(candidatePath);
  if (!stats.isDirectory()) return false;
  return extensions.includes(extension);
}

async function buildPluginEntry({ candidatePath, directory, format, platform }) {
  const extension = extname(candidatePath);
  const rawName = basename(candidatePath, extension).trim();
  const name = sanitizePluginName(rawName);
  if (!name) return null;

  return {
    name,
    manufacturer: inferManufacturer(name, candidatePath),
    format,
    plugin_type: inferPluginType(name),
    install_scope: inferInstallScope(directory),
    path: candidatePath,
    path_hash: hashPath(candidatePath),
    tags: [],
    metadata: {
      platform,
      container_name: basename(candidatePath),
      source_directory: directory,
    },
  };
}

function sanitizePluginName(value) {
  return String(value || '')
    .replace(/\.(component|vst3?|clap)$/i, '')
    .replace(/\s+/g, ' ')
    .trim();
}

function inferManufacturer(name, candidatePath) {
  const normalizedName = String(name || '').trim();
  const parentName = basename(candidatePath).split('.')[0];
  const token = normalizedName.split(/[-–:]/)[0]?.trim();
  const camelCaseHead = normalizedName.match(/^[A-Z][a-z]+/);

  if (token && token.length > 2 && token.length < normalizedName.length) {
    return token;
  }

  if (camelCaseHead?.[0] && camelCaseHead[0].length < normalizedName.length) {
    return camelCaseHead[0];
  }

  if (parentName && parentName !== normalizedName) {
    const head = parentName.split(/[-–:]/)[0]?.trim();
    if (head && head.length > 2 && head.length < parentName.length) {
      return head;
    }
  }

  return null;
}

function inferPluginType(name) {
  const value = String(name || '').toLowerCase();
  if (INSTRUMENT_KEYWORDS.some(keyword => value.includes(keyword))) return 'instrument';
  if (EFFECT_KEYWORDS.some(keyword => value.includes(keyword))) return 'effect';
  return 'unknown';
}

function inferInstallScope(directory) {
  return directory.includes('/Users/') ? 'user' : 'system';
}

function hashPath(pathname) {
  return crypto.createHash('sha256').update(pathname).digest('hex');
}

function buildInventoryCounts(entries) {
  const byFormat = {};
  const byType = {};

  for (const entry of entries) {
    byFormat[entry.format] = (byFormat[entry.format] || 0) + 1;
    byType[entry.plugin_type] = (byType[entry.plugin_type] || 0) + 1;
  }

  return {
    total: entries.length,
    by_format: byFormat,
    by_type: byType,
  };
}

function validatePluginInventory(inventory, resolvedPath) {
  if (!inventory || typeof inventory !== 'object') {
    throw new Error(`Invalid plugin inventory: ${resolvedPath}`);
  }
  if (inventory.type !== 'plugin-inventory') {
    throw new Error(`Unsupported plugin inventory type in ${resolvedPath}; expected "plugin-inventory"`);
  }
  if (!Array.isArray(inventory.plugins)) {
    throw new Error(`Plugin inventory missing plugins array: ${resolvedPath}`);
  }
}
