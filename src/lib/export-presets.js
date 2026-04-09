import { join } from 'path';
import { slugify } from './storage.js';

export function normalizeExportTarget(target) {
  const value = String(target || 'default').trim().toLowerCase();
  if (value === 'logic' || value === 'logic-pro') return 'logic';
  if (value === 'reaper') return 'reaper';
  if (value === 'default' || value === '') return 'default';
  throw new Error(`Unsupported export target: ${target}. Use "default", "logic", or "reaper".`);
}

export function resolveMidiExportPreset(song, target) {
  const normalized = normalizeExportTarget(target);
  const baseName = slugify(song.meta?.genre || song.sections?.[0]?.name || 'exported-song') || 'exported-song';

  if (normalized === 'logic') {
    return {
      target: 'logic',
      defaultOutPath: join(process.cwd(), 'exports', `${baseName}-logic.mid`),
      includeSectionMarkers: true,
      includeKeySignature: true,
      trackNameStyle: 'logic',
      channelStrategy: 'logic',
    };
  }

  if (normalized === 'reaper') {
    return {
      target: 'reaper',
      defaultOutPath: join(process.cwd(), 'exports', `${baseName}-reaper.mid`),
      includeSectionMarkers: true,
      includeKeySignature: false,
      trackNameStyle: 'raw',
      channelStrategy: 'reaper',
    };
  }

  return {
    target: 'default',
    defaultOutPath: join(process.cwd(), 'exports', `${baseName}.mid`),
    includeSectionMarkers: false,
    includeKeySignature: false,
    trackNameStyle: 'raw',
    channelStrategy: 'sequential',
  };
}

export function resolveMusicXmlExportPreset(song, target, outPath) {
  const normalized = normalizeExportTarget(target);
  const baseName = slugify(song.meta?.genre || song.sections?.[0]?.name || 'exported-song') || 'exported-song';

  if (normalized === 'logic') {
    const fallback = outPath?.toLowerCase().endsWith('.mxl')
      ? `${baseName}-logic.mxl`
      : `${baseName}-logic.musicxml`;

    return {
      target: 'logic',
      defaultOutPath: join(process.cwd(), 'exports', fallback),
      partNameStyle: 'logic',
      includeWorkTitleTargetSuffix: true,
    };
  }

  return {
    target: 'default',
    defaultOutPath: join(process.cwd(), 'exports', `${baseName}.musicxml`),
    partNameStyle: 'raw',
    includeWorkTitleTargetSuffix: false,
  };
}

export function formatExportTrackName(name, index, style = 'raw') {
  if (style !== 'logic') return name;
  return `${String(index + 1).padStart(2, '0')} ${name}`;
}

export function buildTrackChannelMap(trackNames, strategy = 'sequential') {
  const channels = new Map();
  let nextChannel = 0;

  for (const name of trackNames) {
    if ((strategy === 'logic' || strategy === 'reaper') && looksLikeDrumTrack(name)) {
      channels.set(name, 9);
      continue;
    }

    while (nextChannel === 9 || [...channels.values()].includes(nextChannel)) {
      nextChannel += 1;
    }

    channels.set(name, nextChannel % 16);
    nextChannel += 1;
  }

  return channels;
}

export function buildSectionMarkers(song, ppq) {
  const markers = [];
  const beatsPerBar = parseBeatsPerBar(song.meta?.time_signature || '4/4');
  let sectionStartBeat = 0;

  for (const section of song.sections || []) {
    markers.push({
      type: 'marker',
      text: section.name || `Section ${markers.length + 1}`,
      ticks: Math.round(sectionStartBeat * ppq),
    });

    sectionStartBeat += (Number(section.bars) || 0) * beatsPerBar;
  }

  return markers;
}

export function resolveMidiKeySignature(scale) {
  const parsed = parseScale(scale);
  if (!parsed) return null;

  const key = normalizeMidiKey(parsed.tonic);
  if (!key) return null;

  return {
    ticks: 0,
    key,
    scale: parsed.mode === 'minor' ? 'minor' : 'major',
  };
}

function parseScale(scale) {
  const raw = String(scale || '').trim();
  if (!raw) return null;

  const match = raw.match(/^([A-Ga-g])([#b]?)(?:\s+)(major|minor)$/i);
  if (!match) return null;

  const tonic = `${match[1].toUpperCase()}${match[2] || ''}`;
  return { tonic, mode: match[3].toLowerCase() };
}

function normalizeMidiKey(key) {
  const normalized = {
    'A#': 'Bb',
    'D#': 'Eb',
    'G#': 'Ab',
  }[key] || key;

  return new Set(['Cb', 'Gb', 'Db', 'Ab', 'Eb', 'Bb', 'F', 'C', 'G', 'D', 'A', 'E', 'B', 'F#', 'C#']).has(normalized)
    ? normalized
    : null;
}

function parseBeatsPerBar(signature) {
  const [num] = String(signature || '4/4').split('/').map(Number);
  return num || 4;
}

function looksLikeDrumTrack(name) {
  return /\b(drum|drums|kick|snare|hat|hihat|percussion|perc)\b/i.test(name);
}
