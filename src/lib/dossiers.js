import { mkdir, readFile, writeFile } from 'fs/promises';
import { dirname, join } from 'path';
import { slugify } from './storage.js';

export async function loadResearchDossier(pathname) {
  const resolvedPath = pathname.startsWith('/') ? pathname : join(process.cwd(), pathname);
  const raw = await readFile(resolvedPath, 'utf-8');
  const dossier = JSON.parse(raw);

  validateResearchDossier(dossier, resolvedPath);
  return { dossier, resolvedPath };
}

export async function writeResearchDossier(dossier, outPath) {
  const resolvedPath = outPath.startsWith('/') ? outPath : join(process.cwd(), outPath);
  await mkdir(dirname(resolvedPath), { recursive: true });
  await writeFile(resolvedPath, JSON.stringify(dossier, null, 2), 'utf-8');
  return resolvedPath;
}

export const HISTORICAL_STRICTNESS_MODES = new Set(['strict', 'loose', 'hybrid', 'modern']);

export function normalizeHistoricalStrictness(value) {
  const normalized = String(value || 'loose').trim().toLowerCase();
  if (!HISTORICAL_STRICTNESS_MODES.has(normalized)) {
    throw new Error(`Invalid historical strictness: ${value}. Expected one of strict, loose, hybrid, modern.`);
  }
  return normalized;
}

export function createGenreResearchDossier(topic) {
  const normalizedTopic = String(topic || '').trim();
  if (!normalizedTopic) {
    throw new Error('Research topic is required');
  }

  const catalog = matchGenreTemplate(normalizedTopic);
  const period = inferPeriod(normalizedTopic);
  const dossier = {
    type: 'research-dossier',
    version: '0.1',
    generated_at: new Date().toISOString(),
    focus: 'genre',
    topic: normalizedTopic,
    slug: slugify(normalizedTopic) || 'research-dossier',
    historical_context: {
      period: period || catalog.period || '',
      geography: catalog.geography || [],
      scenes: catalog.scenes || [],
      summary: catalog.summary || `Creative dossier seed for ${normalizedTopic}. Expand the historical framing before treating this as authoritative research.`,
    },
    instrumentation_families: catalog.instrumentation_families || [],
    production_traits: catalog.production_traits || [],
    arrangement_traits: catalog.arrangement_traits || [],
    rhythm_harmony_tendencies: catalog.rhythm_harmony_tendencies || [],
    sound_design_traits: catalog.sound_design_traits || [],
    suggested_role_palette: catalog.suggested_role_palette || [],
    historical_guardrails: catalog.historical_guardrails || buildDefaultHistoricalGuardrails(period || catalog.period || '', catalog.instrumentation_families || []),
    historical_constraints_and_caveats: catalog.historical_constraints_and_caveats || [
      'Separate era-faithful traits from modern convenience choices.',
      'Do not treat this dossier as a license to imitate a specific artist or song too closely.',
    ],
    facts: catalog.facts || [
      {
        claim: `Topic requested: ${normalizedTopic}`,
        confidence: 'high',
        source_note: 'User-specified request topic',
      },
    ],
    inferences: catalog.inferences || [
      {
        claim: 'Suggested role palette and production traits are creative guidance synthesized from the requested topic, not verified musicological fact.',
        confidence: 'medium',
      },
    ],
    sources: catalog.sources || [
      {
        label: 'Manual authoring required',
        type: 'editorial-note',
        note: 'Add books, interviews, liner notes, production analyses, or trusted secondary sources before relying on this dossier as research.',
      },
    ],
    confidence_notes: catalog.confidence_notes || [
      'This is a seed dossier intended to structure further research and prompt guidance.',
      'Keep facts, inferences, and later-added citations separate.',
    ],
    prompt_guidance: [
      'Use this dossier as a constraint layer alongside style profiles, not as a replacement for them.',
      'Prefer broad historical and production traits over artist-specific mimicry.',
      'When facts and inferences conflict, facts win and inferences should be softened.',
    ],
  };

  return dossier;
}

export function buildDossierPromptSection(dossier, options = {}) {
  if (!dossier) return '';
  const strictness = normalizeHistoricalStrictness(options.historicalStrictness || 'loose');

  const lines = [
    '## Research dossier',
    `Topic: ${dossier.topic || 'unknown'}`,
    `Focus: ${dossier.focus || 'unknown'}`,
    `Historical strictness: ${strictness}`,
  ];

  const historical = dossier.historical_context || {};
  if (historical.period) lines.push(`Period: ${historical.period}`);
  if (Array.isArray(historical.geography) && historical.geography.length > 0) {
    lines.push(`Geography: ${historical.geography.join(', ')}`);
  }
  if (Array.isArray(historical.scenes) && historical.scenes.length > 0) {
    lines.push(`Scenes: ${historical.scenes.join(', ')}`);
  }
  if (historical.summary) {
    lines.push(`Historical summary: ${historical.summary}`);
  }

  pushList(lines, 'Instrumentation families', dossier.instrumentation_families);
  pushList(lines, 'Production traits', dossier.production_traits);
  pushList(lines, 'Arrangement traits', dossier.arrangement_traits);
  pushList(lines, 'Rhythm and harmony tendencies', dossier.rhythm_harmony_tendencies);
  pushList(lines, 'Sound design traits', dossier.sound_design_traits);
  pushList(lines, 'Suggested role palette', dossier.suggested_role_palette);
  pushHistoricalGuardrails(lines, dossier.historical_guardrails, strictness);
  pushList(lines, 'Historical constraints and caveats', dossier.historical_constraints_and_caveats);

  const facts = normalizeClaims(dossier.facts);
  if (facts.length > 0) {
    lines.push('Facts (treat as stronger than inferences):');
    for (const fact of facts) {
      lines.push(`- ${fact.claim}${fact.confidence ? ` [confidence: ${fact.confidence}]` : ''}${fact.source_note ? ` [source: ${fact.source_note}]` : ''}`);
    }
  }

  const inferences = normalizeClaims(dossier.inferences);
  if (inferences.length > 0) {
    lines.push('Inferences (creative guidance, not hard historical fact):');
    for (const inference of inferences) {
      lines.push(`- ${inference.claim}${inference.confidence ? ` [confidence: ${inference.confidence}]` : ''}`);
    }
  }

  const sources = Array.isArray(dossier.sources) ? dossier.sources : [];
  if (sources.length > 0) {
    lines.push('Sources and evidence notes:');
    for (const source of sources.slice(0, 8)) {
      const label = source.label || source.url || source.note || 'source';
      const extra = [source.type, source.url].filter(Boolean).join(' · ');
      lines.push(`- ${label}${extra ? ` (${extra})` : ''}`);
    }
  }

  pushList(lines, 'Confidence notes', dossier.confidence_notes);
  pushList(lines, 'Prompt guidance', dossier.prompt_guidance);

  lines.push('Use the dossier to shape instrumentation, arrangement, harmony, and sound design choices without copying any specific artist, recording, or composition.');

  return lines.join('\n');
}

function pushList(lines, heading, values) {
  if (!Array.isArray(values) || values.length === 0) return;
  lines.push(`${heading}:`);
  for (const value of values) {
    lines.push(`- ${value}`);
  }
}

function pushHistoricalGuardrails(lines, guardrails, strictness) {
  if (!guardrails || typeof guardrails !== 'object') return;

  const period = guardrails.target_period || {};
  const periodLabel = [
    Number.isFinite(period.start_year) ? period.start_year : null,
    Number.isFinite(period.end_year) ? period.end_year : null,
  ].filter(value => value != null).join('-');

  if (
    !periodLabel &&
    !Array.isArray(guardrails.allowed_instrument_families) &&
    !Array.isArray(guardrails.caution_instruments) &&
    !Array.isArray(guardrails.avoid_by_default) &&
    !Array.isArray(guardrails.historically_plausible_substitutes)
  ) {
    return;
  }

  lines.push(`Historical guardrails (${describeStrictness(strictness)}):`);
  if (periodLabel) lines.push(`- Target period: ${periodLabel}`);
  if (guardrails.anachronism_policy) lines.push(`- Anachronism policy: ${guardrails.anachronism_policy}`);

  if (Array.isArray(guardrails.allowed_instrument_families) && guardrails.allowed_instrument_families.length > 0) {
    lines.push(`- Allowed instrument families: ${guardrails.allowed_instrument_families.join(', ')}`);
  }

  if (Array.isArray(guardrails.caution_instruments) && guardrails.caution_instruments.length > 0) {
    lines.push('- Caution instruments:');
    for (const entry of guardrails.caution_instruments) {
      lines.push(`  - ${formatGuardrailEntry(entry)}`);
    }
  }

  if (Array.isArray(guardrails.avoid_by_default) && guardrails.avoid_by_default.length > 0) {
    lines.push('- Avoid by default:');
    for (const entry of guardrails.avoid_by_default) {
      lines.push(`  - ${formatGuardrailEntry(entry)}`);
    }
  }

  if (Array.isArray(guardrails.historically_plausible_substitutes) && guardrails.historically_plausible_substitutes.length > 0) {
    lines.push('- Historically plausible substitutes:');
    for (const entry of guardrails.historically_plausible_substitutes) {
      const source = entry.for || entry.source || 'modern instrument';
      const substitutes = Array.isArray(entry.substitutes) ? entry.substitutes.join(', ') : '';
      const reason = entry.reason ? ` (${entry.reason})` : '';
      lines.push(`  - ${source} -> ${substitutes || 'n/a'}${reason}`);
    }
  }
}

function normalizeClaims(values) {
  if (!Array.isArray(values)) return [];
  return values
    .map(entry => {
      if (typeof entry === 'string') return { claim: entry };
      if (entry && typeof entry === 'object') return entry;
      return null;
    })
    .filter(Boolean);
}

function validateResearchDossier(dossier, resolvedPath) {
  if (!dossier || typeof dossier !== 'object') {
    throw new Error(`Invalid research dossier: ${resolvedPath}`);
  }
  if (dossier.type !== 'research-dossier') {
    throw new Error(`Unsupported dossier type in ${resolvedPath}; expected "research-dossier"`);
  }
  if (!dossier.topic) {
    throw new Error(`Research dossier missing topic: ${resolvedPath}`);
  }
  if (dossier.historical_guardrails != null && typeof dossier.historical_guardrails !== 'object') {
    throw new Error(`Research dossier historical_guardrails must be an object: ${resolvedPath}`);
  }
}

function inferPeriod(topic) {
  const match = String(topic).match(/\b(19|20)\d{2}(?:\s*[-–]\s*(19|20)\d{2})?\b/);
  return match ? match[0].replace(/\s+/g, '') : '';
}

function matchGenreTemplate(topic) {
  const value = String(topic || '').toLowerCase();

  if (value.includes('synth-pop') || value.includes('synthpop')) {
    return {
      period: 'late 1970s to mid 1980s',
      geography: ['UK', 'Western Europe', 'US'],
      scenes: ['new wave', 'post-punk crossover', 'electronic pop'],
      summary: 'Synth-pop emerged from post-punk, new wave, and affordable analog/polyphonic synthesizer workflows, balancing pop hooks with machine-driven rhythm and melodic economy.',
      instrumentation_families: ['drum machines', 'analog or early digital polysynths', 'mono bass synths', 'clean electric bass or guitar accents', 'lead vocals', 'simple backing vocals'],
      production_traits: ['tight drum programming', 'bright but controlled reverbs', 'chorus and ensemble modulation', 'hook-first arrangement', 'economical low-end'],
      arrangement_traits: ['clear intro-verse-chorus contrasts', 'memorable synth hook', 'limited simultaneous layers', 'arrangement lifts through voicing and register rather than sheer density'],
      rhythm_harmony_tendencies: ['steady straight subdivisions', 'danceable mid-tempo pulse', 'diatonic minor/major progressions with occasional modal color', 'repeating bass ostinati'],
      sound_design_traits: ['brassy analog stabs', 'glassier pad layers', 'pulse-wave basses', 'short melodic leads with portamento used sparingly'],
      suggested_role_palette: ['drums', 'bass', 'pad', 'lead', 'keys', 'vocals', 'fx'],
      historical_guardrails: {
        target_period: { start_year: 1978, end_year: 1985 },
        allowed_instrument_families: ['analog monosynths', 'analog or early digital polysynths', 'drum machines', 'simple vocal layering', 'clean bass guitar or synth bass'],
        caution_instruments: [
          { name: 'Yamaha DX7', reason: 'belongs more to the mid-1980s edge than the earliest synth-pop wave' },
          { name: 'TR-909', reason: 'more late and hybrid than default early synth-pop grounding' },
        ],
        avoid_by_default: [
          { name: 'supersaw trance stacks', reason: 'decades-later EDM texture' },
          { name: 'modern cinematic riser impacts', reason: 'not period-native as a default palette' },
        ],
        historically_plausible_substitutes: [
          { for: 'modern supersaw pad', substitutes: ['Juno-style chorused pad', 'string machine ensemble'], reason: 'closer to period texture and voicing' },
          { for: 'aggressive EDM kick', substitutes: ['Linn/DMX-style drum machine kick', 'dry analog kick'], reason: 'keeps the low end period-plausible' },
        ],
        anachronism_policy: 'Prefer period-plausible synth and drum machine sources; allow later digital colors only as edge cases, not defaults.',
      },
      historical_constraints_and_caveats: ['Avoid modern supersaw stack density unless intentionally hybridizing eras.', 'Keep drum programming simpler than contemporary EDM.'],
      facts: [
        { claim: 'Synth-pop is closely associated with late 1970s to mid 1980s electronic pop and new wave scenes.', confidence: 'medium', source_note: 'Seed template' },
      ],
    };
  }

  if (value.includes('krautrock')) {
    return {
      period: 'late 1960s to mid 1970s',
      geography: ['West Germany'],
      scenes: ['kosmische musik', 'experimental rock', 'motorik-driven psychedelic rock'],
      summary: 'Krautrock grouped several West German experimental scenes that emphasized repetition, texture, long-form development, and a break from Anglo-American rock conventions.',
      instrumentation_families: ['drum kit', 'electric bass', 'electric guitar', 'organ or electric piano', 'analog synths', 'tape effects', 'percussion'],
      production_traits: ['repetition over chorus-hook writing', 'room ambience or tape-space texture', 'gradual layering', 'hypnotic groove persistence'],
      arrangement_traits: ['long sections', 'incremental development', 'ostinato bass or drum pulse', 'textural transitions over hard cuts'],
      rhythm_harmony_tendencies: ['motorik 4/4 possibilities', 'pedal points', 'modal harmony', 'slow harmonic rhythm'],
      sound_design_traits: ['organ drones', 'tape echo', 'filter sweeps', 'noisy transitional texture', 'modular or semi-modular synth accents'],
      suggested_role_palette: ['drums', 'bass', 'lead', 'pad', 'keys', 'fx'],
      historical_guardrails: {
        target_period: { start_year: 1968, end_year: 1976 },
        allowed_instrument_families: ['drum kit', 'electric bass', 'electric guitar', 'organ', 'electric piano', 'analog synths', 'tape effects', 'percussion'],
        caution_instruments: [
          { name: 'TR-808', reason: 'appears after the core krautrock period' },
          { name: 'polyphonic DCO synth pop textures', reason: 'more aligned with later late-70s/80s production language' },
        ],
        avoid_by_default: [
          { name: 'Korg M1', reason: 'late-1980s ROMpler far outside the target period' },
          { name: 'modern EDM sidechain pumping', reason: 'anachronistic mix behavior for this context' },
        ],
        historically_plausible_substitutes: [
          { for: 'rompler workstation pad', substitutes: ['organ drone', 'analog synth drone', 'tape-treated electric piano'], reason: 'matches period technology and texture' },
          { for: 'sample-pack transition FX', substitutes: ['tape echo swell', 'noise burst', 'filter sweep'], reason: 'keeps transitions grounded in period-plausible studio moves' },
        ],
        anachronism_policy: 'Stay close to late-1960s to mid-1970s instrument technology unless the user explicitly asks for a hybrid update.',
      },
      historical_constraints_and_caveats: ['Do not collapse all krautrock into one tempo or one drum pattern.', 'Leave room for experimental texture and repetition instead of constant sectional turnover.'],
      facts: [
        { claim: 'Krautrock commonly refers to diverse West German experimental rock scenes active around the late 1960s through mid 1970s.', confidence: 'medium', source_note: 'Seed template' },
      ],
    };
  }

  if (value.includes('trip-hop') || value.includes('trip hop')) {
    return {
      period: '1990s',
      geography: ['UK'],
      scenes: ['Bristol sound', 'downtempo', 'sample-based hip-hop crossover'],
      summary: 'Trip-hop often combines hip-hop-derived beat language, dub-influenced space, soul or jazz harmony references, and moody cinematic pacing.',
      instrumentation_families: ['breakbeats', 'electric bass or sampled bass', 'keys', 'pads', 'guitar fragments', 'vocals', 'turntable or texture layers'],
      production_traits: ['dusty sampling aesthetic', 'slow swing', 'dub-style sends', 'dark atmospheres', 'deliberate negative space'],
      arrangement_traits: ['groove-led sections', 'subtle rather than explosive lifts', 'loop mutation over constant rewrites'],
      rhythm_harmony_tendencies: ['laid-back swing', 'minor-key bias', 'soul/jazz chord color', 'repetitive but slowly evolving rhythmic cells'],
      sound_design_traits: ['vinyl noise', 'tape or bit-reduced texture', 'dark filtered pads', 'reversed effects'],
      suggested_role_palette: ['drums', 'bass', 'keys', 'pad', 'lead', 'vocals', 'fx'],
      historical_guardrails: {
        target_period: { start_year: 1990, end_year: 1999 },
        allowed_instrument_families: ['samplers', 'breakbeats', 'electric bass or sampled bass', 'keys', 'pads', 'guitar fragments', 'vocals', 'turntable texture'],
        caution_instruments: [
          { name: 'ultra-clean modern mastering chain choices', reason: 'can erase the dusty and dubby character associated with the style' },
        ],
        avoid_by_default: [
          { name: 'modern festival EDM supersaws', reason: 'not part of the core trip-hop production language' },
        ],
        historically_plausible_substitutes: [
          { for: 'hyper-clean modern drum programming', substitutes: ['swung breakbeat', 'dusty sampled drum loop'], reason: 'better matches period groove language' },
        ],
        anachronism_policy: 'Prefer 1990s sampler, dub-space, and breakbeat logic; modern polish can be used, but only deliberately.',
      },
    };
  }

  return {};
}

function buildDefaultHistoricalGuardrails(periodLabel, instrumentationFamilies) {
  const { startYear, endYear } = parsePeriodRange(periodLabel);
  return {
    target_period: {
      start_year: startYear,
      end_year: endYear,
    },
    allowed_instrument_families: Array.isArray(instrumentationFamilies) ? instrumentationFamilies : [],
    caution_instruments: [],
    avoid_by_default: [],
    historically_plausible_substitutes: [],
    anachronism_policy: 'Treat historical guardrails as advisory unless the calling workflow requests stricter period discipline.',
  };
}

function parsePeriodRange(periodLabel) {
  const matches = String(periodLabel || '').match(/\b(19|20)\d{2}\b/g) || [];
  const years = matches.map(value => parseInt(value, 10)).filter(Number.isFinite);
  return {
    startYear: years[0] ?? null,
    endYear: years[1] ?? years[0] ?? null,
  };
}

function formatGuardrailEntry(entry) {
  if (typeof entry === 'string') return entry;
  if (!entry || typeof entry !== 'object') return 'unknown';
  const name = entry.name || entry.instrument || entry.value || 'unknown';
  return entry.reason ? `${name} (${entry.reason})` : name;
}

function describeStrictness(strictness) {
  switch (strictness) {
    case 'strict':
      return 'strict mode: obey avoid/caution lists strongly and stay within period-plausible choices unless explicitly overridden';
    case 'hybrid':
      return 'hybrid mode: start from the historical palette but allow selective modern/anachronistic choices when framed intentionally';
    case 'modern':
      return 'modern mode: treat guardrails as inspiration only and allow modern reinterpretation freely';
    case 'loose':
    default:
      return 'loose mode: prefer period-plausible choices but allow practical modern equivalents';
  }
}
