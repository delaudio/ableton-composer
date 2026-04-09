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

export function buildDossierPromptSection(dossier) {
  if (!dossier) return '';

  const lines = [
    '## Research dossier',
    `Topic: ${dossier.topic || 'unknown'}`,
    `Focus: ${dossier.focus || 'unknown'}`,
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
    };
  }

  return {};
}
