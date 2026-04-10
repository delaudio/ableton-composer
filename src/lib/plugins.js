import crypto from 'crypto';
import { mkdir, readdir, readFile, stat, writeFile } from 'fs/promises';
import { dirname, extname, basename, join } from 'path';

const DEFAULT_INVENTORY_PATH = 'plugins/inventory.json';
const DEFAULT_MATCH_PATH = 'plugins/matches/plugin-match.json';

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

const SYNTHESIS_KEYWORDS = [
  { value: 'analog-subtractive', patterns: ['juno', 'jup', 'prophet', 'oberheim', 'moog', 'mini', 'uno', 'synth'] },
  { value: 'fm', patterns: ['dx7', 'fm'] },
  { value: 'wavetable', patterns: ['wavetable', 'serum'] },
  { value: 'sampler', patterns: ['sampler', 'kontakt', 'rompler', 'sample'] },
];

const ROLE_KEYWORDS = {
  bass: ['bass', 'mono', 'sub'],
  pad: ['pad', 'strings', 'chorus', 'ensemble'],
  lead: ['lead', 'solo', 'mono'],
  chords: ['keys', 'piano', 'poly', 'electric piano', 'organ'],
  drums: ['drum', 'drums', 'perc', '808', '909'],
  fx: ['reverb', 'delay', 'echo', 'chorus', 'flanger', 'phaser', 'distortion', 'saturator', 'filter', 'fx'],
};

const PLUGIN_ENRICHMENT_CATALOG = [
  {
    match: /valhallasupermassive/i,
    enrichment: {
      instrument_families: ['modern algorithmic delay/reverb'],
      synthesis_type: null,
      original_release_period: { start_year: 2020, end_year: 2020 },
      role_suitability: ['fx'],
      historical_tags: ['modern', 'spacious-fx'],
      caution_for_periods: [
        { topic: 'synth-pop', reason: 'too modern and oversized as a default early-80s spatial signature' },
        { topic: 'krautrock', reason: 'modern cinematic scale exceeds period-plausible studio texture by default' },
      ],
    },
  },
  {
    match: /valhallafreqecho/i,
    enrichment: {
      instrument_families: ['delay', 'frequency shifter', 'modulation effects'],
      synthesis_type: null,
      original_release_period: { start_year: 2010, end_year: 2010 },
      role_suitability: ['fx'],
      historical_tags: ['modern', 'delay', 'frequency-shift'],
      caution_for_periods: [
        { topic: 'krautrock', reason: 'usable as a creative substitute, but the plugin itself is modern rather than period-native' },
      ],
    },
  },
  {
    match: /jun-?6|juno/i,
    enrichment: {
      instrument_families: ['analog polysynths', 'chorused pads', 'polyphonic synths'],
      synthesis_type: 'analog-subtractive',
      emulates: {
        manufacturer: 'Roland',
        model_family: 'Juno',
        models: ['Juno-6', 'Juno-60', 'Juno-106'],
      },
      original_release_period: { start_year: 1982, end_year: 1984 },
      role_suitability: ['bass', 'pad', 'lead', 'chords'],
      historical_tags: ['early-80s', 'synth-pop', 'new-wave'],
    },
  },
  {
    match: /dx7/i,
    enrichment: {
      instrument_families: ['fm synths', 'digital keys', 'digital bass'],
      synthesis_type: 'fm',
      emulates: {
        manufacturer: 'Yamaha',
        model_family: 'DX',
        models: ['DX7'],
      },
      original_release_period: { start_year: 1983, end_year: 1983 },
      role_suitability: ['bass', 'lead', 'chords', 'keys'],
      historical_tags: ['mid-80s', 'fm', 'digital'],
    },
  },
  {
    match: /prophet/i,
    enrichment: {
      instrument_families: ['analog polysynths', 'polyphonic synths'],
      synthesis_type: 'analog-subtractive',
      emulates: {
        manufacturer: 'Sequential',
        model_family: 'Prophet',
        models: ['Prophet-5', 'Prophet VS'],
      },
      original_release_period: { start_year: 1978, end_year: 1986 },
      role_suitability: ['bass', 'pad', 'lead', 'chords'],
      historical_tags: ['late-70s', 'early-80s', 'analog'],
    },
  },
  {
    match: /arp 2600|2600/i,
    enrichment: {
      instrument_families: ['semi-modular analog synths', 'analog monosynths'],
      synthesis_type: 'analog-subtractive',
      emulates: {
        manufacturer: 'ARP',
        model_family: '2600',
        models: ['ARP 2600'],
      },
      original_release_period: { start_year: 1971, end_year: 1971 },
      role_suitability: ['bass', 'lead', 'fx'],
      historical_tags: ['70s', 'analog', 'semi-modular'],
    },
  },
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

export async function writePluginMatchReport(report, outPath = DEFAULT_MATCH_PATH) {
  const resolvedPath = resolveInventoryPath(outPath);
  await mkdir(dirname(resolvedPath), { recursive: true });
  await writeFile(resolvedPath, JSON.stringify(report, null, 2), 'utf-8');
  return resolvedPath;
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
      enrichment: buildPromptSafeEnrichment(plugin.enrichment),
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
    if (plugin.enrichment?.emulates?.model_family) details.push(`emu:${plugin.enrichment.emulates.model_family}`);
    if (Array.isArray(plugin.enrichment?.instrument_families) && plugin.enrichment.instrument_families[0]) {
      details.push(plugin.enrichment.instrument_families[0]);
    }
    if (promptSafe) {
      details.push(`hash:${String(plugin.path_hash || '').slice(0, 10)}`);
    } else if (plugin.path) {
      details.push(plugin.path);
    }

    return `${plugin.name}  [${details.join(' · ')}]`;
  });
}

export function enrichPluginInventory(inventory) {
  validatePluginInventory(inventory, 'plugin inventory');

  const enrichedPlugins = inventory.plugins.map(plugin => {
    const enrichment = buildPluginEnrichment(plugin);
    return {
      ...plugin,
      enrichment,
    };
  });

  return {
    ...inventory,
    version: '0.2',
    enriched_at: new Date().toISOString(),
    plugins: enrichedPlugins,
    counts: buildInventoryCounts(enrichedPlugins),
  };
}

export function matchPluginsToDossier(inventory, dossier) {
  validatePluginInventory(inventory, 'plugin inventory');

  const topic = String(dossier?.topic || '').toLowerCase();
  const instrumentationFamilies = normalizeStringList(dossier?.instrumentation_families);
  const allowedFamilies = normalizeStringList(dossier?.historical_guardrails?.allowed_instrument_families);
  const cautionNames = normalizeGuardrailNames(dossier?.historical_guardrails?.caution_instruments);
  const avoidNames = normalizeGuardrailNames(dossier?.historical_guardrails?.avoid_by_default);
  const targetPeriod = dossier?.historical_guardrails?.target_period || {};

  const recommended = [];
  const caution = [];
  const avoid = [];

  for (const plugin of inventory.plugins) {
    const entry = buildMatchEntry(plugin, {
      topic,
      instrumentationFamilies,
      allowedFamilies,
      cautionNames,
      avoidNames,
      targetPeriod,
    });

    if (entry.status === 'recommended') recommended.push(entry);
    else if (entry.status === 'avoid') avoid.push(entry);
    else caution.push(entry);
  }

  const sortByScore = (left, right) => right.score - left.score || left.name.localeCompare(right.name);
  recommended.sort(sortByScore);
  caution.sort(sortByScore);
  avoid.sort(sortByScore);

  return {
    type: 'plugin-match-report',
    version: '0.1',
    generated_at: new Date().toISOString(),
    topic: dossier?.topic || 'unknown',
    inventory_generated_at: inventory.generated_at || null,
    counts: {
      recommended: recommended.length,
      caution: caution.length,
      avoid: avoid.length,
    },
    recommended,
    caution,
    avoid,
  };
}

export function formatPluginMatchReport(report, options = {}) {
  const promptSafe = options.promptSafe !== false;
  const sections = [
    { label: 'Recommended', items: report.recommended || [] },
    { label: 'Caution', items: report.caution || [] },
    { label: 'Avoid', items: report.avoid || [] },
  ];

  const lines = [];
  for (const section of sections) {
    lines.push(`${section.label}:`);
    if (section.items.length === 0) {
      lines.push('- none');
      continue;
    }
    for (const item of section.items) {
      const details = [
        item.format?.toUpperCase(),
        item.plugin_type || 'unknown',
      ].filter(Boolean);
      if (item.emulates?.model_family) details.push(`emu:${item.emulates.model_family}`);
      if (item.best_family_match) details.push(`family:${item.best_family_match}`);
      if (promptSafe) details.push(`hash:${String(item.path_hash || '').slice(0, 10)}`);
      else if (item.path) details.push(item.path);
      lines.push(`- ${item.name} [${details.join(' · ')}]`);
      for (const reason of item.reasons || []) {
        lines.push(`  • ${reason}`);
      }
    }
  }

  return lines;
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

function buildPromptSafeEnrichment(enrichment) {
  if (!enrichment || typeof enrichment !== 'object') return null;
  return {
    instrument_families: enrichment.instrument_families || [],
    synthesis_type: enrichment.synthesis_type || null,
    emulates: enrichment.emulates || null,
    original_release_period: enrichment.original_release_period || null,
    role_suitability: enrichment.role_suitability || [],
    historical_tags: enrichment.historical_tags || [],
    caution_for_periods: enrichment.caution_for_periods || [],
  };
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
    enrichment: null,
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
  let enriched = 0;

  for (const entry of entries) {
    byFormat[entry.format] = (byFormat[entry.format] || 0) + 1;
    byType[entry.plugin_type] = (byType[entry.plugin_type] || 0) + 1;
    if (entry.enrichment) enriched += 1;
  }

  return {
    total: entries.length,
    by_format: byFormat,
    by_type: byType,
    enriched,
  };
}

function buildPluginEnrichment(plugin) {
  const matched = PLUGIN_ENRICHMENT_CATALOG.find(entry => entry.match.test(plugin.name));
  const keywordSynthesis = inferSynthesisType(plugin.name);
  const keywordFamilies = inferInstrumentFamilies(plugin);
  const roleSuitability = inferRoleSuitability(plugin);
  const historicalTags = inferHistoricalTags(plugin, matched?.enrichment);

  return {
    instrument_families: uniqueStrings([
      ...(matched?.enrichment?.instrument_families || []),
      ...keywordFamilies,
    ]),
    synthesis_type: matched?.enrichment?.synthesis_type ?? keywordSynthesis ?? null,
    emulates: matched?.enrichment?.emulates || inferEmulation(plugin),
    original_release_period: matched?.enrichment?.original_release_period || inferOriginalReleasePeriod(plugin),
    role_suitability: uniqueStrings([
      ...(matched?.enrichment?.role_suitability || []),
      ...roleSuitability,
    ]),
    historical_tags: uniqueStrings([
      ...(matched?.enrichment?.historical_tags || []),
      ...historicalTags,
    ]),
    caution_for_periods: matched?.enrichment?.caution_for_periods || [],
  };
}

function inferSynthesisType(name) {
  const value = String(name || '').toLowerCase();
  for (const entry of SYNTHESIS_KEYWORDS) {
    if (entry.patterns.some(pattern => value.includes(pattern))) return entry.value;
  }
  return null;
}

function inferInstrumentFamilies(plugin) {
  const value = `${plugin.name} ${plugin.plugin_type || ''}`.toLowerCase();
  const families = [];

  if (plugin.plugin_type === 'effect') {
    if (value.includes('reverb')) families.push('reverb');
    if (value.includes('delay') || value.includes('echo')) families.push('delay');
    if (value.includes('chorus') || value.includes('flanger') || value.includes('phaser')) families.push('modulation effects');
    if (families.length === 0) families.push('effects');
    return families;
  }

  if (value.includes('drum')) families.push('drum machines');
  if (value.includes('bass') || value.includes('mono')) families.push('mono bass synths', 'analog monosynths');
  if (value.includes('pad') || value.includes('poly')) families.push('analog polysynths', 'polyphonic synths');
  if (value.includes('organ')) families.push('organ');
  if (value.includes('piano') || value.includes('keys')) families.push('electric piano', 'keys');
  if (families.length === 0 && plugin.plugin_type === 'instrument') families.push('synths');

  return uniqueStrings(families);
}

function inferRoleSuitability(plugin) {
  const value = `${plugin.name} ${plugin.plugin_type || ''}`.toLowerCase();
  const roles = [];
  for (const [role, patterns] of Object.entries(ROLE_KEYWORDS)) {
    if (patterns.some(pattern => value.includes(pattern))) roles.push(role);
  }
  if (roles.length === 0 && plugin.plugin_type === 'instrument') {
    roles.push('bass', 'pad', 'lead', 'chords');
  }
  if (roles.length === 0 && plugin.plugin_type === 'effect') {
    roles.push('fx');
  }
  return uniqueStrings(roles);
}

function inferHistoricalTags(plugin, matched) {
  const tags = [];
  const period = matched?.original_release_period || inferOriginalReleasePeriod(plugin);
  if (period?.start_year && period.start_year < 1980) tags.push('70s');
  if (period?.start_year && period.start_year >= 1980 && period.start_year < 1990) tags.push('80s');
  if (period?.start_year && period.start_year >= 1990 && period.start_year < 2000) tags.push('90s');
  if (plugin.plugin_type === 'effect') tags.push('fx');
  if (plugin.plugin_type === 'instrument') tags.push('instrument');
  return uniqueStrings(tags);
}

function inferEmulation(plugin) {
  const value = String(plugin.name || '').toLowerCase();
  if (value.includes('juno') || value.includes('jun-6')) {
    return { manufacturer: 'Roland', model_family: 'Juno', models: ['Juno-6', 'Juno-60', 'Juno-106'] };
  }
  if (value.includes('dx7')) {
    return { manufacturer: 'Yamaha', model_family: 'DX', models: ['DX7'] };
  }
  if (value.includes('prophet')) {
    return { manufacturer: 'Sequential', model_family: 'Prophet', models: ['Prophet-5', 'Prophet VS'] };
  }
  return null;
}

function inferOriginalReleasePeriod(plugin) {
  const value = String(plugin.name || '').toLowerCase();
  if (value.includes('juno') || value.includes('jun-6')) return { start_year: 1982, end_year: 1984 };
  if (value.includes('dx7')) return { start_year: 1983, end_year: 1983 };
  if (value.includes('prophet')) return { start_year: 1978, end_year: 1986 };
  if (value.includes('2600')) return { start_year: 1971, end_year: 1971 };
  return null;
}

function buildMatchEntry(plugin, context) {
  const enrichment = plugin.enrichment || buildPluginEnrichment(plugin);
  const reasons = [];
  let score = 0;
  let bestFamilyMatch = null;
  let status = 'caution';

  const familyMatches = uniqueStrings([
    ...findMatchingFamilies(enrichment.instrument_families, context.instrumentationFamilies),
    ...findMatchingFamilies(enrichment.instrument_families, context.allowedFamilies),
  ]);

  if (familyMatches.length > 0) {
    bestFamilyMatch = familyMatches[0];
    score += 3;
    reasons.push(`Matches dossier instrument family "${bestFamilyMatch}".`);
  }

  const roleMatches = findMatchingRoles(enrichment.role_suitability, context.instrumentationFamilies, context.topic);
  if (roleMatches.length > 0) {
    score += 2;
    reasons.push(`Useful for roles implied by the dossier: ${roleMatches.join(', ')}.`);
  }

  if (enrichment.emulates?.model_family) {
    score += 2;
    reasons.push(`Provides an installed substitute for ${enrichment.emulates.model_family}-style hardware.`);
  }

  const periodAssessment = assessPeriod(enrichment.original_release_period, context.targetPeriod);
  if (periodAssessment.status === 'inside') {
    score += 2;
    reasons.push('Its reference release period sits inside the dossier target era.');
  } else if (periodAssessment.status === 'adjacent') {
    score += 0;
    reasons.push('Its reference release period is adjacent to the dossier target era.');
  } else if (periodAssessment.status === 'outside') {
    score -= 2;
    reasons.push('Its reference release period sits outside the dossier target era.');
  }

  const cautionMatch = findGuardrailMatch(plugin, enrichment, context.cautionNames);
  if (cautionMatch) {
    score -= 2;
    reasons.push(`Listed in dossier caution instruments as "${cautionMatch}".`);
  }

  const avoidMatch = findGuardrailMatch(plugin, enrichment, context.avoidNames);
  if (avoidMatch) {
    score -= 4;
    reasons.push(`Listed in dossier avoid-by-default instruments as "${avoidMatch}".`);
  }

  const topicCaution = (enrichment.caution_for_periods || []).find(entry => context.topic.includes(String(entry.topic || '').toLowerCase()));
  if (topicCaution) {
    score -= 2;
    reasons.push(topicCaution.reason || `Flagged as a caution for ${topicCaution.topic}.`);
  }

  if (avoidMatch || score <= -2) {
    status = 'avoid';
  } else if (score >= 4) {
    status = 'recommended';
  } else {
    status = 'caution';
  }

  return {
    name: plugin.name,
    manufacturer: plugin.manufacturer || null,
    format: plugin.format,
    plugin_type: plugin.plugin_type,
    path: plugin.path,
    path_hash: plugin.path_hash,
    install_scope: plugin.install_scope,
    score,
    status,
    best_family_match: bestFamilyMatch,
    role_suitability: enrichment.role_suitability || [],
    emulates: enrichment.emulates || null,
    instrument_families: enrichment.instrument_families || [],
    reasons,
  };
}

function normalizeStringList(values) {
  if (!Array.isArray(values)) return [];
  return values.map(value => String(value || '').toLowerCase().trim()).filter(Boolean);
}

function normalizeGuardrailNames(values) {
  if (!Array.isArray(values)) return [];
  return values
    .map(entry => {
      if (typeof entry === 'string') return entry.toLowerCase();
      if (entry && typeof entry === 'object') return String(entry.name || entry.instrument || entry.value || '').toLowerCase();
      return '';
    })
    .filter(Boolean);
}

function findMatchingFamilies(pluginFamilies = [], dossierFamilies = []) {
  const normalizedPluginFamilies = normalizeStringList(pluginFamilies);
  return normalizedPluginFamilies.filter(pluginFamily =>
    dossierFamilies.some(dossierFamily => {
      return pluginFamily.includes(dossierFamily) || dossierFamily.includes(pluginFamily) || sharedTokens(pluginFamily, dossierFamily) >= 1;
    })
  );
}

function findMatchingRoles(pluginRoles = [], instrumentationFamilies = [], topic = '') {
  const context = `${instrumentationFamilies.join(' ')} ${topic}`;
  return normalizeStringList(pluginRoles).filter(role => context.includes(role));
}

function assessPeriod(referencePeriod, targetPeriod) {
  if (!referencePeriod?.start_year || !targetPeriod?.start_year || !targetPeriod?.end_year) {
    return { status: 'unknown' };
  }

  if (referencePeriod.start_year >= targetPeriod.start_year && referencePeriod.start_year <= targetPeriod.end_year) {
    return { status: 'inside' };
  }

  const distance = Math.min(
    Math.abs(referencePeriod.start_year - targetPeriod.start_year),
    Math.abs(referencePeriod.start_year - targetPeriod.end_year)
  );

  if (distance <= 5) return { status: 'adjacent' };
  return { status: 'outside' };
}

function findGuardrailMatch(plugin, enrichment, guardrailNames) {
  const candidates = [
    plugin.name,
    plugin.manufacturer,
    enrichment.emulates?.model_family,
    ...(enrichment.emulates?.models || []),
    ...(enrichment.instrument_families || []),
  ]
    .map(value => String(value || '').toLowerCase())
    .filter(Boolean);

  return guardrailNames.find(guardrail =>
    candidates.some(candidate => candidate.includes(guardrail) || guardrail.includes(candidate))
  ) || null;
}

function sharedTokens(left, right) {
  const leftTokens = new Set(String(left || '').split(/[^a-z0-9]+/i).filter(Boolean));
  const rightTokens = new Set(String(right || '').split(/[^a-z0-9]+/i).filter(Boolean));
  let shared = 0;
  for (const token of leftTokens) {
    if (rightTokens.has(token)) shared += 1;
  }
  return shared;
}

function uniqueStrings(values) {
  return [...new Set((values || []).filter(Boolean))];
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
