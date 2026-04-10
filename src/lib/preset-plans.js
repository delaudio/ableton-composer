import { mkdir, readFile, readdir, stat, writeFile } from 'fs/promises';
import { dirname, join } from 'path';
import { loadResearchDossier } from './dossiers.js';
import { loadOperationalPalette } from './palettes.js';
import { enrichPluginInventory, loadPluginInventory, matchPluginsToDossier } from './plugins.js';
import { slugify } from './storage.js';

const DEFAULT_PLAN_ROOT = 'preset-plans';

const ROLE_CATEGORY_MAP = {
  bass: ['bass'],
  drums: ['drums'],
  pad: ['pad', 'strings', 'brass', 'poly'],
  lead: ['lead', 'brass', 'solo'],
  keys: ['keys', 'piano', 'organ', 'brass', 'poly'],
  chords: ['keys', 'pad', 'poly', 'brass'],
  vocals: ['vocal', 'voice', 'choir'],
  fx: ['fx', 'effects', 'noise'],
  other: ['bass', 'keys', 'pad', 'lead', 'fx'],
};

export async function loadPresetPlan(pathname) {
  const resolvedPath = pathname.startsWith('/') ? pathname : join(process.cwd(), pathname);
  const raw = await readFile(resolvedPath, 'utf-8');
  const plan = JSON.parse(raw);
  validatePresetPlan(plan, resolvedPath);
  return { plan, resolvedPath };
}

export async function writePresetPlan(plan, outPath) {
  const resolvedPath = outPath.startsWith('/') ? outPath : join(process.cwd(), outPath);
  await mkdir(dirname(resolvedPath), { recursive: true });
  await writeFile(resolvedPath, JSON.stringify(plan, null, 2), 'utf-8');
  return resolvedPath;
}

export async function createPresetPlan({
  dossierPath,
  palettePath,
  inventoryPath = 'plugins/inventory.json',
  installedOnly = false,
}) {
  const { dossier, resolvedPath: resolvedDossierPath } = await loadResearchDossier(dossierPath).catch(() => {
    throw new Error(`Research dossier not found or invalid: ${dossierPath}`);
  });
  const paletteLoaded = palettePath
    ? await loadOperationalPalette(palettePath).catch(() => {
        throw new Error(`Operational palette not found or invalid: ${palettePath}`);
      })
    : null;
  const palette = paletteLoaded?.palette || buildFallbackPaletteFromDossier(dossier);

  const profiles = await listPresetProfiles();
  const inventoryLoaded = await tryLoadInventory(inventoryPath);
  const enrichedInventory = inventoryLoaded ? enrichPluginInventory(inventoryLoaded.inventory) : null;
  const pluginMatch = enrichedInventory ? matchPluginsToDossier(enrichedInventory, dossier) : null;

  const roles = palette.tracks.map(track => {
    const candidates = planCandidatesForTrack(track, profiles, {
      dossier,
      inventory: enrichedInventory,
      pluginMatch,
      installedOnly,
    });

    return {
      track_name: track.track_name,
      role: track.role,
      instrument_family: track.instrument_family,
      sound_source: track.sound_source,
      prompt: buildRolePrompt(track, dossier, candidates),
      recommended_profiles: candidates.slice(0, 5),
      warnings: buildRoleWarnings(track, candidates, installedOnly),
    };
  });

  return {
    type: 'preset-plan',
    version: '0.1',
    generated_at: new Date().toISOString(),
    topic: dossier.topic,
    slug: slugify(dossier.topic || 'preset-plan') || 'preset-plan',
    source_dossier: resolvedDossierPath,
    source_palette: paletteLoaded?.resolvedPath || null,
    installed_only: installedOnly,
    inventory_path: inventoryLoaded?.resolvedPath || null,
    roles,
  };
}

export function formatPresetPlanSummary(plan) {
  validatePresetPlan(plan, 'preset plan');
  const lines = [];
  for (const role of plan.roles || []) {
    lines.push(`${role.track_name} (${role.role})`);
    lines.push(`- Instrument family: ${role.instrument_family}`);
    lines.push(`- Prompt: ${role.prompt}`);
    if ((role.recommended_profiles || []).length === 0) {
      lines.push('- Recommended profiles: none');
    } else {
      lines.push('- Recommended profiles:');
      for (const candidate of role.recommended_profiles.slice(0, 3)) {
        lines.push(`  - ${candidate.brand} / ${candidate.device} / ${candidate.category} [score ${candidate.score}]`);
      }
    }
    for (const warning of role.warnings || []) {
      lines.push(`- Warning: ${warning}`);
    }
  }
  return lines;
}

function buildFallbackPaletteFromDossier(dossier) {
  const roles = Array.isArray(dossier?.suggested_role_palette) && dossier.suggested_role_palette.length > 0
    ? dossier.suggested_role_palette
    : ['bass', 'drums', 'pad', 'lead', 'keys', 'fx'];

  return {
    type: 'operational-palette',
    topic: dossier.topic,
    tracks: roles.map((role, index) => ({
      track_name: capitalize(role),
      role,
      order: index,
      instrument_family: inferFallbackInstrumentFamily(role),
      sound_source: inferFallbackSoundSource(role),
      guardrails: {
        prefer: [],
        caution: [],
        avoid: [],
        substitutes: [],
      },
    })),
  };
}

async function listPresetProfiles(root = join(process.cwd(), 'profiles', 'presets')) {
  const files = [];
  await walkJson(root, files);
  const profiles = [];

  for (const file of files) {
    const raw = await readFile(file, 'utf-8');
    const parsed = JSON.parse(raw);
    if (parsed?._meta?.type !== 'preset-profile') continue;
    profiles.push({
      path: file,
      brand: parsed._meta.brand || 'Unknown',
      device: parsed._meta.device || 'Unknown',
      category: parsed._meta.category || 'unknown',
      preset_count: parsed._meta.preset_count || 0,
      param_count: parsed._meta.param_count || 0,
      source_dir: parsed._meta.source_dir || null,
    });
  }

  return profiles;
}

async function walkJson(dir, files) {
  let info;
  try {
    info = await stat(dir);
  } catch {
    return;
  }
  if (!info.isDirectory()) return;

  const entries = await readdir(dir, { withFileTypes: true });
  for (const entry of entries) {
    const abs = join(dir, entry.name);
    if (entry.isDirectory()) {
      await walkJson(abs, files);
    } else if (entry.isFile() && entry.name.endsWith('.json')) {
      files.push(abs);
    }
  }
}

async function tryLoadInventory(pathname) {
  try {
    return await loadPluginInventory(pathname);
  } catch {
    return null;
  }
}

function planCandidatesForTrack(track, profiles, context) {
  const desiredCategories = ROLE_CATEGORY_MAP[track.role] || ROLE_CATEGORY_MAP.other;

  const candidates = profiles
    .map(profile => {
      const categoryAffinity = getCategoryAffinity(profile.category, desiredCategories);
      const installedPlugin = matchProfileToInstalledPlugin(profile, context.inventory);
      const matchAssessment = findPluginMatch(installedPlugin, context.pluginMatch);
      const score = scoreProfileCandidate(profile, track, desiredCategories, categoryAffinity, installedPlugin, matchAssessment, context.dossier);
      return {
        profile_path: relativeToCwd(profile.path),
        brand: profile.brand,
        device: profile.device,
        category: profile.category,
        preset_count: profile.preset_count,
        installed: Boolean(installedPlugin),
        installed_plugin: installedPlugin ? {
          name: installedPlugin.name,
          format: installedPlugin.format,
          path_hash: installedPlugin.path_hash,
        } : null,
        dossier_fit: matchAssessment?.status || null,
        score,
        rationale: buildCandidateRationale(profile, track, installedPlugin, matchAssessment, desiredCategories),
      };
    })
    .filter(candidate => candidate.score > 0)
    .filter(candidate => !context.installedOnly || candidate.installed)
    .sort((left, right) => right.score - left.score || left.device.localeCompare(right.device));

  return candidates;
}

function scoreProfileCandidate(profile, track, desiredCategories, categoryAffinity, installedPlugin, matchAssessment, dossier) {
  let score = 0;

  if (categoryAffinity === 0) return -10;
  score += categoryAffinity;
  if (profile.category.toLowerCase() === track.role) score += 3;
  if (installedPlugin) score += 4;
  if (profile.preset_count > 0) score += Math.min(3, Math.round(profile.preset_count / 10));

  const deviceWords = `${profile.brand} ${profile.device}`.toLowerCase();
  if (deviceWords.includes('juno') || deviceWords.includes('jun-6')) score += 2;
  if (String(track.instrument_family || '').toLowerCase().includes('analog') && deviceWords.includes('prophet')) score += 2;

  if (matchAssessment?.status === 'recommended') score += 5;
  if (matchAssessment?.status === 'caution') score += 1;
  if (matchAssessment?.status === 'avoid') score -= 5;

  const avoidTerms = (dossier?.historical_guardrails?.avoid_by_default || [])
    .map(entry => String(entry?.name || entry?.instrument || entry || '').toLowerCase())
    .filter(Boolean);
  if (avoidTerms.some(term => deviceWords.includes(term))) score -= 4;

  return score;
}

function buildCandidateRationale(profile, track, installedPlugin, matchAssessment, desiredCategories) {
  const reasons = [];
  if (getCategoryAffinity(profile.category, desiredCategories) > 0) {
    reasons.push(`Profile category "${profile.category}" fits role "${track.role}".`);
  }
  if (installedPlugin) {
    reasons.push('Installed device match found in the local plugin inventory.');
  }
  if (matchAssessment?.status === 'recommended') {
    reasons.push('The installed plugin was recommended by dossier-aware plugin matching.');
  } else if (matchAssessment?.status === 'caution') {
    reasons.push('The installed plugin is usable but not the strongest dossier-aware match.');
  } else if (matchAssessment?.status === 'avoid') {
    reasons.push('The installed plugin conflicts with dossier guardrails and should be treated cautiously.');
  }
  if (reasons.length === 0) {
    reasons.push('Fallback candidate based on available preset profiles rather than installed-device evidence.');
  }
  return reasons;
}

function getCategoryAffinity(category, desiredCategories) {
  const value = String(category || '').toLowerCase();
  if (desiredCategories.some(entry => value === entry)) return 5;
  if (desiredCategories.some(entry => value.includes(entry) || entry.includes(value))) return 3;
  return 0;
}

function matchProfileToInstalledPlugin(profile, inventory) {
  if (!inventory?.plugins?.length) return null;

  const deviceName = String(profile.device || '').toLowerCase();
  const brandName = String(profile.brand || '').toLowerCase();

  return inventory.plugins.find(plugin => {
    const pluginName = String(plugin.name || '').toLowerCase();
    const manufacturer = String(plugin.manufacturer || '').toLowerCase();
    return (
      pluginName.includes(deviceName) ||
      deviceName.includes(pluginName) ||
      sharedTokens(pluginName, deviceName) >= 1 ||
      (brandName && manufacturer && brandName.includes(manufacturer))
    );
  }) || null;
}

function findPluginMatch(plugin, report) {
  if (!plugin || !report) return null;
  const pathHash = plugin.path_hash;
  for (const status of ['recommended', 'caution', 'avoid']) {
    const entry = (report[status] || []).find(item => item.path_hash === pathHash);
    if (entry) return { ...entry, status };
  }
  return null;
}

function buildRolePrompt(track, dossier, candidates) {
  const best = candidates[0];
  const clauses = [
    `Create a ${track.role} preset for ${track.track_name}.`,
    `Target instrument family: ${track.instrument_family}.`,
    `Sound source: ${track.sound_source}.`,
  ];

  if (best) {
    clauses.push(`Prefer the ${best.brand} ${best.device} ${best.category} profile.`);
  }

  const prefer = track.guardrails?.prefer || [];
  if (prefer.length > 0) clauses.push(`Prefer ${prefer.slice(0, 4).join(', ')}.`);

  const avoid = track.guardrails?.avoid || [];
  if (avoid.length > 0) clauses.push(`Avoid ${avoid.slice(0, 3).join(', ')}.`);

  clauses.push(`Keep it aligned with the dossier topic "${dossier.topic}".`);
  return clauses.join(' ');
}

function buildRoleWarnings(track, candidates, installedOnly) {
  const warnings = [];
  if ((candidates || []).length === 0) {
    warnings.push(installedOnly
      ? 'No installed preset-profile candidate matched this role.'
      : 'No strong preset-profile candidate matched this role.');
    return warnings;
  }

  if (!candidates[0].installed) {
    warnings.push('Top candidate is based on a local preset profile but not confirmed as installed.');
  }

  if (candidates[0].dossier_fit === 'avoid') {
    warnings.push('Top candidate conflicts with dossier guardrails; consider a different profile or a hybrid interpretation.');
  }

  if (track.role === 'fx' && candidates[0].dossier_fit === 'avoid') {
    warnings.push('FX choices often drift modern faster than core instruments for historical dossiers.');
  }

  return warnings;
}

function inferFallbackInstrumentFamily(role) {
  switch (role) {
    case 'bass': return 'bass synth';
    case 'drums': return 'drum machine';
    case 'pad': return 'poly synth pad';
    case 'lead': return 'lead synth';
    case 'keys': return 'keys or organ';
    case 'chords': return 'harmonic synth layer';
    case 'vocals': return 'lead or backing vocals';
    case 'fx': return 'effects and transitions';
    default: return 'supporting instrument layer';
  }
}

function inferFallbackSoundSource(role) {
  switch (role) {
    case 'bass': return 'focused low-end synth voice';
    case 'drums': return 'tight machine rhythm source';
    case 'pad': return 'sustained harmonic support';
    case 'lead': return 'clear melodic hook voice';
    case 'keys': return 'compact harmonic support';
    case 'chords': return 'supportive chord comp';
    case 'vocals': return 'hook-supporting vocal layer';
    case 'fx': return 'sparse transition and atmosphere layer';
    default: return 'supportive source aligned with the arrangement';
  }
}

function capitalize(value) {
  const text = String(value || '').trim();
  return text ? text.charAt(0).toUpperCase() + text.slice(1) : 'Role';
}

function relativeToCwd(pathname) {
  return pathname.startsWith(process.cwd()) ? pathname.slice(process.cwd().length + 1) : pathname;
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

function validatePresetPlan(plan, resolvedPath) {
  if (!plan || typeof plan !== 'object') {
    throw new Error(`Invalid preset plan: ${resolvedPath}`);
  }
  if (plan.type !== 'preset-plan') {
    throw new Error(`Unsupported preset plan type in ${resolvedPath}; expected "preset-plan"`);
  }
  if (!Array.isArray(plan.roles) || plan.roles.length === 0) {
    throw new Error(`Preset plan has no roles: ${resolvedPath}`);
  }
}

export function resolvePresetPlanOutputPath(topic, outPath) {
  if (outPath) return outPath;
  const slug = slugify(topic || 'preset-plan') || 'preset-plan';
  return `${DEFAULT_PLAN_ROOT}/${slug}.json`;
}
