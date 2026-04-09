const STEP_SEMITONES = { C: 0, D: 2, E: 4, F: 5, G: 7, A: 9, B: 11 };
const MAJOR_KEYS = ['Cb','Gb','Db','Ab','Eb','Bb','F','C','G','D','A','E','B','F#','C#'];
const MINOR_KEYS = ['Ab','Eb','Bb','F','C','G','D','A','E','B','F#','C#','G#','D#','A#'];

export function importXmlToSong(score, absPath) {
  const scoreParts = asArray(score['part-list']?.['score-part']);
  const partNames = {};
  for (const sp of scoreParts) {
    const id = sp['@_id'];
    const raw = sp['part-name'];
    partNames[id] = typeof raw === 'object' ? (raw['#text'] || id) : String(raw || id);
  }

  const parts = asArray(score.part);
  const firstMeasure = parts[0]?.measure?.[0];

  let globalBpm = 120;
  let globalBeats = 4;
  let globalBeatType = 4;
  let globalFifths = 0;
  let globalMode = 'major';

  if (firstMeasure) {
    const attrs = firstMeasure.attributes?.[0] ?? firstMeasure.attributes;
    if (attrs) {
      if (attrs.time) {
        globalBeats = Number(attrs.time.beats) || 4;
        globalBeatType = Number(attrs.time['beat-type']) || 4;
      }
      if (attrs.key) {
        globalFifths = Number(attrs.key.fifths) || 0;
        globalMode = attrs.key.mode || 'major';
      }
    }

    outer: for (const measure of parts[0].measure) {
      for (const dir of asArray(measure.direction)) {
        const soundTempo = dir.sound?.['@_tempo'];
        if (soundTempo) { globalBpm = Number(soundTempo); break outer; }
        const metro = asArray(dir['direction-type']).find(dt => dt.metronome)?.metronome;
        if (metro?.['per-minute']) { globalBpm = Number(metro['per-minute']); break outer; }
      }
    }
  }

  const beatsPerBar = globalBeats;
  const timeSignature = `${globalBeats}/${globalBeatType}`;
  const scale = fifthsToScale(globalFifths, globalMode);
  const totalMeasures = parts[0]?.measure?.length ?? 0;

  const sections = [{
    name: absPath.split('/').pop()?.replace(/\.(mxl|xml|musicxml)$/i, '') || 'imported-xml',
    bars: totalMeasures,
    tracks: parts.map(part => ({
      ableton_name: partNames[part['@_id']] || part['@_id'],
      notation: {
        part_id: part['@_id'],
        source_name: partNames[part['@_id']] || part['@_id'],
        ...(extractTrackNotation(part.measure) ?? {}),
      },
      clip: {
        length_bars: totalMeasures,
        notes: extractNotes(part.measure, beatsPerBar),
      },
    })).filter(track => track.clip.notes.length > 0),
    harmony: dedupeHarmonyEvents(parts.flatMap(part => extractHarmony(part.measure, beatsPerBar))),
    notation: {
      measure_start: 1,
      measure_end: totalMeasures,
    },
  }];

  return {
    meta: {
      bpm: Math.round(globalBpm),
      scale,
      genre: '',
      time_signature: timeSignature,
      description: `Imported from ${absPath.split('/').pop()}`,
      notation: {
        source: 'musicxml',
        key: {
          fifths: globalFifths,
          mode: globalMode,
        },
        time: {
          beats: globalBeats,
          beat_type: globalBeatType,
        },
      },
    },
    sections,
  };
}

function extractNotes(measures, beatsPerBar) {
  let currentDivisions = 1;
  let measureBeat = 0;
  const notes = [];

  for (const measure of measures) {
    const attrs = asArray(measure.attributes)[0];
    if (attrs?.divisions) currentDivisions = Number(attrs.divisions);

    const measureNotes = asArray(measure.note);
    let cursor = measureBeat;
    let prevCursor = measureBeat;

    for (const n of measureNotes) {
      if (n.grace !== undefined) continue;
      const beatDur = (Number(n.duration) || 0) / currentDivisions;
      const isRest = n.rest !== undefined;
      const isChord = n.chord !== undefined;
      if (isChord) cursor = prevCursor;

      if (!isRest && n.pitch) {
        const note = {
          pitch: pitchToMidi(n.pitch.step, Number(n.pitch.octave), Number(n.pitch.alter) || 0),
          time: round3(cursor),
          duration: round3(beatDur),
          velocity: 80,
        };
        const notation = extractNoteNotation(n);
        if (notation) note.notation = notation;
        notes.push(note);
      }

      prevCursor = cursor;
      if (!isChord) cursor += beatDur;
    }

    measureBeat += beatsPerBar;
  }

  return notes;
}

function extractTrackNotation(measures) {
  for (const measure of measures) {
    const attrs = asArray(measure.attributes)[0];
    const clef = asArray(attrs?.clef)[0];
    if (clef?.sign) {
      return {
        clef: {
          sign: String(clef.sign),
          line: Number(clef.line) || (String(clef.sign) === 'F' ? 4 : 2),
        },
      };
    }
  }
  return null;
}

function extractNoteNotation(note) {
  const notation = {};
  if (note.pitch) {
    notation.pitch = {
      step: note.pitch.step,
      alter: Number(note.pitch.alter) || 0,
      octave: Number(note.pitch.octave),
    };
  }
  if (note.voice !== undefined) notation.voice = textValue(note.voice) || null;
  if (note.staff !== undefined) notation.staff = textValue(note.staff) || null;
  if (note.type !== undefined) notation.type = textValue(note.type) || null;
  const ties = asArray(note.tie).map(tie => tie?.['@_type']).filter(Boolean);
  if (ties.length > 0) notation.ties = ties;
  return Object.keys(notation).length > 0 ? notation : null;
}

function extractHarmony(measures, beatsPerBar) {
  let currentDivisions = 1;
  let measureBeat = 0;
  const events = [];

  for (const measure of measures) {
    const attrs = asArray(measure.attributes)[0];
    if (attrs?.divisions) currentDivisions = Number(attrs.divisions);

    const harmonies = asArray(measure.harmony);
    const hasExplicitOffsets = harmonies.some(h => h.offset !== undefined);

    harmonies.forEach((harmony, index) => {
      const parsed = parseHarmonySymbol(harmony);
      if (!parsed) return;

      const offsetBeats = hasExplicitOffsets
        ? (Number(harmony.offset) || 0) / currentDivisions
        : index * (beatsPerBar / Math.max(1, harmonies.length));

      events.push({
        time: round3(measureBeat + offsetBeats),
        symbol: parsed.symbol,
        root: parsed.root,
        kind: parsed.kind,
        bass: parsed.bass,
      });
    });

    measureBeat += beatsPerBar;
  }

  return events;
}

function parseHarmonySymbol(harmony) {
  const root = harmony.root;
  const rootStep = root?.['root-step'];
  if (!rootStep) return null;
  const rootAlter = Number(root['root-alter']) || 0;
  const rootName = `${rootStep}${alterSuffix(rootAlter)}`;
  const kindValue = textValue(harmony.kind) || 'major';
  const kindText = attrValue(harmony.kind, 'text');
  const suffix = kindText || kindSuffix(kindValue);
  const bass = harmony.bass
    ? `${harmony.bass['bass-step']}${alterSuffix(Number(harmony.bass['bass-alter']) || 0)}`
    : null;

  return {
    root: rootName,
    kind: kindValue,
    bass,
    symbol: `${rootName}${suffix}${bass ? `/${bass}` : ''}`,
  };
}

function dedupeHarmonyEvents(events) {
  const seen = new Set();
  return events
    .sort((a, b) => a.time - b.time || a.symbol.localeCompare(b.symbol))
    .filter(event => {
      const key = `${event.time}:${event.symbol}`;
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });
}

function pitchToMidi(step, octave, alter) {
  return (octave + 1) * 12 + (STEP_SEMITONES[step] ?? 0) + Math.round(alter);
}

function fifthsToScale(fifths, mode) {
  const idx = Math.max(0, Math.min(14, fifths + 7));
  return mode === 'minor' ? `${MINOR_KEYS[idx]} minor` : `${MAJOR_KEYS[idx]} major`;
}

function kindSuffix(kind) {
  const normalized = String(kind || 'major').toLowerCase();
  const map = {
    major: '',
    minor: 'm',
    augmented: 'aug',
    diminished: 'dim',
    dominant: '7',
    'major-seventh': 'maj7',
    'minor-seventh': 'm7',
    'diminished-seventh': 'dim7',
    'augmented-seventh': 'aug7',
    'half-diminished': 'm7b5',
    'major-minor': '7',
    'minor-major': 'mMaj7',
    'suspended-fourth': 'sus4',
    'suspended-second': 'sus2',
    'major-sixth': '6',
    'minor-sixth': 'm6',
    'dominant-ninth': '9',
    'major-ninth': 'maj9',
    'minor-ninth': 'm9',
  };
  return map[normalized] ?? (normalized === 'none' ? '' : normalized.replaceAll('-', ' '));
}

function textValue(value) {
  if (value === undefined || value === null) return '';
  if (typeof value === 'object') return String(value['#text'] ?? '').trim();
  return String(value).trim();
}

function attrValue(value, name) {
  if (!value || typeof value !== 'object') return '';
  return String(value[`@_${name}`] ?? '').trim();
}

function alterSuffix(alter) {
  if (alter > 0) return '#'.repeat(alter);
  if (alter < 0) return 'b'.repeat(Math.abs(alter));
  return '';
}

function asArray(val) {
  if (!val) return [];
  return Array.isArray(val) ? val : [val];
}

function round3(value) {
  return Math.round(value * 1000) / 1000;
}
