import { readFile } from 'fs/promises';
import { basename, extname } from 'path';

export async function importMidiFromFile(absPath) {
  const { Midi } = (await import('@tonejs/midi')).default;
  const buffer = await readFile(absPath);
  const midi = new Midi(buffer);

  const ppq = midi.header.ppq;
  const bpm = midi.header.tempos.length > 0 ? Math.round(midi.header.tempos[0].bpm) : 120;
  const rawSig = midi.header.timeSignatures.length > 0 ? midi.header.timeSignatures[0].timeSignature : [4, 4];
  const timeSignature = `${rawSig[0]}/${rawSig[1]}`;
  const beatsPerBar = rawSig[0];

  const activeTracks = midi.tracks
    .map((track, i) => ({ track, index: i, name: (track.name || `Track ${i + 1}`).trim() }))
    .filter(({ track }) => track.notes && track.notes.length > 0);

  const totalTicks = activeTracks.length > 0
    ? Math.max(...activeTracks.map(({ track }) => {
        const last = track.notes[track.notes.length - 1];
        return last.ticks + last.durationTicks;
      }))
    : 0;
  const totalBars = Math.max(1, Math.ceil(totalTicks / ppq / beatsPerBar));

  const tracks = activeTracks.map(({ name, track }) => ({
    ableton_name: name,
    clip: {
      length_bars: totalBars,
      notes: track.notes.map(note => ({
        pitch: note.midi,
        time: round3(note.ticks / ppq),
        duration: Math.max(0.0625, round3(note.durationTicks / ppq)),
        velocity: Math.min(127, Math.max(1, Math.round(note.velocity * 127))),
      })),
    },
  }));

  return {
    meta: {
      bpm,
      scale: '',
      genre: '',
      time_signature: timeSignature,
      description: `Imported from ${basename(absPath)}`,
    },
    sections: [{
      name: basename(absPath, extname(absPath)),
      bars: totalBars,
      tracks,
    }],
  };
}

function round3(value) {
  return Math.round(value * 1000) / 1000;
}
