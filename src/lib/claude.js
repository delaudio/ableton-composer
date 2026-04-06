/**
 * Claude API wrapper for song generation.
 * Sends a structured prompt with schema + context and returns a parsed AbletonSong.
 */

import Anthropic from '@anthropic-ai/sdk';
import { readFile } from 'fs/promises';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const PROMPTS_DIR = join(__dirname, '../../prompts');
const SCHEMA_DIR = join(__dirname, '../../schema');

let _client = null;

function getClient() {
  if (!_client) {
    if (!process.env.ANTHROPIC_API_KEY) {
      throw new Error('ANTHROPIC_API_KEY is not set. Copy .env.example to .env and add your key.');
    }
    _client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
  }
  return _client;
}

/**
 * @param {object} options
 * @param {string} options.prompt           - User's natural language prompt
 * @param {string[]} options.trackNames     - Available track names in the Live set
 * @param {object} [options.context]        - Optional external context (weather, etc.)
 * @param {object} [options.styleProfile]   - Style profile from the analyze command
 * @param {string} [options.model]          - Claude model to use
 * @returns {Promise<object>}               - Parsed AbletonSong JSON
 */
export async function generateSong({ prompt, trackNames, context = {}, styleProfile = null, existingSong = null, model, provider = 'api' }) {
  const systemPrompt = await readFile(join(PROMPTS_DIR, 'system.md'), 'utf-8');
  const schema       = await readFile(join(SCHEMA_DIR, 'song.schema.json'), 'utf-8');

  // Build the user message (shared between both providers)
  const parts = [];

  parts.push(`## Available tracks in this Ableton set\n${trackNames.map(n => `- "${n}"`).join('\n')}`);

  if (Object.keys(context).length > 0) {
    parts.push(`## External context\n\`\`\`json\n${JSON.stringify(context, null, 2)}\n\`\`\``);
  }

  if (styleProfile) {
    parts.push(buildStyleSection(styleProfile));
  }

  if (existingSong) {
    parts.push(buildContinuationSection(existingSong));
  }

  parts.push(`## Request\n${prompt}`);
  parts.push(`## Full schema reference\n\`\`\`json\n${schema}\n\`\`\``);

  const userMessage = parts.join('\n\n');

  // ── Provider: Anthropic SDK (default) ────────────────────────────────────
  if (provider !== 'cli') {
    const client     = getClient();
    const modelToUse = model || process.env.CLAUDE_MODEL || 'claude-opus-4-5';

    const response = await client.messages.create({
      model: modelToUse,
      max_tokens: 16384,
      system: systemPrompt,
      messages: [{ role: 'user', content: userMessage }],
    });

    return parseJsonResponse(response.content[0].text.trim());
  }

  // ── Provider: Claude Code CLI ─────────────────────────────────────────────
  return generateWithClaudeCodeCLI(systemPrompt, userMessage);
}

async function generateWithClaudeCodeCLI(systemPrompt, userMessage) {
  const { spawn } = await import('child_process');

  // Combine system + user into a single prompt for the CLI.
  // Claude Code -p flag reads the prompt argument; we pipe via stdin
  // to avoid shell argument length limits.
  const fullPrompt = `${systemPrompt}\n\n${userMessage}`;

  return new Promise((resolve, reject) => {
    const proc = spawn('claude', ['-p', '--output-format', 'text'], {
      stdio: ['pipe', 'pipe', 'pipe'],
    });

    let output = '';
    let errOutput = '';

    proc.stdin.write(fullPrompt);
    proc.stdin.end();

    proc.stdout.on('data', chunk => { output += chunk; });
    proc.stderr.on('data', chunk => { errOutput += chunk; });

    proc.on('error', err => reject(new Error(`claude CLI not found: ${err.message}. Is Claude Code installed?`)));

    proc.on('close', code => {
      if (code !== 0) {
        reject(new Error(`claude CLI exited with code ${code}:\n${errOutput.slice(0, 300)}`));
        return;
      }
      resolve(parseJsonResponse(output.trim()));
    });
  });
}

function parseJsonResponse(raw) {
  const jsonStr = raw.replace(/^```(?:json)?\n?/, '').replace(/\n?```$/, '').trim();
  try {
    return JSON.parse(jsonStr);
  } catch (err) {
    throw new Error(`Invalid JSON response:\n${jsonStr.slice(0, 500)}\n\nParse error: ${err.message}`);
  }
}

// ─── Expand: add new tracks to existing sections ─────────────────────────────

const PC_NAMES = ['C','C#','D','D#','E','F','F#','G','G#','A','A#','B'];

/**
 * Ask Claude to generate new accompaniment tracks for an existing set of sections.
 *
 * @param {object}   options
 * @param {object}   options.song          - Full AbletonSong
 * @param {string[]} options.tracksToAdd   - Names of tracks to create (e.g. ['Strings','Cello'])
 * @param {string}   [options.styleHint]   - Free-form style description
 * @param {string[]} [options.sectionsFilter] - Only expand these section names (null = all)
 * @param {string}   [options.model]
 * @param {string}   [options.provider]
 */
export async function expandSong({ song, tracksToAdd, styleHint = '', sectionsFilter = null, model, provider = 'api' }) {
  const systemPrompt = await readFile(join(PROMPTS_DIR, 'expand.md'), 'utf-8');
  const { meta, sections } = song;
  const beatsPerBar = parseInt((meta.time_signature || '4/4').split('/')[0], 10) || 4;

  const targetSections = sectionsFilter
    ? sections.filter(s => sectionsFilter.includes(s.name))
    : sections;

  if (targetSections.length === 0) throw new Error('No matching sections found.');

  const parts = [];

  // ── Song metadata ────────────────────────────────────────────────────────
  parts.push([
    '## Song metadata',
    `BPM: ${meta.bpm}  |  Key: ${meta.scale || 'unknown'}  |  Time signature: ${meta.time_signature || '4/4'}  |  Genre: ${meta.genre || 'unknown'}`,
  ].join('\n'));

  // ── Existing tracks ──────────────────────────────────────────────────────
  const existingTrackNames = [...new Set(sections.flatMap(s => s.tracks.map(t => t.ableton_name)))];
  parts.push(`## Existing tracks (DO NOT re-generate these)\n${existingTrackNames.map(n => `- ${n}`).join('\n')}`);

  // ── Tracks to add ────────────────────────────────────────────────────────
  parts.push(`## Tracks to add\n${tracksToAdd.map(n => `- ${n}`).join('\n')}`);

  if (styleHint) {
    parts.push(`## Style\n${styleHint}`);
  }

  // ── Harmonic summary per section ─────────────────────────────────────────
  const summaryLines = ['## Sections with harmonic context\n'];
  for (const section of targetSections) {
    const harmony = buildHarmonicSummary(section, beatsPerBar);
    summaryLines.push(`**${section.name}** (${section.bars} bars):`);
    summaryLines.push(`  ${harmony}`);
    summaryLines.push('');
  }
  parts.push(summaryLines.join('\n'));

  parts.push(`beatsPerBar: ${beatsPerBar}`);

  const userMessage = parts.join('\n\n');

  if (provider !== 'cli') {
    const client     = getClient();
    const modelToUse = model || process.env.CLAUDE_MODEL || 'claude-opus-4-5';
    const response   = await client.messages.create({
      model: modelToUse,
      max_tokens: 16384,
      system: systemPrompt,
      messages: [{ role: 'user', content: userMessage }],
    });
    return parseJsonResponse(response.content[0].text.trim());
  }

  return generateWithClaudeCodeCLI(systemPrompt, userMessage);
}

/**
 * Build a compact per-bar harmonic summary for one section.
 * Groups all pitch classes present in each bar and lists them.
 */
function buildHarmonicSummary(section, beatsPerBar) {
  const barPcs = {};  // barIndex → Set of pitch class names
  for (const track of section.tracks) {
    for (const note of (track.clip?.notes ?? [])) {
      const bar = Math.floor(note.time / beatsPerBar);
      if (!barPcs[bar]) barPcs[bar] = new Set();
      barPcs[bar].add(PC_NAMES[note.pitch % 12]);
    }
  }

  const bars = Object.keys(barPcs).map(Number).sort((a, b) => a - b);
  if (bars.length === 0) return '(no notes)';

  return bars
    .map(b => `bar${b}:[${[...barPcs[b]].join('-')}]`)
    .join('  ');
}

// ─── Style profile → prompt section ──────────────────────────────────────────

/**
 * Convert a style profile (from `analyze`) into a concise prompt section
 * that guides Claude to generate in a similar style.
 */
function buildStyleSection(p) {
  const lines = [];
  const src = p._meta?.source ? ` (from: ${p._meta.source})` : '';
  lines.push(`## Style reference${src}`);
  lines.push('Use this as a strong creative guide — match the style closely unless the request says otherwise.\n');

  // Key & tempo
  lines.push('**Key & Tempo**');
  if (p.key && p.key !== 'unknown') lines.push(`- Key: ${p.key}  (confidence: ${p.key_confidence})`);
  if (p.bpm)           lines.push(`- BPM: ${p.bpm}`);
  if (p.time_signature) lines.push(`- Time signature: ${p.time_signature}`);
  lines.push('');

  // Track lineup & presence
  const presence = p.arrangement?.track_presence ?? {};
  if (Object.keys(presence).length > 0) {
    lines.push('**Track lineup & presence** (fraction of sections where each track plays)');
    for (const [name, ratio] of Object.entries(presence)) {
      const pct   = Math.round(ratio * 100);
      const hint  = pct === 100 ? 'always present' : pct >= 75 ? 'mostly present' : pct >= 40 ? 'occasional' : 'sparse — use sparingly';
      lines.push(`- ${name.padEnd(12)} ${pct}%  (${hint})`);
    }
    lines.push('');
  }

  // Rhythm density — convert to absolute note targets per section so Claude
  // has a concrete number to aim for rather than an abstract rate
  const npb      = p.rhythm?.notes_per_bar ?? {};
  const bps      = p.structure?.bars_per_section ?? 8;
  if (Object.keys(npb).length > 0) {
    lines.push('**Rhythm density** (notes per bar → target note count for an 8-bar section)');
    lines.push('These are TARGET counts — write approximately this many notes per section when the track is active.');
    for (const [name, n] of Object.entries(npb)) {
      const target  = Math.round(n * bps);
      const density = n < 2 ? 'slow, long notes' : n < 5 ? 'moderate groove' : n < 8 ? 'busy pattern' : 'very dense, fast notes';
      lines.push(`- ${name.padEnd(12)} ${n}/bar → ~${target} notes per section  (${density})`);
    }
    lines.push('');
  }

  // Pitch ranges
  const byTrack = p.pitch?.by_track ?? {};
  if (Object.keys(byTrack).length > 0) {
    lines.push('**Pitch ranges per track** (MIDI note numbers — stay within these ranges)');
    for (const [name, info] of Object.entries(byTrack)) {
      lines.push(`- ${name.padEnd(12)} MIDI ${info.min}–${info.max}  avg vel ${info.avg_velocity}  avg dur ${info.avg_duration} beats`);
    }
    lines.push('');
  }

  // Top pitch classes
  const pcs = p.pitch?.pitch_classes ?? {};
  if (Object.keys(pcs).length > 0) {
    const top = Object.entries(pcs).sort((a, b) => b[1] - a[1]).slice(0, 5).map(([k]) => k).join('  ');
    lines.push(`**Most-used pitch classes**: ${top}`);
    lines.push('');
  }

  // Chord vocabulary per track
  const chordsByTrack = p.pitch?.chords_by_track ?? {};
  if (Object.keys(chordsByTrack).length > 0) {
    lines.push('**Chord vocabulary** (most-used simultaneities per track — replicate these patterns)');
    for (const [name, list] of Object.entries(chordsByTrack)) {
      const str = list.map(c => `${c.chord} (×${c.count})`).join(',  ');
      lines.push(`- ${name.padEnd(12)} ${str}`);
    }
    lines.push('');
  }

  // Per-section key variation
  const kbs = p.pitch?.key_by_section ?? {};
  const kbsEntries = Object.entries(kbs);
  const uniqueKeys = new Set(kbsEntries.map(([, v]) => v.key));
  if (uniqueKeys.size > 1) {
    lines.push('**Tonal variation** (the source modulates — consider similar key changes)');
    for (const [name, info] of kbsEntries) {
      lines.push(`- ${name.padEnd(14)} ${info.key}  (conf: ${info.confidence})`);
    }
    lines.push('');
  }

  return lines.join('\n');
}

// ─── Continuation context ─────────────────────────────────────────────────────

/**
 * Build a prompt section that shows Claude the existing sections of a song,
 * so it can generate new sections that continue coherently from where it left off.
 */
function buildContinuationSection(song) {
  const { meta, sections } = song;
  const lines = [];

  lines.push('## Existing song to continue');
  lines.push('The sections below already exist. Generate ONLY the NEW sections requested — do not repeat or modify these.');
  lines.push(`Use the same BPM (${meta.bpm}), scale (${meta.scale}), time signature (${meta.time_signature}), and track names.\n`);

  lines.push(`**Existing meta**: BPM ${meta.bpm} | Scale: ${meta.scale} | Time sig: ${meta.time_signature}`);
  lines.push(`**Existing sections** (${sections.length} total, in order):`);

  for (const section of sections) {
    const trackSummary = section.tracks
      .map(t => {
        const pitches = t.clip?.notes?.map(n => n.pitch) ?? [];
        const minP    = pitches.length ? Math.min(...pitches) : null;
        const maxP    = pitches.length ? Math.max(...pitches) : null;
        const rangeStr = minP != null ? ` MIDI ${minP}–${maxP}` : '';
        return `${t.ableton_name} (${t.clip?.notes?.length ?? 0} notes${rangeStr})`;
      })
      .join(', ');
    lines.push(`  - ${section.name} (${section.bars} bars): ${trackSummary}`);
  }

  lines.push('');
  lines.push('The new sections you generate will be appended after these. Maintain harmonic and rhythmic continuity.');
  return lines.join('\n');
}
