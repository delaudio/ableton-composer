import { mkdir, writeFile } from 'fs/promises';
import { basename, dirname, extname, join } from 'path';
import { zipSync, strToU8 } from 'fflate';
import { slugify } from './storage.js';
import { formatExportTrackName, resolveMusicXmlExportPreset } from './export-presets.js';

export async function exportSongToMusicXml(song, outPath, options = {}) {
  const preset = resolveMusicXmlExportPreset(song, options.target, outPath);
  const normalizedOut = resolveExportPath(song, outPath, preset.defaultOutPath);
  const xml = buildMusicXml(song, { ...options, preset });

  await mkdir(dirname(normalizedOut), { recursive: true });

  if (normalizedOut.toLowerCase().endsWith('.mxl')) {
    const archive = buildMxlArchive(xml, basename(normalizedOut, '.mxl'));
    await writeFile(normalizedOut, Buffer.from(archive));
  } else {
    await writeFile(normalizedOut, xml, 'utf-8');
  }

  return { outPath: normalizedOut, xml };
}

export function buildMusicXml(song, options = {}) {
  const preset = options.preset || resolveMusicXmlExportPreset(song, options.target, options.outPath);
  const beatsPerBar = parseBeatsPerBar(song.meta?.time_signature || '4/4');
  const beatType = parseBeatType(song.meta?.time_signature || '4/4');
  const divisions = options.divisions || 4;
  const key = resolveKeySignature(song);
  const trackCatalog = buildTrackCatalog(song.sections || []);
  const trackNames = [...trackCatalog.keys()];
  const partEvents = buildPartEvents(song, trackNames, beatsPerBar, divisions);

  const partListXml = trackNames
    .map((name, index) => {
      const id = partId(index);
      const displayName = formatExportTrackName(name, index, preset.partNameStyle);
      return [
        `    <score-part id="${id}">`,
        `      <part-name>${xmlEscape(displayName)}</part-name>`,
        '    </score-part>',
      ].join('\n');
    })
    .join('\n');

  const partsXml = trackNames
    .map((name, index) => buildPartXml({
      id: partId(index),
      name,
      measures: partEvents.get(name) || [],
      trackNotation: trackCatalog.get(name)?.notation ?? null,
      beatsPerBar,
      beatType,
      divisions,
      key,
      bpm: Number(song.meta?.bpm) || 120,
    }))
    .join('\n');

  return [
    '<?xml version="1.0" encoding="UTF-8" standalone="no"?>',
    '<!DOCTYPE score-partwise PUBLIC "-//Recordare//DTD MusicXML 3.1 Partwise//EN"',
    '  "http://www.musicxml.org/dtds/partwise.dtd">',
    '<score-partwise version="3.1">',
    '  <work>',
    `    <work-title>${xmlEscape(buildWorkTitle(song, preset))}</work-title>`,
    '  </work>',
    '  <identification>',
    '    <encoding>',
    '      <software>ableton-composer</software>',
    '    </encoding>',
    '  </identification>',
    '  <part-list>',
    partListXml,
    '  </part-list>',
    partsXml,
    '</score-partwise>',
    '',
  ].join('\n');
}

function buildPartEvents(song, trackNames, beatsPerBar, divisions) {
  const byTrack = new Map(trackNames.map(name => [name, []]));
  let sectionStartBeat = 0;

  for (const section of song.sections || []) {
    const bars = Number(section.bars) || inferSectionBars(section, beatsPerBar);
    const sectionLengthBeats = bars * beatsPerBar;
    const harmony = Array.isArray(section.harmony) ? section.harmony : [];
    const harmonyByMeasure = groupHarmonyByMeasure(harmony, sectionStartBeat, beatsPerBar);

    for (const trackName of trackNames) {
      const track = section.tracks?.find(t => t.ableton_name === trackName);
      const notes = Array.isArray(track?.clip?.notes) ? track.clip.notes : [];
      const measures = sliceTrackIntoMeasures(notes, sectionStartBeat, bars, beatsPerBar, divisions);
      const existing = byTrack.get(trackName);

      for (let localMeasureIndex = 0; localMeasureIndex < bars; localMeasureIndex++) {
        const absoluteMeasure = Math.floor(sectionStartBeat / beatsPerBar) + localMeasureIndex + 1;
        const measure = measures.get(absoluteMeasure) || {
          number: absoluteMeasure,
          notes: [],
          harmony: [],
        };
        measure.harmony = harmonyByMeasure.get(absoluteMeasure) || [];
        existing.push(measure);
      }
    }

    sectionStartBeat += sectionLengthBeats;
  }

  return byTrack;
}

function buildPartXml({ id, measures, trackNotation, beatsPerBar, beatType, divisions, key, bpm }) {
  const measureXml = measures.map((measure, index) => {
    const lines = [`    <measure number="${measure.number}">`];

    if (index === 0) {
      lines.push('      <attributes>');
      lines.push(`        <divisions>${divisions}</divisions>`);
      lines.push('        <key>');
      lines.push(`          <fifths>${key.fifths}</fifths>`);
      lines.push(`          <mode>${key.mode}</mode>`);
      lines.push('        </key>');
      lines.push('        <time>');
      lines.push(`          <beats>${beatsPerBar}</beats>`);
      lines.push(`          <beat-type>${beatType}</beat-type>`);
      lines.push('        </time>');
      lines.push('        <clef>');
      lines.push(`          <sign>${preferredClefSign(trackNotation, measures)}</sign>`);
      lines.push(`          <line>${preferredClefLine(trackNotation, measures)}</line>`);
      lines.push('        </clef>');
      lines.push('      </attributes>');
      lines.push('      <direction placement="above">');
      lines.push('        <direction-type>');
      lines.push('          <metronome>');
      lines.push('            <beat-unit>quarter</beat-unit>');
      lines.push(`            <per-minute>${Math.round(bpm)}</per-minute>`);
      lines.push('          </metronome>');
      lines.push('        </direction-type>');
      lines.push(`        <sound tempo="${Math.round(bpm)}"/>`);
      lines.push('      </direction>');
    }

    for (const harmony of measure.harmony) {
      lines.push(...renderHarmony(harmony, beatsPerBar, divisions));
    }

    if (measure.notes.length === 0) {
      lines.push(...renderRest(beatsPerBar * divisions));
    } else {
      const timeline = buildMeasureTimeline(measure.notes, beatsPerBar, divisions);
      for (const event of timeline) {
        if (event.type === 'rest') lines.push(...renderRest(event.duration));
        if (event.type === 'note') lines.push(...renderNoteGroup(event.notes, event.duration, divisions, key));
      }
    }

    lines.push('    </measure>');
    return lines.join('\n');
  }).join('\n');

  return [`  <part id="${id}">`, measureXml, '  </part>'].join('\n');
}

function sliceTrackIntoMeasures(notes, sectionStartBeat, bars, beatsPerBar, divisions) {
  const measures = new Map();
  const totalMeasures = bars;

  for (let i = 0; i < totalMeasures; i++) {
    const absoluteMeasure = Math.floor(sectionStartBeat / beatsPerBar) + i + 1;
    measures.set(absoluteMeasure, { number: absoluteMeasure, notes: [], harmony: [] });
  }

  for (const note of notes) {
    const absoluteTime = sectionStartBeat + Number(note.time || 0);
    const measureIndex = Math.floor(absoluteTime / beatsPerBar);
    const measureNumber = measureIndex + 1;
    const localTime = absoluteTime - (measureIndex * beatsPerBar);
    const duration = clampDuration(Number(note.duration || 0), 1 / divisions);
    const entry = measures.get(measureNumber);
    if (!entry) continue;

    entry.notes.push({
      pitch: note.pitch,
      time: localTime,
      duration,
      velocity: note.velocity,
      lyrics: Array.isArray(note.lyrics) ? note.lyrics : [],
      notation: note.notation ?? null,
    });
  }

  for (const measure of measures.values()) {
    measure.notes.sort((a, b) => a.time - b.time || a.pitch - b.pitch);
  }

  return measures;
}

function buildMeasureTimeline(notes, beatsPerBar, divisions) {
  const slots = [];
  const grouped = groupNotesByStart(notes);
  const maxDivisions = beatsPerBar * divisions;
  let cursor = 0;

  for (const group of grouped) {
    const start = quantizeToDivisions(group.time, divisions);
    if (start > cursor) {
      slots.push({ type: 'rest', duration: start - cursor });
    }

    const duration = Math.max(1, Math.min(
      maxDivisions - start,
      Math.max(...group.notes.map(note => quantizeToDivisions(note.duration, divisions)))
    ));

    slots.push({ type: 'note', duration, notes: group.notes });
    cursor = start + duration;
  }

  if (cursor < maxDivisions) {
    slots.push({ type: 'rest', duration: maxDivisions - cursor });
  }

  return slots.filter(slot => slot.duration > 0);
}

function renderHarmony(harmony, beatsPerBar, divisions) {
  const parsed = parseHarmonySymbol(harmony.symbol || harmony.root || '');
  if (!parsed) return [];

  const offset = quantizeToDivisions(Number(harmony.time || 0) % beatsPerBar, divisions);
  const lines = ['      <harmony>'];
  if (offset > 0) lines.push(`        <offset>${offset}</offset>`);
  lines.push('        <root>');
  lines.push(`          <root-step>${parsed.rootStep}</root-step>`);
  if (parsed.rootAlter) lines.push(`          <root-alter>${parsed.rootAlter}</root-alter>`);
  lines.push('        </root>');
  lines.push(`        <kind text="${xmlEscape(parsed.text)}">${xmlEscape(parsed.kind)}</kind>`);
  if (parsed.bassStep) {
    lines.push('        <bass>');
    lines.push(`          <bass-step>${parsed.bassStep}</bass-step>`);
    if (parsed.bassAlter) lines.push(`          <bass-alter>${parsed.bassAlter}</bass-alter>`);
    lines.push('        </bass>');
  }
  lines.push('      </harmony>');
  return lines;
}

function renderRest(duration) {
  return [
    '      <note>',
    '        <rest/>',
    `        <duration>${duration}</duration>`,
    `        <type>${durationToType(duration)}</type>`,
    '      </note>',
  ];
}

function renderNoteGroup(notes, duration, divisions, key) {
  const lines = [];

  notes.forEach((note, index) => {
    const pitch = preferredPitch(note, key);
    lines.push('      <note>');
    if (index > 0) lines.push('        <chord/>');
    if (pitch.unpitched) {
      lines.push('        <unpitched>');
      lines.push(`          <display-step>${pitch.unpitched.display_step}</display-step>`);
      lines.push(`          <display-octave>${pitch.unpitched.display_octave}</display-octave>`);
      lines.push('        </unpitched>');
    } else {
      lines.push('        <pitch>');
      lines.push(`          <step>${pitch.step}</step>`);
      if (pitch.alter) lines.push(`          <alter>${pitch.alter}</alter>`);
      lines.push(`          <octave>${pitch.octave}</octave>`);
      lines.push('        </pitch>');
    }
    lines.push(`        <duration>${duration}</duration>`);
    lines.push(`        <voice>${xmlEscape(note.notation?.voice ?? 1)}</voice>`);
    if (note.notation?.type) {
      lines.push(`        <type>${xmlEscape(note.notation.type)}</type>`);
    } else {
      lines.push(`        <type>${durationToType(duration)}</type>`);
    }
    if (note.notation?.staff) {
      lines.push(`        <staff>${xmlEscape(note.notation.staff)}</staff>`);
    }
    for (const tie of note.notation?.ties ?? []) {
      lines.push(`        <tie type="${xmlEscape(tie)}"/>`);
    }

    if (note.lyrics?.length) {
      for (const lyric of note.lyrics) {
        lines.push('        <lyric>');
        if (lyric.syllabic) lines.push(`          <syllabic>${xmlEscape(lyric.syllabic)}</syllabic>`);
        lines.push(`          <text>${xmlEscape(lyric.text)}</text>`);
        lines.push('        </lyric>');
      }
    }

    lines.push('      </note>');
  });

  return lines;
}

function groupNotesByStart(notes) {
  const groups = [];
  for (const note of notes) {
    const existing = groups.find(group => Math.abs(group.time - note.time) < 0.001);
    if (existing) existing.notes.push(note);
    else groups.push({ time: note.time, notes: [note] });
  }
  return groups.sort((a, b) => a.time - b.time);
}

function uniqueTrackNames(sections) {
  const names = new Set();
  for (const section of sections || []) {
    for (const track of section.tracks || []) {
      if (track.ableton_name) names.add(track.ableton_name);
    }
  }
  return [...names];
}

function buildTrackCatalog(sections) {
  const byTrack = new Map();
  for (const section of sections || []) {
    for (const track of section.tracks || []) {
      if (!track.ableton_name || byTrack.has(track.ableton_name)) continue;
      byTrack.set(track.ableton_name, { notation: track.notation ?? null });
    }
  }
  return byTrack;
}

function groupHarmonyByMeasure(harmony, sectionStartBeat, beatsPerBar) {
  const byMeasure = new Map();
  for (const event of harmony) {
    const absoluteBeat = sectionStartBeat + Number(event.time || 0);
    const measureNumber = Math.floor(absoluteBeat / beatsPerBar) + 1;
    const localBeat = absoluteBeat - (Math.floor(absoluteBeat / beatsPerBar) * beatsPerBar);
    const bucket = byMeasure.get(measureNumber) || [];
    bucket.push({ ...event, time: localBeat });
    byMeasure.set(measureNumber, bucket);
  }
  return byMeasure;
}

function inferSectionBars(section, beatsPerBar) {
  const lengths = (section.tracks || []).map(track => Number(track.clip?.length_bars) || 0).filter(Boolean);
  if (lengths.length > 0) return Math.max(...lengths);

  const lastBeat = Math.max(0, ...(section.tracks || []).flatMap(track =>
    (track.clip?.notes || []).map(note => Number(note.time || 0) + Number(note.duration || 0))
  ));
  return Math.max(1, Math.ceil(lastBeat / beatsPerBar));
}

function resolveExportPath(song, outPath, defaultOutPath) {
  if (outPath) return outPath.startsWith('/') ? outPath : join(process.cwd(), outPath);
  if (defaultOutPath) return defaultOutPath;
  const base = slugify(song.meta?.genre || song.sections?.[0]?.name || 'exported-song') || 'exported-song';
  return join(process.cwd(), 'exports', `${base}.musicxml`);
}

function buildWorkTitle(song, preset) {
  const base = song.meta?.genre || song.sections?.[0]?.name || 'Untitled';
  return preset.includeWorkTitleTargetSuffix ? `${base} (Logic)` : base;
}

function buildMxlArchive(xml, rootName) {
  const rootFile = `${slugify(rootName) || 'score'}.xml`;
  const container = [
    '<?xml version="1.0" encoding="UTF-8"?>',
    '<container version="1.0" xmlns="urn:oasis:names:tc:opendocument:xmlns:container">',
    '  <rootfiles>',
    `    <rootfile full-path="${rootFile}" media-type="application/vnd.recordare.musicxml+xml"/>`,
    '  </rootfiles>',
    '</container>',
    '',
  ].join('\n');

  return zipSync({
    'META-INF/container.xml': strToU8(container),
    [rootFile]: strToU8(xml),
  });
}

function partId(index) {
  return `P${index + 1}`;
}

function parseBeatsPerBar(signature) {
  return Number(String(signature).split('/')[0]) || 4;
}

function parseBeatType(signature) {
  return Number(String(signature).split('/')[1]) || 4;
}

function quantizeToDivisions(beats, divisions) {
  return Math.max(0, Math.round(Number(beats || 0) * divisions));
}

function clampDuration(duration, min) {
  return Math.max(min, duration || min);
}

function durationToType(duration) {
  if (duration >= 16) return 'whole';
  if (duration >= 8) return 'half';
  if (duration >= 4) return 'quarter';
  if (duration >= 2) return 'eighth';
  return '16th';
}

function parseScale(scale) {
  const normalized = String(scale || '').trim();
  const match = /^([A-G])([#b]?)(?:\s+)(major|minor)$/i.exec(normalized);
  if (!match) return { fifths: 0, mode: 'major' };

  const [, step, accidental, modeRaw] = match;
  const mode = modeRaw.toLowerCase();
  const tonic = `${step.toUpperCase()}${accidental}`;
  const table = mode === 'minor' ? MINOR_FIFTHS : MAJOR_FIFTHS;
  return { fifths: table[tonic] ?? 0, mode };
}

function resolveKeySignature(song) {
  const notationKey = song.meta?.notation?.key;
  if (Number.isInteger(notationKey?.fifths) && notationKey?.mode) {
    return {
      fifths: notationKey.fifths,
      mode: String(notationKey.mode).toLowerCase(),
    };
  }
  return parseScale(song.meta?.scale || '');
}

function preferredPitch(note, key) {
  const notation = note.notation ?? {};
  if (notation.unpitched?.display_step && Number.isFinite(notation.unpitched?.display_octave)) {
    return {
      unpitched: {
        display_step: notation.unpitched.display_step,
        display_octave: notation.unpitched.display_octave,
      },
    };
  }
  if (notation.pitch?.step && Number.isFinite(notation.pitch?.octave)) {
    return {
      step: notation.pitch.step,
      alter: Number(notation.pitch.alter) || 0,
      octave: Number(notation.pitch.octave),
    };
  }
  return midiToPitch(Number(note.pitch), key);
}

function preferredClefSign(trackNotation, measures) {
  return trackNotation?.clef?.sign || defaultClef(measures);
}

function preferredClefLine(trackNotation, measures) {
  if (Number.isFinite(trackNotation?.clef?.line)) return Number(trackNotation.clef.line);
  return preferredClefSign(trackNotation, measures) === 'F' ? 4 : 2;
}

function midiToPitch(midi, key) {
  const pc = ((midi % 12) + 12) % 12;
  const octave = Math.floor(midi / 12) - 1;
  const names = key.fifths < 0 ? FLAT_PITCHES : SHARP_PITCHES;
  const pitch = names[pc];
  return { ...pitch, octave };
}

function parseHarmonySymbol(symbol) {
  const match = /^([A-G])([#b]?)(.*?)(?:\/([A-G])([#b]?))?$/.exec(String(symbol || '').trim());
  if (!match) return null;

  const [, rootStep, rootAccidental, suffix, bassStep, bassAccidental] = match;
  const kind = suffixToKind(suffix);
  return {
    rootStep,
    rootAlter: accidentalToAlter(rootAccidental),
    kind,
    text: suffix || '',
    bassStep: bassStep || null,
    bassAlter: accidentalToAlter(bassAccidental || ''),
  };
}

function suffixToKind(suffix) {
  const normalized = String(suffix || '').trim().toLowerCase();
  if (!normalized) return 'major';
  if (normalized === 'm') return 'minor';
  if (normalized === '7') return 'dominant';
  if (normalized === 'maj7') return 'major-seventh';
  if (normalized === 'm7') return 'minor-seventh';
  if (normalized === 'dim') return 'diminished';
  if (normalized === 'dim7') return 'diminished-seventh';
  if (normalized === 'aug') return 'augmented';
  if (normalized === 'sus4') return 'suspended-fourth';
  if (normalized === 'sus2') return 'suspended-second';
  if (normalized === '6') return 'major-sixth';
  if (normalized === 'm6') return 'minor-sixth';
  if (normalized === '9') return 'dominant-ninth';
  if (normalized === 'maj9') return 'major-ninth';
  if (normalized === 'm9') return 'minor-ninth';
  if (normalized === 'm7b5') return 'half-diminished';
  return normalized.replace(/\s+/g, '-');
}

function accidentalToAlter(accidental) {
  if (!accidental) return 0;
  return [...accidental].reduce((sum, char) => sum + (char === '#' ? 1 : -1), 0);
}

function defaultClef(measures) {
  const pitches = measures.flatMap(measure => measure.notes.flatMap(group => group.pitch ? [group.pitch] : []));
  if (pitches.length === 0) return 'G';
  const avg = pitches.reduce((sum, pitch) => sum + pitch, 0) / pitches.length;
  return avg < 60 ? 'F' : 'G';
}

function xmlEscape(value) {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

const SHARP_PITCHES = [
  { step: 'C', alter: 0 },
  { step: 'C', alter: 1 },
  { step: 'D', alter: 0 },
  { step: 'D', alter: 1 },
  { step: 'E', alter: 0 },
  { step: 'F', alter: 0 },
  { step: 'F', alter: 1 },
  { step: 'G', alter: 0 },
  { step: 'G', alter: 1 },
  { step: 'A', alter: 0 },
  { step: 'A', alter: 1 },
  { step: 'B', alter: 0 },
];

const FLAT_PITCHES = [
  { step: 'C', alter: 0 },
  { step: 'D', alter: -1 },
  { step: 'D', alter: 0 },
  { step: 'E', alter: -1 },
  { step: 'E', alter: 0 },
  { step: 'F', alter: 0 },
  { step: 'G', alter: -1 },
  { step: 'G', alter: 0 },
  { step: 'A', alter: -1 },
  { step: 'A', alter: 0 },
  { step: 'B', alter: -1 },
  { step: 'B', alter: 0 },
];

const MAJOR_FIFTHS = {
  Cb: -7, Gb: -6, Db: -5, Ab: -4, Eb: -3, Bb: -2, F: -1,
  C: 0, G: 1, D: 2, A: 3, E: 4, B: 5, 'F#': 6, 'C#': 7,
};

const MINOR_FIFTHS = {
  Ab: -7, Eb: -6, Bb: -5, F: -4, C: -3, G: -2, D: -1,
  A: 0, E: 1, B: 2, 'F#': 3, 'C#': 4, 'G#': 5, 'D#': 6, 'A#': 7,
};
