/**
 * Shared AI provider layer for structured generation tasks.
 */

import Anthropic from '@anthropic-ai/sdk';
import OpenAI from 'openai';
import { readFile } from 'fs/promises';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import { classifyTrackRole } from './analysis.js';
import { buildDossierPromptSection } from './dossiers.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const PROMPTS_DIR = join(__dirname, '../../prompts');
const SCHEMA_DIR = join(__dirname, '../../schema');
const GENRE_PROMPTS_DIR = join(PROMPTS_DIR, 'genre');
const HARMONY_PROMPTS_DIR = join(PROMPTS_DIR, 'harmony');
const CONTINUATION_RECENT_SECTION_LIMIT = 4;

const PC_NAMES = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'];

let _anthropicClient = null;
let _openAIClient = null;

function getOpenAITimeoutMs() {
  const raw = parseInt(process.env.OPENAI_TIMEOUT_MS || '', 10);
  return Number.isFinite(raw) && raw > 0 ? raw : 120000;
}

function getOpenAIMaxRetries() {
  const raw = parseInt(process.env.OPENAI_MAX_RETRIES || '', 10);
  return Number.isFinite(raw) && raw >= 0 ? raw : 0;
}

const EXPAND_RESPONSE_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['sections'],
  properties: {
    sections: {
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['name', 'new_tracks'],
        properties: {
          name: { type: 'string' },
          new_tracks: {
            type: 'array',
            items: {
              type: 'object',
              additionalProperties: false,
              required: ['ableton_name', 'clip'],
              properties: {
                ableton_name: { type: 'string' },
                instrument: { type: 'string' },
                clip: {
                  type: 'object',
                  additionalProperties: false,
                  required: ['length_bars', 'notes'],
                  properties: {
                    length_bars: { type: 'number' },
                    loop: { type: 'boolean' },
                    notes: {
                      type: 'array',
                      items: {
                        type: 'object',
                        additionalProperties: false,
                        required: ['pitch', 'time', 'duration', 'velocity'],
                        properties: {
                          pitch: { type: 'integer' },
                          time: { type: 'number' },
                          duration: { type: 'number' },
                          velocity: { type: 'integer' },
                          muted: { type: 'boolean' },
                        },
                      },
                    },
                  },
                },
              },
            },
          },
        },
      },
    },
  },
};

const HARMONIC_PLAN_RESPONSE_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['tonal_center', 'harmonic_language', 'section_plan'],
  properties: {
    tonal_center: { type: 'string' },
    harmonic_language: { type: 'string' },
    cadence_tendency: { type: 'string' },
    progression_notes: {
      type: 'array',
      items: { type: 'string' },
    },
    section_plan: {
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['section_role', 'harmonic_intent'],
        properties: {
          section_role: { type: 'string' },
          section_name_hint: { type: 'string' },
          harmonic_intent: { type: 'string' },
          progression_hint: { type: 'string' },
          bass_motion_hint: { type: 'string' },
          cadence_hint: { type: 'string' },
          bars_hint: { type: 'integer' },
        },
      },
    },
  },
};

const ARRANGEMENT_PLAN_RESPONSE_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['global_arrangement_intent', 'section_plan'],
  properties: {
    global_arrangement_intent: { type: 'string' },
    layering_notes: {
      type: 'array',
      items: { type: 'string' },
    },
    section_plan: {
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['section_role', 'active_roles'],
        properties: {
          section_role: { type: 'string' },
          section_phase: { type: 'string' },
          section_name_hint: { type: 'string' },
          bars_hint: { type: 'integer' },
          active_roles: {
            type: 'array',
            items: { type: 'string' },
          },
          inactive_roles: {
            type: 'array',
            items: { type: 'string' },
          },
          required_roles: {
            type: 'array',
            items: { type: 'string' },
          },
          forbidden_roles: {
            type: 'array',
            items: { type: 'string' },
          },
          density_hint: { type: 'string' },
          role_budget: {
            type: 'object',
            additionalProperties: false,
            properties: {
              min_active_roles: { type: 'integer' },
              target_active_roles: { type: 'integer' },
              max_active_roles: { type: 'integer' },
              sparse_roles: {
                type: 'array',
                items: { type: 'string' },
              },
            },
          },
          entry_behavior: { type: 'string' },
          texture_hint: { type: 'string' },
        },
      },
    },
  },
};

const SONG_BLUEPRINT_RESPONSE_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['harmonic', 'arrangement'],
  properties: {
    harmonic: HARMONIC_PLAN_RESPONSE_SCHEMA,
    arrangement: ARRANGEMENT_PLAN_RESPONSE_SCHEMA,
  },
};

const PRESET_RESPONSE_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['name', 'parameters'],
  properties: {
    name: { type: 'string' },
    parameters: {
      type: 'object',
      additionalProperties: { type: 'number' },
    },
  },
};

const CRITIQUE_RESPONSE_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['score', 'rubric', 'summary', 'strengths', 'issues', 'suggested_revisions', 'followup_commands'],
  properties: {
    score: { type: 'integer' },
    rubric: { type: 'string' },
    summary: { type: 'string' },
    strengths: {
      type: 'array',
      items: { type: 'string' },
    },
    issues: {
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['severity', 'category', 'message'],
        properties: {
          severity: { type: 'string' },
          category: { type: 'string' },
          section: { type: 'string' },
          track: { type: 'string' },
          message: { type: 'string' },
          suggestion: { type: 'string' },
        },
      },
    },
    suggested_revisions: {
      type: 'array',
      items: { type: 'string' },
    },
    followup_commands: {
      type: 'array',
      items: { type: 'string' },
    },
  },
};

export function normalizeProvider(provider = 'anthropic') {
  const normalized = String(provider).toLowerCase();

  if (normalized === 'api') return 'anthropic';
  if (normalized === 'cli') return 'claude-cli';
  return normalized;
}

export function getDefaultModel(provider, explicitModel) {
  if (explicitModel) return explicitModel;

  switch (normalizeProvider(provider)) {
    case 'anthropic':
      return process.env.CLAUDE_MODEL || 'claude-opus-4-5';
    case 'openai':
      return process.env.OPENAI_MODEL || 'gpt-5.2';
    case 'codex':
      return process.env.CODEX_MODEL || process.env.OPENAI_MODEL || 'gpt-5-codex';
    case 'claude-cli':
      return process.env.CLAUDE_MODEL || 'Claude Code CLI';
    default:
      return explicitModel || provider;
  }
}

export function getProviderLabel(provider, explicitModel) {
  const normalized = normalizeProvider(provider);

  if (normalized === 'claude-cli') return 'Claude Code CLI';
  return getDefaultModel(normalized, explicitModel);
}

export function getAnthropicClient() {
  if (!_anthropicClient) {
    if (!process.env.ANTHROPIC_API_KEY) {
      throw new Error('ANTHROPIC_API_KEY is not set.');
    }
    _anthropicClient = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
  }
  return _anthropicClient;
}

export function getOpenAIClient() {
  if (!_openAIClient) {
    if (!process.env.OPENAI_API_KEY) {
      throw new Error('OPENAI_API_KEY is not set.');
    }
    _openAIClient = new OpenAI({
      apiKey: process.env.OPENAI_API_KEY,
      timeout: getOpenAITimeoutMs(),
      maxRetries: getOpenAIMaxRetries(),
    });
  }
  return _openAIClient;
}

export async function generateStructuredObject({
  provider = 'anthropic',
  model,
  systemPrompt,
  userMessage,
  responseSchema,
  schemaName = 'structured_response',
  maxTokens = 16384,
}) {
  const normalizedProvider = normalizeProvider(provider);

  switch (normalizedProvider) {
    case 'anthropic':
      return generateWithAnthropic({
        model,
        systemPrompt,
        userMessage,
        maxTokens,
      });
    case 'claude-cli':
      return generateWithClaudeCLI(systemPrompt, userMessage);
    case 'openai':
    case 'codex':
      return generateWithOpenAI({
        provider: normalizedProvider,
        model,
        systemPrompt,
        userMessage,
        responseSchema,
        schemaName,
        maxTokens,
      });
    default:
      throw new Error(`Unsupported provider: ${provider}. Use "anthropic", "openai", "codex", or "claude-cli".`);
  }
}

async function generateWithAnthropic({ model, systemPrompt, userMessage, maxTokens }) {
  const client = getAnthropicClient();
  const modelToUse = getDefaultModel('anthropic', model);

  const response = await client.messages.create({
    model: modelToUse,
    max_tokens: maxTokens,
    system: systemPrompt,
    messages: [{ role: 'user', content: userMessage }],
  });

  return parseJsonResponse(response.content[0]?.text || '');
}

async function generateWithOpenAI({ provider, model, systemPrompt, userMessage, responseSchema, schemaName, maxTokens }) {
  const client = getOpenAIClient();
  const modelToUse = getDefaultModel(provider, model);

  try {
    const response = await client.responses.create({
      model: modelToUse,
      max_output_tokens: maxTokens,
      input: [
        {
          role: 'system',
          content: [{ type: 'input_text', text: systemPrompt }],
        },
        {
          role: 'user',
          content: [{ type: 'input_text', text: userMessage }],
        },
      ],
      text: responseSchema ? {
        format: {
          type: 'json_schema',
          name: schemaName,
          schema: responseSchema,
          strict: false,
        },
      } : undefined,
    });

    const outputText = extractOpenAIOutputText(response);
    return parseJsonResponse(outputText);
  } catch (err) {
    if (err?.name === 'APIConnectionTimeoutError' || /timeout/i.test(err?.message || '')) {
      throw new Error(`OpenAI request timed out after ${Math.round(getOpenAITimeoutMs() / 1000)}s.`);
    }
    throw err;
  }
}

async function maybeGeneratePlan(enabled, factory) {
  if (!enabled) return null;
  return factory();
}

export async function generateWithClaudeCLI(systemPrompt, userMessage) {
  const { spawn } = await import('child_process');
  const fullPrompt = `${systemPrompt}\n\n${userMessage}`;
  const childEnv = Object.fromEntries(
    Object.entries(process.env).filter(([key]) => key !== 'CLAUDECODE' && key !== 'CLAUDE_CODE_ENTRYPOINT')
  );

  return new Promise((resolve, reject) => {
    const proc = spawn('claude', ['-p', '--output-format', 'text'], {
      stdio: ['pipe', 'pipe', 'pipe'],
      env: childEnv,
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

function extractOpenAIOutputText(response) {
  if (typeof response.output_text === 'string' && response.output_text.trim()) {
    return response.output_text.trim();
  }

  const chunks = [];
  for (const item of response.output || []) {
    for (const content of item.content || []) {
      if (typeof content.text === 'string') chunks.push(content.text);
    }
  }

  return chunks.join('\n').trim();
}

function parseJsonResponse(raw) {
  const jsonStr = raw.replace(/^```(?:json)?\n?/, '').replace(/\n?```$/, '').trim();
  try {
    return JSON.parse(jsonStr);
  } catch (err) {
    throw new Error(`Invalid JSON response:\n${jsonStr.slice(0, 500)}\n\nParse error: ${err.message}`);
  }
}

export async function generateSong({ prompt, trackNames, context = {}, styleProfile = null, researchDossier = null, historicalStrictness = 'loose', existingSong = null, model, provider = 'anthropic', tonalState = null }) {
  const inferredGenreKey = inferGenrePromptKey(prompt, styleProfile, researchDossier);
  const inferredHarmonyKey = inferHarmonyPromptKey(prompt, styleProfile, researchDossier);
  const systemPrompt = await buildSongGenerationPrompt({
    prompt,
    styleProfile,
    genreKey: inferredGenreKey,
    harmonyKey: inferredHarmonyKey,
  });
  const schema = JSON.parse(await readFile(join(SCHEMA_DIR, 'song.schema.json'), 'utf-8'));
  const needsHarmonicPlan = Boolean(inferredHarmonyKey || styleProfile?.harmony?.top_progressions || styleProfile?.harmony?.top_chords);
  const needsArrangementPlan = Boolean(
    styleProfile?.arrangement?.role_presence ||
    styleProfile?.arrangement?.entry_order ||
    styleProfile?.arrangement?.top_role_combinations ||
    styleProfile?.arrangement?.section_signals ||
    styleProfile?.arrangement?.section_archetypes
  );
  let harmonicPlan = null;
  let arrangementPlan = null;

  if (needsHarmonicPlan && needsArrangementPlan) {
    const blueprint = await generateSongBlueprint({
      prompt,
      trackNames,
      context,
      styleProfile,
      researchDossier,
      historicalStrictness,
      existingSong,
      tonalState,
      model,
      provider,
      genreKey: inferredGenreKey,
      harmonyKey: inferredHarmonyKey,
    });
    harmonicPlan = blueprint.harmonic;
    arrangementPlan = blueprint.arrangement;
  } else {
    [harmonicPlan, arrangementPlan] = await Promise.all([
      maybeGeneratePlan(needsHarmonicPlan, () => generateHarmonicPlan({
        prompt,
        trackNames,
        context,
        styleProfile,
        researchDossier,
        historicalStrictness,
        existingSong,
        tonalState,
        model,
        provider,
        genreKey: inferredGenreKey,
        harmonyKey: inferredHarmonyKey,
      })),
      maybeGeneratePlan(needsArrangementPlan, () => generateArrangementPlan({
        prompt,
        trackNames,
        context,
        styleProfile,
        researchDossier,
        historicalStrictness,
        existingSong,
        tonalState,
        model,
        provider,
        genreKey: inferredGenreKey,
      })),
    ]);
  }

  const parts = [];

  parts.push(`## Available tracks in this Ableton set\n${trackNames.map(n => `- "${n}"`).join('\n')}`);

  if (Object.keys(context).length > 0) {
    parts.push(`## External context\n\`\`\`json\n${JSON.stringify(context, null, 2)}\n\`\`\``);
  }

  if (styleProfile) {
    parts.push(buildStyleSection(styleProfile));
  }

  if (researchDossier) {
    parts.push(buildDossierPromptSection(researchDossier, { historicalStrictness }));
  }

  if (existingSong) {
    parts.push(buildContinuationSection(existingSong));
  }

  const resolvedTonalState = tonalState ?? deriveTonalState(existingSong);
  if (resolvedTonalState) {
    parts.push(buildTonalStateSection(resolvedTonalState));
  }

  if (harmonicPlan) {
    parts.push(`## Harmonic plan\n\`\`\`json\n${JSON.stringify(harmonicPlan, null, 2)}\n\`\`\``);
  }

  if (arrangementPlan) {
    parts.push(`## Arrangement plan\n\`\`\`json\n${JSON.stringify(arrangementPlan, null, 2)}\n\`\`\``);
  }

  parts.push(`## Request\n${prompt}`);
  parts.push(`## Full schema reference\n\`\`\`json\n${JSON.stringify(schema, null, 2)}\n\`\`\``);

  const generatedSong = await generateStructuredObject({
    provider,
    model,
    systemPrompt,
    userMessage: parts.join('\n\n'),
    responseSchema: schema,
    schemaName: 'ableton_song',
    maxTokens: 16384,
  });

  return enforceArrangementPlan(generatedSong, arrangementPlan);
}

async function buildSongGenerationPrompt({ prompt, styleProfile, genreKey = null, harmonyKey = null }) {
  const sections = [];
  const basePromptPath = join(PROMPTS_DIR, 'song-generate.md');

  sections.push(await readFile(basePromptPath, 'utf-8'));

  if (genreKey) {
    const genrePath = join(GENRE_PROMPTS_DIR, `${genreKey}.md`);
    try {
      sections.push(await readFile(genrePath, 'utf-8'));
    } catch {
      // Missing overlay should not break generation.
    }
  }

  if (harmonyKey) {
    const harmonyPath = join(HARMONY_PROMPTS_DIR, `${harmonyKey}.md`);
    try {
      sections.push(await readFile(harmonyPath, 'utf-8'));
    } catch {
      // Missing overlay should not break generation.
    }
  }

  return sections.join('\n\n');
}

async function generateHarmonicPlan({ prompt, trackNames, context = {}, styleProfile = null, researchDossier = null, historicalStrictness = 'loose', existingSong = null, tonalState = null, model, provider, genreKey = null, harmonyKey = null }) {
  const systemPrompt = await buildHarmonicPlanPrompt({ genreKey, harmonyKey });
  const parts = [];

  parts.push(`## Available tracks\n${trackNames.map(name => `- "${name}"`).join('\n')}`);

  if (Object.keys(context).length > 0) {
    parts.push(`## External context\n\`\`\`json\n${JSON.stringify(context, null, 2)}\n\`\`\``);
  }

  if (styleProfile) {
    parts.push(buildStyleSection(styleProfile));
  }

  if (researchDossier) {
    parts.push(buildDossierPromptSection(researchDossier, { historicalStrictness }));
  }

  if (existingSong) {
    parts.push(buildContinuationSection(existingSong));
  }

  const resolvedTonalState = tonalState ?? deriveTonalState(existingSong);
  if (resolvedTonalState) {
    parts.push(buildTonalStateSection(resolvedTonalState));
  }

  parts.push('## Planning task\nCreate a concise harmonic/compositional plan that the final MIDI generation should follow.');
  parts.push(`## Request\n${prompt}`);

  return generateStructuredObject({
    provider,
    model,
    systemPrompt,
    userMessage: parts.join('\n\n'),
    responseSchema: HARMONIC_PLAN_RESPONSE_SCHEMA,
    schemaName: 'harmonic_plan',
    maxTokens: 4096,
  });
}

async function generateSongBlueprint({ prompt, trackNames, context = {}, styleProfile = null, researchDossier = null, historicalStrictness = 'loose', existingSong = null, tonalState = null, model, provider, genreKey = null, harmonyKey = null }) {
  const systemPrompt = await buildSongBlueprintPrompt({ genreKey, harmonyKey });
  const parts = [];

  parts.push(`## Available tracks\n${trackNames.map(name => `- "${name}"`).join('\n')}`);

  if (Object.keys(context).length > 0) {
    parts.push(`## External context\n\`\`\`json\n${JSON.stringify(context, null, 2)}\n\`\`\``);
  }

  if (styleProfile) {
    parts.push(buildStyleSection(styleProfile));
  }

  if (researchDossier) {
    parts.push(buildDossierPromptSection(researchDossier, { historicalStrictness }));
  }

  if (existingSong) {
    parts.push(buildContinuationSection(existingSong));
  }

  const resolvedTonalState = tonalState ?? deriveTonalState(existingSong);
  if (resolvedTonalState) {
    parts.push(buildTonalStateSection(resolvedTonalState));
  }

  parts.push('## Planning task\nCreate one compact song blueprint that contains both harmonic intent and section-by-section arrangement constraints before MIDI notes are written.');
  parts.push(`## Request\n${prompt}`);

  return generateStructuredObject({
    provider,
    model,
    systemPrompt,
    userMessage: parts.join('\n\n'),
    responseSchema: SONG_BLUEPRINT_RESPONSE_SCHEMA,
    schemaName: 'song_blueprint',
    maxTokens: 4096,
  });
}

async function generateArrangementPlan({ prompt, trackNames, context = {}, styleProfile = null, researchDossier = null, historicalStrictness = 'loose', existingSong = null, model, provider, genreKey = null }) {
  const systemPrompt = await buildArrangementPlanPrompt({ genreKey });
  const parts = [];

  parts.push(`## Available tracks\n${trackNames.map(name => `- "${name}"`).join('\n')}`);

  if (Object.keys(context).length > 0) {
    parts.push(`## External context\n\`\`\`json\n${JSON.stringify(context, null, 2)}\n\`\`\``);
  }

  if (styleProfile) {
    parts.push(buildStyleSection(styleProfile));
  }

  if (researchDossier) {
    parts.push(buildDossierPromptSection(researchDossier, { historicalStrictness }));
  }

  if (existingSong) {
    parts.push(buildContinuationSection(existingSong));
  }

  parts.push('## Planning task\nCreate a concise arrangement plan that decides which roles should be active, absent, or sparse in each section before MIDI notes are written.');
  parts.push(`## Request\n${prompt}`);

  return generateStructuredObject({
    provider,
    model,
    systemPrompt,
    userMessage: parts.join('\n\n'),
    responseSchema: ARRANGEMENT_PLAN_RESPONSE_SCHEMA,
    schemaName: 'arrangement_plan',
    maxTokens: 4096,
  });
}

async function buildHarmonicPlanPrompt({ genreKey, harmonyKey }) {
  const sections = [await readFile(join(PROMPTS_DIR, 'harmonic-plan.md'), 'utf-8')];

  if (genreKey) {
    try {
      sections.push(await readFile(join(GENRE_PROMPTS_DIR, `${genreKey}.md`), 'utf-8'));
    } catch {}
  }

  if (harmonyKey) {
    try {
      sections.push(await readFile(join(HARMONY_PROMPTS_DIR, `${harmonyKey}.md`), 'utf-8'));
    } catch {}
  }

  return sections.join('\n\n');
}

async function buildArrangementPlanPrompt({ genreKey }) {
  const sections = [await readFile(join(PROMPTS_DIR, 'arrangement-plan.md'), 'utf-8')];

  if (genreKey) {
    try {
      sections.push(await readFile(join(GENRE_PROMPTS_DIR, `${genreKey}.md`), 'utf-8'));
    } catch {}
  }

  return sections.join('\n\n');
}

async function buildSongBlueprintPrompt({ genreKey, harmonyKey }) {
  const sections = [await readFile(join(PROMPTS_DIR, 'song-blueprint.md'), 'utf-8')];

  if (genreKey) {
    try {
      sections.push(await readFile(join(GENRE_PROMPTS_DIR, `${genreKey}.md`), 'utf-8'));
    } catch {}
  }

  if (harmonyKey) {
    try {
      sections.push(await readFile(join(HARMONY_PROMPTS_DIR, `${harmonyKey}.md`), 'utf-8'));
    } catch {}
  }

  return sections.join('\n\n');
}

function inferGenrePromptKey(prompt, styleProfile, researchDossier = null) {
  const haystack = buildInferenceHaystack(prompt, styleProfile, researchDossier);

  const genreMatchers = [
    { key: 'idm', patterns: ['idm', 'glitch', 'braindance', 'leftfield'] },
    { key: 'trip-hop', patterns: ['trip-hop', 'trip hop', 'bristol', 'downtempo noir', 'smoky hip-hop'] },
    { key: 'chicago-house', patterns: ['chicago house', 'jackin house', 'warehouse house', 'classic house'] },
  ];

  const match = genreMatchers.find(entry => entry.patterns.some(pattern => haystack.includes(pattern)));
  return match?.key || null;
}

function inferHarmonyPromptKey(prompt, styleProfile, researchDossier = null) {
  const haystack = buildInferenceHaystack(prompt, styleProfile, researchDossier);

  const harmonyMatchers = [
    { key: 'neo-soul', patterns: ['neo-soul', 'neosoul', 'neo soul', 'soul-jazz', 'jazz-soul', 'modern r&b', 'modern rnb', "d'angelo", 'erykah badu', 'robert glasper'] },
    { key: 'blues', patterns: ['blues', 'blues-rock', 'electric blues', 'chicago blues', 'shuffle blues', 'boogie', '12-bar', '12 bar'] },
    { key: 'jazz', patterns: ['jazz', 'bebop', 'swing', 'hard bop', 'cool jazz', 'modal jazz', 'ii-v-i', '2-5-1', '251'] },
  ];

  const match = harmonyMatchers.find(entry => entry.patterns.some(pattern => haystack.includes(pattern)));
  return match?.key || null;
}

function buildInferenceHaystack(prompt, styleProfile, researchDossier = null) {
  return [
    prompt,
    styleProfile?.genre,
    styleProfile?._meta?.source,
    styleProfile?._meta?.category,
    researchDossier?.topic,
    researchDossier?.historical_context?.summary,
    ...(researchDossier?.historical_context?.scenes ?? []),
    ...(researchDossier?.instrumentation_families ?? []),
    ...(researchDossier?.production_traits ?? []),
    ...(researchDossier?.arrangement_traits ?? []),
    ...(researchDossier?.rhythm_harmony_tendencies ?? []),
    ...(researchDossier?.sound_design_traits ?? []),
  ]
    .filter(Boolean)
    .join(' ')
    .toLowerCase();
}

export async function expandSong({ song, tracksToAdd, styleHint = '', sectionsFilter = null, model, provider = 'anthropic' }) {
  const systemPrompt = await readFile(join(PROMPTS_DIR, 'expand.md'), 'utf-8');
  const { meta, sections } = song;
  const beatsPerBar = parseInt((meta.time_signature || '4/4').split('/')[0], 10) || 4;

  const targetSections = sectionsFilter
    ? sections.filter(section => sectionsFilter.includes(section.name))
    : sections;

  if (targetSections.length === 0) throw new Error('No matching sections found.');

  const parts = [];

  parts.push([
    '## Song metadata',
    `BPM: ${meta.bpm}  |  Key: ${meta.scale || 'unknown'}  |  Time signature: ${meta.time_signature || '4/4'}  |  Genre: ${meta.genre || 'unknown'}`,
  ].join('\n'));

  const existingTrackNames = [...new Set(sections.flatMap(section => section.tracks.map(track => track.ableton_name)))];
  parts.push(`## Existing tracks (DO NOT re-generate these)\n${existingTrackNames.map(name => `- ${name}`).join('\n')}`);
  parts.push(`## Tracks to add\n${tracksToAdd.map(name => `- ${name}`).join('\n')}`);

  if (styleHint) {
    parts.push(`## Style\n${styleHint}`);
  }

  const summaryLines = ['## Sections with harmonic context\n'];
  for (const section of targetSections) {
    const harmony = buildHarmonicSummary(section, beatsPerBar);
    summaryLines.push(`**${section.name}** (${section.bars} bars):`);
    summaryLines.push(`  ${harmony}`);
    summaryLines.push('');
  }
  parts.push(summaryLines.join('\n'));
  parts.push(`beatsPerBar: ${beatsPerBar}`);

  return generateStructuredObject({
    provider,
    model,
    systemPrompt,
    userMessage: parts.join('\n\n'),
    responseSchema: EXPAND_RESPONSE_SCHEMA,
    schemaName: 'expanded_song_tracks',
    maxTokens: 16384,
  });
}

export async function generatePresetObject({ systemPrompt, userMessage, model, provider = 'anthropic' }) {
  return generateStructuredObject({
    provider,
    model,
    systemPrompt,
    userMessage,
    responseSchema: PRESET_RESPONSE_SCHEMA,
    schemaName: 'synth_preset',
    maxTokens: 4096,
  });
}

export async function critiqueSongObject({ systemPrompt, userMessage, model, provider = 'anthropic' }) {
  return generateStructuredObject({
    provider,
    model,
    systemPrompt,
    userMessage,
    responseSchema: CRITIQUE_RESPONSE_SCHEMA,
    schemaName: 'song_critique',
    maxTokens: 4096,
  });
}

function buildHarmonicSummary(section, beatsPerBar) {
  const barPcs = {};
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
    .map(bar => `bar${bar}:[${[...barPcs[bar]].join('-')}]`)
    .join('  ');
}

function buildStyleSection(p) {
  const lines = [];
  const src = p._meta?.source ? ` (from: ${p._meta.source})` : '';
  lines.push(`## Style reference${src}`);
  lines.push('Use this as a strong creative guide - match the style closely unless the request says otherwise.\n');

  lines.push('**Key & Tempo**');
  if (p.key && p.key !== 'unknown') lines.push(`- Key: ${p.key}  (confidence: ${p.key_confidence})`);
  if (p.bpm) lines.push(`- BPM: ${p.bpm}`);
  if (p.time_signature) lines.push(`- Time signature: ${p.time_signature}`);
  lines.push('');

  const presence = p.arrangement?.track_presence ?? {};
  if (Object.keys(presence).length > 0) {
    lines.push('**Track lineup & presence** (fraction of sections where each track plays)');
    for (const [name, ratio] of Object.entries(presence)) {
      const pct = Math.round(ratio * 100);
      const hint = pct === 100 ? 'always present' : pct >= 75 ? 'mostly present' : pct >= 40 ? 'occasional' : 'sparse - use sparingly';
      lines.push(`- ${name.padEnd(12)} ${pct}%  (${hint})`);
    }
    lines.push('');
  }

  const rolePresence = p.arrangement?.role_presence ?? {};
  if (Object.keys(rolePresence).length > 0) {
    lines.push('**Role presence**');
    for (const [role, ratio] of Object.entries(rolePresence)) {
      const pct = Math.round(ratio * 100);
      const hint = pct <= 15 ? 'very sparse - use in a minority of sections' :
        pct <= 35 ? 'occasional - do not keep active throughout' :
        pct <= 60 ? 'recurring but not constant' :
        pct <= 85 ? 'often active' :
        'nearly always active';
      lines.push(`- ${role.padEnd(12)} ${pct}%  (${hint})`);
    }
    const sectionCount = Number.isFinite(p.structure?.section_count) ? p.structure.section_count : null;
    if (sectionCount && sectionCount > 1) {
      lines.push('');
      lines.push('**Role presence budget**');
      lines.push(`Reference profile section count: ${sectionCount}. Scale these ratios to the requested section count; do not turn ratios into always-on parts.`);
      for (const [role, ratio] of Object.entries(rolePresence)) {
        const target = Math.max(0, Math.round(ratio * sectionCount));
        const max = Math.min(sectionCount, Math.ceil(ratio * sectionCount + 0.5));
        lines.push(`- ${role.padEnd(12)} ratio ${Math.round(ratio * 100)}% (reference ~${target}/${sectionCount} sections), avoid >${max}/${sectionCount} in equivalent scaled form unless explicitly requested`);
      }
    }
    lines.push('');
  }

  const roleConstraints = p.arrangement?.role_constraints ?? {};
  if (Object.keys(roleConstraints).length > 0) {
    lines.push('**Role constraints**');
    if (roleConstraints.target_active_roles_per_section != null) {
      lines.push(`- Target active roles per section: ${roleConstraints.target_active_roles_per_section}`);
    }
    if (roleConstraints.max_active_roles_per_section != null) {
      lines.push(`- Hard cap for active roles per section: ${roleConstraints.max_active_roles_per_section}`);
    }
    if ((roleConstraints.anchor_roles ?? []).length > 0) {
      lines.push(`- Anchor roles (high presence, but not automatically universal): ${roleConstraints.anchor_roles.join(', ')}`);
    }
    if ((roleConstraints.recurring_roles ?? []).length > 0) {
      lines.push(`- Recurring roles (use often, but leave absent in some sections): ${roleConstraints.recurring_roles.join(', ')}`);
    }
    if ((roleConstraints.occasional_roles ?? []).length > 0) {
      lines.push(`- Occasional roles: ${roleConstraints.occasional_roles.join(', ')}`);
    }
    if ((roleConstraints.sparse_roles ?? []).length > 0) {
      lines.push(`- Sparse roles: ${roleConstraints.sparse_roles.join(', ')}`);
    }
    lines.push('');
  }

  const npb = p.rhythm?.notes_per_bar ?? {};
  const bps = p.structure?.bars_per_section ?? 8;
  if (Object.keys(npb).length > 0) {
    lines.push('**Rhythm density** (notes per bar -> target note count for an 8-bar section)');
    lines.push('These are TARGET counts - write approximately this many notes per section when the track is active.');
    for (const [name, n] of Object.entries(npb)) {
      const target = Math.round(n * bps);
      const density = n < 2 ? 'slow, long notes' : n < 5 ? 'moderate groove' : n < 8 ? 'busy pattern' : 'very dense, fast notes';
      lines.push(`- ${name.padEnd(12)} ${String(n).padEnd(5)} notes/bar  ->  target ~${target} notes/section  (${density})`);
    }
    lines.push('');
  }

  const npbByRole = p.rhythm?.notes_per_bar_by_role ?? {};
  if (Object.keys(npbByRole).length > 0) {
    lines.push('**Rhythm density by role**');
    for (const [role, n] of Object.entries(npbByRole)) {
      lines.push(`- ${role.padEnd(12)} ${n} notes/bar`);
    }
    lines.push('');
  }

  const ranges = p.pitch?.range_by_track ?? {};
  if (Object.keys(ranges).length > 0) {
    lines.push('**Pitch ranges**');
    for (const [name, r] of Object.entries(ranges)) {
      lines.push(`- ${name.padEnd(12)} ${r.min ?? '?'} -> ${r.max ?? '?'}`);
    }
    lines.push('');
  }

  const chords = p.harmony?.top_chords_by_track ?? {};
  if (Object.keys(chords).length > 0) {
    lines.push('**Chord vocabulary**');
    for (const [name, entries] of Object.entries(chords)) {
      const top = (entries || []).slice(0, 6).map(c => `${c.chord}x${c.count}`).join('  ');
      lines.push(`- ${name.padEnd(12)} ${top}`);
    }
    lines.push('');
  }

  const harmonicSummary = p.harmony;
  if (harmonicSummary?.harmonic_rhythm_avg != null) {
    lines.push('**Harmonic behavior**');
    lines.push(`- Harmonic rhythm: ${harmonicSummary.harmonic_rhythm_avg} changes/bar on average`);
    if ((harmonicSummary.top_chords ?? []).length > 0) {
      lines.push(`- Top chords: ${harmonicSummary.top_chords.slice(0, 6).map(entry => `${entry.value}x${entry.count}`).join('  ')}`);
    }
    if ((harmonicSummary.top_progressions ?? []).length > 0) {
      lines.push(`- Top progressions: ${harmonicSummary.top_progressions.slice(0, 6).map(entry => `${entry.value}x${entry.count}`).join('  ')}`);
    }
    if ((harmonicSummary.top_bass_root_motion ?? []).length > 0) {
      lines.push(`- Bass root motion: ${harmonicSummary.top_bass_root_motion.slice(0, 6).map(entry => `${entry.value}x${entry.count}`).join('  ')}`);
    }
    lines.push('');
  }

  const rhythmSummary = p.rhythm;
  if (rhythmSummary?.avg_section_density != null || rhythmSummary?.by_track) {
    lines.push('**Rhythm fingerprint**');
    if (rhythmSummary?.avg_section_density != null) {
      lines.push(`- Avg section density: ${rhythmSummary.avg_section_density} notes/bar`);
    }
    const rhythmTracks = Object.entries(rhythmSummary?.by_track ?? {}).slice(0, 8);
    for (const [name, info] of rhythmTracks) {
      const topSteps = (info.onset_histogram_16 ?? [])
        .map((value, index) => ({ index, value }))
        .sort((a, b) => b.value - a.value)
        .slice(0, 4)
        .map(entry => entry.index)
        .join(', ');
      const patternStr = (info.dominant_patterns_16 ?? [])
        .slice(0, 3)
        .map(entry => `${entry.value}x${entry.count}`)
        .join('  ');
      lines.push(`- ${name.padEnd(12)} npb=${info.notes_per_bar ?? 0}  sync=${info.syncopation ?? 0}  top16=[${topSteps}]${patternStr ? `  patterns=${patternStr}` : ''}`);
    }
    lines.push('');
  }

  const arrangementSummary = p.arrangement;
  if (
    arrangementSummary?.avg_active_tracks_per_section != null ||
    arrangementSummary?.entry_order ||
    arrangementSummary?.top_layer_combinations ||
    arrangementSummary?.top_role_combinations ||
    arrangementSummary?.section_signals ||
    arrangementSummary?.section_archetypes
  ) {
    lines.push('**Arrangement fingerprint**');
    if (arrangementSummary?.avg_active_tracks_per_section != null) {
      lines.push(`- Avg active tracks per section: ${arrangementSummary.avg_active_tracks_per_section}`);
      lines.push('- Treat this as a target density. Do not make every section fully populated unless the request explicitly asks for it.');
    }
    if (arrangementSummary?.avg_section_energy != null) {
      lines.push(`- Avg section energy: ${arrangementSummary.avg_section_energy}`);
    }

    const entryLines = Object.entries(arrangementSummary?.entry_order ?? {}).slice(0, 8);
    for (const [name, entry] of entryLines) {
      const desc = entry.first_section_name
        ? `${entry.first_section_name} (#${entry.first_section_index})`
        : entry.avg_first_section_index != null
          ? `avg first appears around section #${entry.avg_first_section_index}`
          : 'unknown';
      lines.push(`- ${name.padEnd(12)} enters: ${desc}`);
    }

    if ((arrangementSummary?.top_layer_combinations ?? []).length > 0) {
      lines.push(`- Top layer combinations: ${arrangementSummary.top_layer_combinations.slice(0, 5).map(entry => `${entry.value}x${entry.count}`).join('  ')}`);
    }
    if ((arrangementSummary?.top_role_combinations ?? []).length > 0) {
      lines.push(`- Top role combinations: ${arrangementSummary.top_role_combinations.slice(0, 5).map(entry => `${entry.value}x${entry.count}`).join('  ')}`);
    }
    if ((arrangementSummary?.section_signals ?? []).length > 0) {
      lines.push('- Section-level signals:');
      for (const section of arrangementSummary.section_signals.slice(0, 8)) {
        const label = section.section || section.position_bucket || `section ${section.section_index}`;
        const active = (section.active_roles ?? []).join(', ') || 'none';
        const inactive = (section.inactive_roles ?? []).slice(0, 6).join(', ') || 'none';
        const transitions = [
          (section.entered_roles ?? []).length > 0 ? `enter: ${(section.entered_roles ?? []).join(',')}` : null,
          (section.exited_roles ?? []).length > 0 ? `exit: ${(section.exited_roles ?? []).join(',')}` : null,
        ].filter(Boolean).join('; ');
        lines.push(`  - ${label}: active=[${active}] inactive=[${inactive}] density=${section.density_hint ?? 'unknown'} energy=${section.energy ?? 'n/a'}${transitions ? ` (${transitions})` : ''}`);
      }
    }
    if ((arrangementSummary?.section_archetypes ?? []).length > 0) {
      lines.push('- Section-position archetypes:');
      for (const archetype of arrangementSummary.section_archetypes.slice(0, 6)) {
        const active = (archetype.common_active_roles ?? []).join(', ') || 'none';
        const inactive = (archetype.common_inactive_roles ?? []).slice(0, 6).join(', ') || 'none';
        const density = (archetype.dominant_density_hints ?? []).map(entry => `${entry.value}x${entry.count}`).join(' ') || 'unknown';
        lines.push(`  - ${archetype.bucket}: avg_tracks=${archetype.avg_active_tracks ?? 'n/a'} avg_energy=${archetype.avg_energy ?? 'n/a'} active=[${active}] inactive=[${inactive}] density=${density}`);
      }
    }
    lines.push('');
    lines.push('**Role discipline rules**');
    lines.push('- Do not keep bass, drums, pad, chords, lead, and fx all active by default in every section.');
    lines.push('- If role presence is low, leave that role absent in many sections.');
    lines.push('- FX should usually be sparse unless the profile clearly shows they are persistent.');
    lines.push('- Pads and chords should not both become permanently dense unless the profile supports it.');
    lines.push('- Respect the active-role cap. If the profile says only 2-3 roles should be active, leave the rest silent.');
    lines.push('- Sparse or occasional roles should disappear completely in some sections, not just play fewer notes.');
    lines.push('');
    lines.push('**Section-phase role budgets**');
    lines.push('- setup: sparse introduction; use anchor roles only; keep optional roles inactive.');
    lines.push('- main: use the target role count; establish the groove without activating every role.');
    lines.push('- peak: may reach the active-role cap; reserve this for one or two high-energy sections.');
    lines.push('- breakdown: reduce low-end, drums, or harmony weight; keep the texture intentionally stripped.');
    lines.push('- release: resolve or remove layers; avoid adding sparse roles unless the profile requests it.');
    lines.push('- For every section plan, choose a phase and a role_budget with min/target/max active roles.');
    lines.push('');
  }

  return lines.join('\n');
}

function enforceArrangementPlan(song, arrangementPlan) {
  const planSections = arrangementPlan?.section_plan;
  if (!song?.sections || !Array.isArray(planSections) || planSections.length === 0) return song;

  const sections = song.sections.map((section, index) => {
    const plan = planSections[index] ?? findPlanByName(planSections, section.name);
    if (!plan || !Array.isArray(section.tracks)) return section;

    const originalTracks = section.tracks;
    const requiredRoles = normalizeRoleSet(plan.required_roles);
    const activeRoles = normalizeRoleSet(plan.active_roles);
    const inactiveRoles = normalizeRoleSet(plan.inactive_roles);
    const forbiddenRoles = normalizeRoleSet(plan.forbidden_roles);
    const sparseRoles = normalizeRoleSet(plan.role_budget?.sparse_roles);

    let tracks = originalTracks.filter(track => {
      const role = classifyTrackRole(track.ableton_name || '');
      if (requiredRoles.has(role)) return true;
      if (activeRoles.has(role)) return true;
      if (forbiddenRoles.has(role)) return false;
      if (inactiveRoles.has(role)) return false;
      if (sparseRoles.has(role)) return false;
      return true;
    });

    tracks = capTracksToRoleBudget(tracks, plan);

    // Avoid producing an unusable empty section if a model or plan was too strict.
    if (tracks.length === 0 && originalTracks.length > 0) {
      const fallback = originalTracks.find(track => activeRoles.has(classifyTrackRole(track.ableton_name || ''))) ?? originalTracks[0];
      tracks = [fallback];
    }

    return { ...section, tracks };
  });

  return { ...song, sections };
}

function capTracksToRoleBudget(tracks, plan) {
  const maxActiveRoles = Number(plan.role_budget?.max_active_roles);
  if (!Number.isFinite(maxActiveRoles) || maxActiveRoles <= 0) return tracks;

  const roles = new Map();
  for (const track of tracks) {
    const role = classifyTrackRole(track.ableton_name || '');
    if (!roles.has(role)) roles.set(role, []);
    roles.get(role).push(track);
  }

  if (roles.size <= maxActiveRoles) return tracks;

  const requiredRoles = normalizeRoleSet(plan.required_roles);
  const activeRoles = normalizeRoleSet(plan.active_roles);
  const inactiveRoles = normalizeRoleSet(plan.inactive_roles);
  const sparseRoles = normalizeRoleSet(plan.role_budget?.sparse_roles);

  const rankedRoles = [...roles.entries()]
    .map(([role, roleTracks]) => ({
      role,
      score:
        (requiredRoles.has(role) ? 10000 : 0) +
        (activeRoles.has(role) ? 5000 : 0) -
        (inactiveRoles.has(role) ? 5000 : 0) -
        (sparseRoles.has(role) ? 2000 : 0) +
        roleTracks.reduce((sum, track) => sum + (track.clip?.notes?.length ?? 0), 0),
    }))
    .sort((a, b) => b.score - a.score)
    .slice(0, maxActiveRoles)
    .map(entry => entry.role);

  const keepRoles = new Set(rankedRoles);
  return tracks.filter(track => keepRoles.has(classifyTrackRole(track.ableton_name || '')));
}

function normalizeRoleSet(values) {
  return new Set(
    (Array.isArray(values) ? values : [])
      .map(value => String(value || '').trim().toLowerCase())
      .filter(Boolean)
  );
}

function findPlanByName(planSections, sectionName) {
  if (!sectionName) return null;
  const normalized = String(sectionName).trim().toLowerCase();
  return planSections.find(plan =>
    [plan.section_name_hint, plan.section_role]
      .filter(Boolean)
      .some(value => String(value).trim().toLowerCase() === normalized)
  ) ?? null;
}

export function summarizeContinuationContext(song, recentSectionLimit = CONTINUATION_RECENT_SECTION_LIMIT) {
  const trackUsage = {};
  const roleUsage = {};
  const tonalState = deriveTonalState(song);

  const sectionSummaries = (song.sections ?? []).map((section, index) => {
    const activeRoles = new Set();
    const activeTracks = (section.tracks ?? []).flatMap(track => {
      const notes = track.clip?.notes ?? [];
      if (notes.length === 0) return [];

      const trackName = track.ableton_name || '';
      const pitches = notes.map(note => note.pitch).filter(pitch => Number.isFinite(pitch));
      const role = classifyTrackRole(trackName);

      trackUsage[trackName] ??= {
        active_sections: 0,
        total_notes: 0,
        first_section_index: index,
        last_section_index: index,
      };
      trackUsage[trackName].active_sections += 1;
      trackUsage[trackName].total_notes += notes.length;
      trackUsage[trackName].last_section_index = index;

      activeRoles.add(role);

      return [{
        ableton_name: trackName,
        role,
        note_count: notes.length,
        min_pitch: pitches.length ? Math.min(...pitches) : null,
        max_pitch: pitches.length ? Math.max(...pitches) : null,
        first_note_time: notes[0].time,
      }];
    });

    for (const role of activeRoles) {
      roleUsage[role] ??= { active_sections: 0, last_section_index: index };
      roleUsage[role].active_sections += 1;
      roleUsage[role].last_section_index = index;
    }

    return {
      index,
      name: section.name,
      bars: section.bars,
      active_track_count: activeTracks.length,
      tracks: activeTracks,
    };
  });

  const recentSections = sectionSummaries.slice(-Math.max(1, recentSectionLimit));

  return {
    meta: {
      bpm: song.meta?.bpm,
      scale: song.meta?.scale,
      genre: song.meta?.genre,
      mood: song.meta?.mood,
      time_signature: song.meta?.time_signature,
      tonal_state: tonalState,
    },
    continuity_summary: {
      total_sections: sectionSummaries.length,
      recent_sections_included: recentSections.length,
      track_usage: Object.fromEntries(
        Object.entries(trackUsage)
          .sort(([, a], [, b]) => b.active_sections - a.active_sections || b.total_notes - a.total_notes)
      ),
      role_usage: Object.fromEntries(
        Object.entries(roleUsage)
          .sort(([, a], [, b]) => b.active_sections - a.active_sections)
      ),
    },
    recent_sections: recentSections,
  };
}

function buildContinuationSection(song) {
  const summary = summarizeContinuationContext(song);

  return [
    '## Existing song to continue',
    'Append new sections that follow coherently from this material. Do not rewrite the existing sections.',
    'Use this as compact continuity context, not as source material to duplicate verbatim.',
    'Recent sections are included in more detail; older material is summarized as aggregate track and role usage.',
    '```json',
    JSON.stringify(summary, null, 2),
    '```',
  ].join('\n');
}

export function deriveTonalState(...sources) {
  for (const source of sources) {
    const state = normalizeTonalState(source);
    if (state) return state;
  }
  return null;
}

function normalizeTonalState(source) {
  if (!source) return null;

  if (source.tonal_center || source.scale || source.key) {
    return buildTonalState({
      tonalCenter: source.tonal_center,
      scale: source.scale,
      key: source.key,
      mode: source.mode,
      rootNote: source.root_note,
      confidence: source.key_confidence,
    });
  }

  if (source.meta || source._meta || source.structure || source.arrangement) {
    return buildTonalState({
      tonalCenter: source.meta?.tonal_center,
      scale: source.meta?.scale,
      key: source.key ?? source.meta?.key,
      mode: source.mode ?? source.meta?.mode,
      rootNote: source.meta?.root_note ?? source.root_note,
      confidence: source.key_confidence ?? source.meta?.key_confidence,
    });
  }

  return null;
}

function buildTonalState({ tonalCenter, scale, key, mode, rootNote, confidence }) {
  const resolvedScale = scale || key || tonalCenter;
  if (!resolvedScale) return null;

  const parsed = parseScaleName(resolvedScale);
  return {
    tonal_center: tonalCenter || resolvedScale,
    scale: resolvedScale,
    root: parsed.root,
    mode: mode || parsed.mode,
    root_note: Number.isFinite(rootNote) ? rootNote : null,
    key_confidence: confidence ?? null,
  };
}

function buildTonalStateSection(tonalState) {
  return [
    '## Tonal continuity lock',
    'Treat this as a hard continuity constraint for chunked or continued generation.',
    `- Tonal center / scale: ${tonalState.scale || tonalState.tonal_center}`,
    tonalState.root ? `- Root: ${tonalState.root}` : null,
    tonalState.mode ? `- Mode: ${tonalState.mode}` : null,
    '- Later chunks must preserve this root and mode unless the user explicitly requests modulation.',
    '- Same-mode but different-root drift is not acceptable.',
  ].filter(Boolean).join('\n');
}

function parseScaleName(scale) {
  const match = String(scale || '').trim().match(/^([A-G](?:#|b)?)(?:\s+(.+))?$/i);
  if (!match) return { root: null, mode: null };
  return {
    root: normalizePitchName(match[1]),
    mode: match[2]?.trim().toLowerCase() || null,
  };
}

function normalizePitchName(name) {
  if (!name) return null;
  return name[0].toUpperCase() + name.slice(1);
}
