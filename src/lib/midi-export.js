import { mkdir, writeFile } from 'fs/promises';
import { dirname } from 'path';
import {
  buildSectionMarkers,
  buildTrackChannelMap,
  formatExportTrackName,
  resolveMidiExportPreset,
  resolveMidiKeySignature,
} from './export-presets.js';

export async function exportSongToMidi(song, outPath, options = {}) {
  const { Midi } = (await import('@tonejs/midi')).default;
  const midi = new Midi();
  const preset = resolveMidiExportPreset(song, options.target);

  const bpm = Number(song.meta?.bpm) || 120;
  const timeSignature = parseTimeSignature(song.meta?.time_signature || '4/4');

  midi.header.name = buildMidiName(song, preset.target);
  midi.header.tempos.push({ bpm, ticks: 0, time: 0 });
  midi.header.timeSignatures.push({
    ticks: 0,
    timeSignature,
    measures: 0,
  });
  if (preset.includeSectionMarkers) {
    midi.header.meta.push(...buildSectionMarkers(song, midi.header.ppq));
  }
  if (preset.includeKeySignature) {
    const keySignature = resolveMidiKeySignature(song.meta?.scale);
    if (keySignature) midi.header.keySignatures.push(keySignature);
  }

  const trackNames = collectTrackNames(song.sections || []);
  const channelMap = buildTrackChannelMap(trackNames, preset.channelStrategy);
  const tracks = new Map(trackNames.map((name, index) => {
    const track = midi.addTrack();
    track.name = formatExportTrackName(name, index, preset.trackNameStyle);
    track.channel = channelMap.get(name) ?? 0;
    return [name, track];
  }));

  const beatsPerBar = timeSignature[0];
  const ppq = midi.header.ppq;
  let sectionStartBeat = 0;

  for (const section of song.sections || []) {
    const sectionBars = Number(section.bars) || inferSectionBars(section, beatsPerBar);

    for (const trackDef of section.tracks || []) {
      const track = tracks.get(trackDef.ableton_name);
      if (!track) continue;

      for (const note of trackDef.clip?.notes || []) {
        track.addNote({
          midi: note.pitch,
          ticks: Math.round((sectionStartBeat + Number(note.time || 0)) * ppq),
          durationTicks: Math.max(1, Math.round(Number(note.duration || 0) * ppq)),
          velocity: clampVelocity(note.velocity),
        });
      }
    }

    sectionStartBeat += sectionBars * beatsPerBar;
  }

  const resolvedOut = resolveOutPath(song, outPath, preset.defaultOutPath);
  await mkdir(dirname(resolvedOut), { recursive: true });
  await writeFile(resolvedOut, Buffer.from(midi.toArray()));
  return resolvedOut;
}

function collectTrackNames(sections) {
  const names = new Set();
  for (const section of sections) {
    for (const track of section.tracks || []) {
      if (track.ableton_name) names.add(track.ableton_name);
    }
  }
  return [...names];
}

function parseTimeSignature(signature) {
  const [num, den] = String(signature || '4/4').split('/').map(Number);
  return [num || 4, den || 4];
}

function inferSectionBars(section, beatsPerBar) {
  const clipLengths = (section.tracks || [])
    .map(track => Number(track.clip?.length_bars) || 0)
    .filter(Boolean);
  if (clipLengths.length > 0) return Math.max(...clipLengths);

  const lastBeat = Math.max(
    0,
    ...(section.tracks || []).flatMap(track =>
      (track.clip?.notes || []).map(note => Number(note.time || 0) + Number(note.duration || 0))
    ),
  );
  return Math.max(1, Math.ceil(lastBeat / beatsPerBar));
}

function clampVelocity(value) {
  const normalized = Number(value || 80) / 127;
  return Math.max(0.01, Math.min(1, normalized));
}

function resolveOutPath(_song, outPath, defaultOutPath) {
  if (outPath) return outPath;
  return defaultOutPath;
}

function buildMidiName(song, target) {
  const base = song.meta?.genre || song.sections?.[0]?.name || 'Untitled';
  if (target === 'logic') return `${base} (Logic)`;
  if (target === 'reaper') return `${base} (REAPER)`;
  return base;
}
