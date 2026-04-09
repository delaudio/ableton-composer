import { mkdir, writeFile } from 'fs/promises';
import { dirname, join } from 'path';
import { slugify } from './storage.js';

export async function exportSongToMidi(song, outPath) {
  const { Midi } = (await import('@tonejs/midi')).default;
  const midi = new Midi();

  const bpm = Number(song.meta?.bpm) || 120;
  const timeSignature = parseTimeSignature(song.meta?.time_signature || '4/4');

  midi.header.tempos.push({ bpm, ticks: 0, time: 0 });
  midi.header.timeSignatures.push({
    ticks: 0,
    timeSignature,
    measures: 0,
  });

  const trackNames = collectTrackNames(song.sections || []);
  const tracks = new Map(trackNames.map(name => {
    const track = midi.addTrack();
    track.name = name;
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

  const resolvedOut = resolveOutPath(song, outPath);
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

function resolveOutPath(song, outPath) {
  if (outPath) return outPath.startsWith('/') ? outPath : join(process.cwd(), outPath);
  const base = slugify(song.meta?.genre || song.sections?.[0]?.name || 'exported-song') || 'exported-song';
  return join(process.cwd(), 'exports', `${base}.mid`);
}
