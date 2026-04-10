import { mkdir, readFile, writeFile } from 'fs/promises';
import { dirname, join } from 'path';
import { normalizeHistoricalStrictness } from './dossiers.js';
import { slugify } from './storage.js';

export async function loadOperationalPalette(pathname) {
  const resolvedPath = pathname.startsWith('/') ? pathname : join(process.cwd(), pathname);
  const raw = await readFile(resolvedPath, 'utf-8');
  const palette = JSON.parse(raw);
  validateOperationalPalette(palette, resolvedPath);
  return { palette, resolvedPath };
}

export async function writeOperationalPalette(palette, outPath) {
  const resolvedPath = outPath.startsWith('/') ? outPath : join(process.cwd(), outPath);
  await mkdir(dirname(resolvedPath), { recursive: true });
  await writeFile(resolvedPath, JSON.stringify(palette, null, 2), 'utf-8');
  return resolvedPath;
}

export function createOperationalPaletteFromDossier(dossier, trackNames, options = {}) {
  const strictness = normalizeHistoricalStrictness(options.historicalStrictness || 'loose');
  const names = Array.isArray(trackNames)
    ? trackNames.map(name => String(name || '').trim()).filter(Boolean)
    : [];

  if (names.length === 0) {
    throw new Error('Palette generation requires at least one track name');
  }

  const entries = names.map((trackName, index) => buildPaletteEntry(dossier, trackName, index, strictness));
  const slugBase = slugify(dossier?.slug || dossier?.topic || 'palette') || 'palette';

  return {
    type: 'operational-palette',
    version: '0.1',
    generated_at: new Date().toISOString(),
    topic: dossier?.topic || 'unknown',
    slug: `${slugBase}-palette`,
    historical_strictness: strictness,
    source_dossier_topic: dossier?.topic || 'unknown',
    tracks: entries,
  };
}

export function buildPalettePromptSection(palette) {
  if (!palette) return '';

  const lines = [
    '## Operational palette',
    `Topic: ${palette.topic || 'unknown'}`,
    `Historical strictness: ${palette.historical_strictness || 'loose'}`,
  ];

  for (const track of palette.tracks || []) {
    lines.push(`Track: ${track.track_name}`);
    lines.push(`- Role: ${track.role}`);
    lines.push(`- Instrument family: ${track.instrument_family}`);
    lines.push(`- Sound source: ${track.sound_source}`);
    lines.push(`- Register: ${track.register}`);
    lines.push(`- Articulation: ${track.articulation}`);
    lines.push(`- Rhythmic behavior: ${track.rhythmic_behavior}`);
    lines.push(`- Arrangement function: ${track.arrangement_function}`);

    if ((track.guardrails?.prefer ?? []).length > 0) {
      lines.push(`- Prefer: ${track.guardrails.prefer.join(', ')}`);
    }
    if ((track.guardrails?.caution ?? []).length > 0) {
      lines.push(`- Caution: ${track.guardrails.caution.join(', ')}`);
    }
    if ((track.guardrails?.avoid ?? []).length > 0) {
      lines.push(`- Avoid: ${track.guardrails.avoid.join(', ')}`);
    }
    if ((track.guardrails?.substitutes ?? []).length > 0) {
      lines.push(`- Substitutes: ${track.guardrails.substitutes.join(', ')}`);
    }
  }

  lines.push('Use the palette as track-level operational guidance. It should sharpen sound and role decisions without replacing the core musical request.');
  return lines.join('\n');
}

function buildPaletteEntry(dossier, trackName, index, strictness) {
  const role = inferRole(trackName);
  const guidance = roleGuidance(role, dossier, strictness);
  const guardrails = dossier?.historical_guardrails || {};

  return {
    track_name: trackName,
    role,
    order: index,
    instrument_family: guidance.instrument_family,
    sound_source: guidance.sound_source,
    register: guidance.register,
    articulation: guidance.articulation,
    rhythmic_behavior: guidance.rhythmic_behavior,
    arrangement_function: guidance.arrangement_function,
    guardrails: {
      prefer: uniqueCompact([
        ...(guidance.prefer ?? []),
        ...compactGuardrailFamilies(guardrails.allowed_instrument_families, role),
      ]),
      caution: uniqueCompact(extractGuardrailNames(guardrails.caution_instruments)),
      avoid: strictness === 'modern'
        ? []
        : uniqueCompact(extractGuardrailNames(guardrails.avoid_by_default)),
      substitutes: uniqueCompact(selectSubstitutes(guardrails.historically_plausible_substitutes, role)),
    },
  };
}

function roleGuidance(role, dossier, strictness) {
  const genre = String(dossier?.topic || '').toLowerCase();
  const modernized = strictness === 'modern' || strictness === 'hybrid';

  const defaults = {
    drums: {
      instrument_family: 'drum machine',
      sound_source: modernized ? 'tight electronic kit with period references' : 'dry period-appropriate drum machine or kit',
      register: 'full kit range with controlled low-end',
      articulation: 'tight hits, short decays, minimal fills',
      rhythmic_behavior: 'steady pulse with restrained variation',
      arrangement_function: 'anchor groove and section transitions',
      prefer: ['machine-tight timing', 'simple fills', 'controlled ambience'],
    },
    bass: {
      instrument_family: 'bass synth',
      sound_source: modernized ? 'focused synth bass with historical contour' : 'analog mono or pulse bass',
      register: 'low register, centered and supportive',
      articulation: 'short notes, sequenced or octave movement',
      rhythmic_behavior: 'ostinato or pulse-led groove',
      arrangement_function: 'lock low-end with drums and define harmonic center',
      prefer: ['short envelope', 'clear root movement'],
    },
    pad: {
      instrument_family: 'poly synth pad',
      sound_source: modernized ? 'lush pad with period voicing' : 'chorused analog/poly pad or string machine layer',
      register: 'mid-high supportive bed',
      articulation: 'sustained, smooth entries, modest motion',
      rhythmic_behavior: 'held harmonies with slow voicing changes',
      arrangement_function: 'widen sections without overcrowding rhythm',
      prefer: ['chorus or ensemble feel', 'voicing movement over density'],
    },
    lead: {
      instrument_family: 'monophonic lead synth',
      sound_source: modernized ? 'focused melodic lead with vintage contour' : 'simple square/pulse lead or compact melodic hook voice',
      register: 'mid-high focal register',
      articulation: 'clear attacks, short phrases, restrained portamento',
      rhythmic_behavior: 'hook-led phrases with space between ideas',
      arrangement_function: 'carry motif or melody without constant activity',
      prefer: ['simple hook writing', 'short phrases'],
    },
    keys: {
      instrument_family: 'keys or poly synth',
      sound_source: modernized ? 'supportive keys layer with era-aware tone' : 'organ, electric piano, or compact poly synth support',
      register: 'mid register support',
      articulation: 'chords, stabs, or light arpeggiated support',
      rhythmic_behavior: 'sync with groove, avoid constant wall-of-sound',
      arrangement_function: 'harmonic support and sectional lift',
      prefer: ['economical voicings', 'hook-supporting stabs'],
    },
    chords: {
      instrument_family: 'harmonic synth layer',
      sound_source: modernized ? 'harmonic synth comp with historical silhouette' : 'compact poly synth stabs or supportive chord layer',
      register: 'mid register',
      articulation: 'stabs, sustains, or repeated harmonic pattern',
      rhythmic_behavior: 'section-dependent harmonic punctuation',
      arrangement_function: 'define progression without masking lead',
      prefer: ['clear voicings', 'limited simultaneous layers'],
    },
    vocals: {
      instrument_family: 'lead or backing vocals',
      sound_source: modernized ? 'clean vocal layer with period-minded treatment' : 'lead vocal with simple backing layers',
      register: 'lead register focus',
      articulation: 'clear phrasing, doubles and restrained harmonies',
      rhythmic_behavior: 'phrase-driven rather than dense note grids',
      arrangement_function: 'deliver topline or hook emphasis',
      prefer: ['simple doubles', 'light backing harmonies'],
    },
    fx: {
      instrument_family: 'effects and transitions',
      sound_source: modernized ? 'transitional FX with vintage references' : 'tape echo, noise, or short transitional effects',
      register: 'broad-band but sparse use',
      articulation: 'brief swells, impacts, and transitional punctuation',
      rhythmic_behavior: 'mostly sparse, entering around section changes',
      arrangement_function: 'signal transitions and add atmosphere sparingly',
      prefer: ['tape-style echoes', 'noise bursts', 'short transitional gestures'],
    },
    other: {
      instrument_family: 'supporting instrument layer',
      sound_source: modernized ? 'supportive sound matched to the dossier era with modern flexibility' : 'supportive source aligned with the dossier era',
      register: 'context-dependent',
      articulation: 'economical and role-led',
      rhythmic_behavior: 'serve the section rather than dominate it',
      arrangement_function: 'support the arrangement without overcrowding it',
      prefer: ['economical layering', 'clear role definition'],
    },
  };

  const guidance = defaults[role] || defaults.other;

  if (genre.includes('krautrock') && role === 'keys') {
    return { ...guidance, instrument_family: 'organ or electric piano', sound_source: 'organ drone, electric piano, or analog synth support', prefer: ['drone behavior', 'incremental repetition'] };
  }
  if ((genre.includes('synth-pop') || genre.includes('synthpop')) && role === 'drums') {
    return { ...guidance, prefer: ['dry drum machine tone', 'minimal fills', 'machine-like consistency'] };
  }
  if ((genre.includes('trip-hop') || genre.includes('trip hop')) && role === 'drums') {
    return { ...guidance, instrument_family: 'breakbeat or sampled drums', sound_source: 'dusty breakbeat or sampled drum loop', prefer: ['laid-back swing', 'dub-space ambience'] };
  }

  return guidance;
}

function inferRole(trackName) {
  const value = String(trackName || '').toLowerCase();
  if (/\bdrum|kick|snare|hat|perc/.test(value)) return 'drums';
  if (/\bbass|sub|808/.test(value)) return 'bass';
  if (/\bpad|string|atmos/.test(value)) return 'pad';
  if (/\blead|melody|hook/.test(value)) return 'lead';
  if (/\bkey|piano|rhodes|organ/.test(value)) return 'keys';
  if (/\bchord|comp/.test(value)) return 'chords';
  if (/\bvocal|vox|choir/.test(value)) return 'vocals';
  if (/\bfx|impact|rise|noise/.test(value)) return 'fx';
  return 'other';
}

function compactGuardrailFamilies(values, role) {
  const families = Array.isArray(values) ? values : [];
  return families.filter(value => {
    const input = String(value || '').toLowerCase();
    if (role === 'drums') return /\bdrum|perc|kit/.test(input);
    if (role === 'bass') return /\bbass\b/.test(input);
    if (role === 'pad' || role === 'lead' || role === 'keys' || role === 'chords') return /\bsynth|organ|piano|keys|string|poly/.test(input);
    if (role === 'vocals') return /\bvocal/.test(input);
    return true;
  });
}

function extractGuardrailNames(values) {
  const entries = Array.isArray(values) ? values : [];
  return entries.map(entry => {
    if (typeof entry === 'string') return entry;
    if (entry && typeof entry === 'object') {
      return entry.reason ? `${entry.name || entry.instrument || 'unknown'} (${entry.reason})` : (entry.name || entry.instrument || 'unknown');
    }
    return null;
  }).filter(Boolean);
}

function selectSubstitutes(values, role) {
  const entries = Array.isArray(values) ? values : [];
  return entries
    .filter(entry => {
      const source = String(entry?.for || '').toLowerCase();
      if (!source) return true;
      if (role === 'drums') return /drum|kick|loop/.test(source);
      if (role === 'pad') return /pad|string/.test(source);
      if (role === 'bass') return /bass|kick/.test(source);
      if (role === 'fx') return /fx|transition|swell|noise/.test(source);
      return true;
    })
    .flatMap(entry => Array.isArray(entry?.substitutes) ? entry.substitutes : [])
    .slice(0, 6);
}

function uniqueCompact(values) {
  return [...new Set((Array.isArray(values) ? values : []).map(value => String(value || '').trim()).filter(Boolean))];
}

function validateOperationalPalette(palette, resolvedPath) {
  if (!palette || typeof palette !== 'object') {
    throw new Error(`Invalid operational palette: ${resolvedPath}`);
  }
  if (palette.type !== 'operational-palette') {
    throw new Error(`Unsupported palette type in ${resolvedPath}; expected "operational-palette"`);
  }
  if (!Array.isArray(palette.tracks) || palette.tracks.length === 0) {
    throw new Error(`Operational palette has no tracks: ${resolvedPath}`);
  }
}
