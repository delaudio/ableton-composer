import { mkdir, writeFile } from 'fs/promises';
import { dirname, join } from 'path';
import { classifyTrackRole } from './analysis.js';
import { slugify } from './storage.js';

export function buildRenderChainPlan(song, sourcePath, options = {}) {
  const sampleRate = parseInt(options.sampleRate, 10) || 44100;
  const bitDepth = parseInt(options.bitDepth, 10) || 24;
  const channels = parseInt(options.channels, 10) || 2;
  const stemManifest = options.stemManifest || null;
  const title = song?.meta?.genre || song?.sections?.[0]?.name || 'song';
  const slug = slugify(title) || 'render';
  const stemLookup = buildStemLookup(stemManifest?.stems || []);
  const tracks = collectSongTracks(song).map(track => buildTrackRenderEntry(track, stemLookup, slug));

  return {
    type: 'render-chain',
    version: '0.1',
    generated_at: new Date().toISOString(),
    source: {
      song_path: sourcePath,
      song_title: title,
      stem_manifest_path: options.stemManifestPath || null,
    },
    engine_targets: {
      pedalboard: 'instrument rendering, plugin processing, and effect auditioning',
      ffmpeg: 'file conversion, stem post-processing, concatenation, mixdown, normalization, and encoding',
    },
    render_settings: {
      sample_rate: sampleRate,
      bit_depth: bitDepth,
      channels,
      normalize_master: false,
    },
    tracks,
    master_chain: {
      effects_chain: [
        { type: 'highpass_safety', enabled: false, params: { cutoff_hz: 20 } },
        { type: 'limiter', enabled: false, params: { ceiling_db: -1 } },
      ],
      mix: {
        gain_db: 0,
        pan: 0,
      },
    },
    outputs: {
      mixdown_path: `renders/${slug}/mixdown.wav`,
    },
  };
}

export async function writeRenderChainPlan(outputPath, plan) {
  const resolvedPath = outputPath.startsWith('/') ? outputPath : join(process.cwd(), outputPath);
  await mkdir(dirname(resolvedPath), { recursive: true });
  await writeFile(resolvedPath, JSON.stringify(plan, null, 2), 'utf-8');
  return resolvedPath;
}

export function defaultRenderChainPath(title) {
  return join(process.cwd(), 'renders', 'plans', `${slugify(title) || 'render'}.render-chain.json`);
}

function collectSongTracks(song) {
  const byTrack = new Map();

  for (const section of song?.sections || []) {
    for (const track of section.tracks || []) {
      const name = String(track.ableton_name || '').trim();
      if (!name) continue;
      const entry = byTrack.get(name) || {
        track_name: name,
        role: classifyTrackRole(name),
        note_count: 0,
      };
      entry.note_count += Array.isArray(track.clip?.notes) ? track.clip.notes.length : 0;
      byTrack.set(name, entry);
    }
  }

  return [...byTrack.values()];
}

function buildTrackRenderEntry(track, stemLookup, slug) {
  const role = track.role || 'other';
  const stem = stemLookup.get(track.track_name.toLowerCase()) || null;
  const sourceType = stem ? 'external-stem' : 'midi';

  return {
    track_name: track.track_name,
    role,
    source: {
      type: sourceType,
      clip_note_count: sourceType === 'midi' ? track.note_count : null,
      stem_path: stem?.source_path || null,
    },
    instrument: buildInstrumentBlock(role, sourceType),
    effects_chain: buildDefaultEffectsChain(role, sourceType),
    mix: buildMixDefaults(role),
    outputs: {
      stem_path: `renders/${slug}/stems/${slugify(track.track_name) || 'track'}.wav`,
    },
  };
}

function buildInstrumentBlock(role, sourceType) {
  if (sourceType === 'external-stem') {
    return {
      kind: 'none',
      name: 'external stem input',
      preset_path: null,
    };
  }

  const defaults = {
    drums: { kind: 'placeholder-drum-machine', name: 'drum machine placeholder' },
    bass: { kind: 'placeholder-mono-synth', name: 'mono bass synth placeholder' },
    pad: { kind: 'placeholder-poly-synth', name: 'pad/poly synth placeholder' },
    lead: { kind: 'placeholder-mono-synth', name: 'lead synth placeholder' },
    chords: { kind: 'placeholder-poly-synth', name: 'chord/keys synth placeholder' },
    fx: { kind: 'placeholder-noise-fx', name: 'fx placeholder' },
    other: { kind: 'placeholder-generic', name: 'generic instrument placeholder' },
  };

  const selected = defaults[role] || defaults.other;
  return {
    ...selected,
    preset_path: null,
  };
}

function buildDefaultEffectsChain(role, sourceType) {
  if (sourceType === 'external-stem') {
    return [
      { type: 'trim', enabled: true, params: {} },
    ];
  }

  if (role === 'drums') {
    return [
      { type: 'saturation', enabled: false, params: { drive: 0.1 } },
      { type: 'compressor', enabled: false, params: { ratio: 2 } },
    ];
  }

  if (role === 'fx') {
    return [
      { type: 'delay', enabled: false, params: { time_ms: 220, feedback: 0.25 } },
      { type: 'reverb', enabled: false, params: { mix: 0.2 } },
    ];
  }

  return [
    { type: 'eq', enabled: false, params: {} },
    { type: 'reverb', enabled: false, params: { mix: 0.12 } },
  ];
}

function buildMixDefaults(role) {
  const gainByRole = {
    drums: -3,
    bass: -4,
    pad: -8,
    lead: -6,
    chords: -7,
    fx: -10,
    other: -6,
  };

  return {
    gain_db: gainByRole[role] ?? -6,
    pan: 0,
  };
}

function buildStemLookup(stems) {
  const lookup = new Map();
  for (const stem of stems) {
    const key = String(stem.display_name || stem.track_name || '').trim().toLowerCase();
    if (!key || lookup.has(key)) continue;
    lookup.set(key, stem);
  }
  return lookup;
}
