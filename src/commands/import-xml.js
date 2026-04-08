/**
 * import-xml command — converts a MusicXML (.xml, .musicxml) file to AbletonSong JSON.
 *
 * No Ableton Live required. Uses fast-xml-parser for XML parsing.
 *
 * Track naming via --tracks:
 *   Positional: --tracks "Piano,Violin"            renames parts in order
 *   Mapping:    --tracks "Piano Right:Pad,Bass:Bass" renames by original part name
 *
 * Output formats:
 *   (no --out)              flat JSON in sets/
 *   --out sets/my-song/     set directory (one file per section + meta.json)
 *   --out sets/my-song.json flat file at exact path
 *
 * Usage:
 *   ableton-composer import-xml score.xml
 *   ableton-composer import-xml score.xml --name "bach-invention" --split-every 8
 *   ableton-composer import-xml score.xml --tracks "Violin I:Lead,Violin II:Harmony,Cello:Bass"
 *   ableton-composer import-xml score.xml --out sets/my-piece/
 */

import chalk from 'chalk';
import ora from 'ora';
import { readFile } from 'fs/promises';
import { join, basename, extname } from 'path';
import { saveSong, saveSetDirectory, writeSongFile } from '../lib/storage.js';
import { createProvenance } from '../lib/provenance.js';

// ─── constants ────────────────────────────────────────────────────────────────

const STEP_SEMITONES = { C: 0, D: 2, E: 4, F: 5, G: 7, A: 9, B: 11 };

// Fifths index (fifths + 7) → key name
const MAJOR_KEYS = ['Cb','Gb','Db','Ab','Eb','Bb','F','C','G','D','A','E','B','F#','C#'];
const MINOR_KEYS = ['Ab','Eb','Bb','F','C','G','D','A','E','B','F#','C#','G#','D#','A#'];

const DYNAMIC_VELOCITY = {
  pppp: 10, ppp: 20, pp: 35, p: 50, mp: 64, mf: 80, f: 95, ff: 110, fff: 120, ffff: 127,
};

const DEFAULT_VELOCITY = 80;

// ─── command ──────────────────────────────────────────────────────────────────

export async function importXmlCommand(xmlFile, options) {
  const spinner = ora();

  try {
    const absPath = xmlFile.startsWith('/') ? xmlFile : join(process.cwd(), xmlFile);

    // ── Read file (plain XML or compressed .mxl) ──────────────────────────────
    spinner.start(`Parsing ${basename(xmlFile)}...`);
    const raw = await readXmlContent(absPath);

    // ── Parse XML ─────────────────────────────────────────────────────────────
    const { XMLParser } = await import('fast-xml-parser');
    const parser = new XMLParser({
      ignoreAttributes:    false,
      attributeNamePrefix: '@_',
      parseAttributeValue: true,
      // These tags can appear multiple times — always wrap in array
      isArray: tagName => [
        'part', 'measure', 'note', 'direction', 'score-part', 'harmony',
        'tie', 'beam', 'slur', 'attributes', 'direction-type',
        'lyric', 'score-instrument', 'midi-instrument',
      ].includes(tagName),
    });

    const doc   = parser.parse(raw);
    const score = doc['score-partwise'];

    if (!score) {
      throw new Error(
        'Only score-partwise MusicXML is supported.\n' +
        '  (score-timewise format is not yet implemented)'
      );
    }

    spinner.succeed(`Parsed ${basename(xmlFile)}`);

    // ── Part name index ────────────────────────────────────────────────────────
    const scoreParts = asArray(score['part-list']?.['score-part']);
    const partNames  = {};
    for (const sp of scoreParts) {
      const id   = sp['@_id'];
      const raw  = sp['part-name'];
      partNames[id] = typeof raw === 'object' ? (raw['#text'] || id) : String(raw || id);
    }
    const unpitchedMaps = Object.fromEntries(
      scoreParts.map(sp => [sp['@_id'], extractUnpitchedMidiMap(sp)]),
    );

    // ── Global metadata from first part's first measure ───────────────────────
    const parts       = asArray(score.part);
    const firstMeasure = parts[0]?.measure?.[0];

    let globalBpm      = 120;
    let globalBeats    = 4;
    let globalBeatType = 4;
    let globalFifths   = 0;
    let globalMode     = 'major';

    if (firstMeasure) {
      const attrs = firstMeasure.attributes?.[0] ?? firstMeasure.attributes;
      if (attrs) {
        if (attrs.time) {
          globalBeats    = Number(attrs.time.beats)        || 4;
          globalBeatType = Number(attrs.time['beat-type']) || 4;
        }
        if (attrs.key) {
          globalFifths = Number(attrs.key.fifths) || 0;
          globalMode   = attrs.key.mode || 'major';
        }
      }

      // Find first tempo marking anywhere in first part
      outer: for (const measure of parts[0].measure) {
        for (const dir of asArray(measure.direction)) {
          const soundTempo = dir.sound?.['@_tempo'];
          if (soundTempo) { globalBpm = Number(soundTempo); break outer; }
          const metro = asArray(dir['direction-type'])
            .find(dt => dt.metronome)?.metronome;
          if (metro?.['per-minute']) { globalBpm = Number(metro['per-minute']); break outer; }
        }
      }
    }

    const beatsPerBar   = globalBeats;
    const timeSignature = `${globalBeats}/${globalBeatType}`;
    const scale         = fifthsToScale(globalFifths, globalMode);
    const totalMeasures = parts[0]?.measure?.length ?? 0;

    console.log(chalk.bold(`\n  ${Math.round(globalBpm)} BPM — ${timeSignature} — ${scale}`));
    console.log(chalk.dim(`  ${totalMeasures} measures, ${parts.length} part(s)\n`));

    // ── Build part label list and apply --tracks renaming ─────────────────────
    const partLabels = parts.map((p, i) => {
      const id = p['@_id'];
      return { id, index: i, name: partNames[id] || id };
    });
    applyTrackRenames(options.tracks, partLabels);

    for (const { name } of partLabels) {
      console.log(chalk.cyan(`  ${name}`));
    }
    console.log('');

    // ── Extract notes from each part ──────────────────────────────────────────
    const partNoteSets = parts
      .map((part, pi) => ({
        name:  partLabels[pi].name,
        notes: extractNotes(part.measure, beatsPerBar, unpitchedMaps[part['@_id']]),
      }))
      .filter(p => p.notes.length > 0);

    const harmonyEvents = dedupeHarmonyEvents(
      parts.flatMap(part => extractHarmony(part.measure, beatsPerBar)),
    );

    if (partNoteSets.length === 0) {
      throw new Error('No notes found in the MusicXML file.');
    }

    // ── Section windows ───────────────────────────────────────────────────────
    const splitEvery = options.splitEvery ? parseInt(options.splitEvery, 10) : null;
    const nameHint   = options.name || basename(xmlFile, extname(xmlFile));
    const windows    = buildWindows(totalMeasures, beatsPerBar, splitEvery, nameHint);

    console.log(chalk.dim(`  Total: ${totalMeasures} measures → ${windows.length} section(s)\n`));

    // ── Assemble sections ─────────────────────────────────────────────────────
    const sections = [];

    for (const win of windows) {
      const tracks = [];
      const sectionHarmony = harmonyEvents
        .filter(h => h.time >= win.startBeat && h.time < win.endBeat)
        .map(h => ({ ...h, time: round3(h.time - win.startBeat) }));

      for (const { name, notes } of partNoteSets) {
        const sectionNotes = notes
          .filter(n => n.time >= win.startBeat && n.time < win.endBeat)
          .map(n => {
            const note = {
              pitch:    n.pitch,
              time:     round3(n.time - win.startBeat),
              duration: round3(Math.min(n.duration, win.endBeat - n.time)),
              velocity: n.velocity,
              muted:    false,
            };
            if (n.lyrics?.length > 0) note.lyrics = n.lyrics;
            return note;
          });

        if (sectionNotes.length > 0) {
          const trackLyrics = sectionNotes.flatMap(note =>
            (note.lyrics ?? []).map(lyric => ({
              ...lyric,
              time: note.time,
            })),
          );
          const clip = { length_bars: win.bars, notes: sectionNotes };
          if (trackLyrics.length > 0) clip.lyrics = trackLyrics;
          tracks.push({ ableton_name: name, clip });
        }
      }

      if (options.chordTrack && sectionHarmony.length > 0) {
        const chordTrackName = typeof options.chordTrack === 'string'
          ? options.chordTrack
          : 'Chords';
        const chordNotes = harmonyToNotes(sectionHarmony, win.bars * beatsPerBar);
        if (chordNotes.length > 0) {
          tracks.push({
            ableton_name: chordTrackName,
            clip: {
              name: chordClipName(sectionHarmony),
              length_bars: win.bars,
              notes: chordNotes,
            },
          });
        }
      }

      if (tracks.length === 0) continue;

      const noteCount = tracks.reduce((s, t) => s + t.clip.notes.length, 0);
      console.log(
        chalk.cyan(`  [${sections.length}] ${win.name}`) +
        chalk.dim(` — ${win.bars} bar(s), ${tracks.length} track(s), ${noteCount} notes`)
      );
      for (const t of tracks) {
        console.log(chalk.dim(`       ${t.ableton_name}: ${t.clip.notes.length} notes`));
      }

      const section = { name: win.name, bars: win.bars, tracks };
      if (sectionHarmony.length > 0) section.harmony = sectionHarmony;
      const sectionLyrics = tracks.flatMap(track =>
        (track.clip.lyrics ?? []).map(lyric => ({
          track: track.ableton_name,
          ...lyric,
        })),
      );
      if (sectionLyrics.length > 0) section.lyrics = sectionLyrics;
      sections.push(section);
    }

    console.log('');

    if (sections.length === 0) {
      throw new Error('No notes mapped to any section.');
    }

    // ── Assemble song ─────────────────────────────────────────────────────────
    const song = {
      meta: {
        bpm:            Math.round(globalBpm),
        scale,
        genre:          '',
        time_signature: timeSignature,
        description:    `Imported from ${basename(xmlFile)}`,
        provenance: createProvenance({
          sourceType:   'imported-musicxml',
          operation:    'import-xml',
          sourcePath:   absPath,
          sourceFormat: extname(xmlFile).replace(/^\./, '').toLowerCase() || 'musicxml',
          details: {
            sections: sections.length,
            tracks:   partNoteSets.map(part => part.name),
          },
        }),
      },
      sections,
    };

    if (harmonyEvents.length > 0) {
      song.meta.harmony_source = 'musicxml';
      song.meta.harmony_event_count = harmonyEvents.length;
    }
    const lyricsEventCount = sections.reduce((sum, section) => sum + (section.lyrics?.length ?? 0), 0);
    if (lyricsEventCount > 0) {
      song.meta.lyrics_source = 'musicxml';
      song.meta.lyrics_event_count = lyricsEventCount;
    }

    // ── Save ──────────────────────────────────────────────────────────────────
    if (options.out) {
      const absOut  = options.out.startsWith('/') ? options.out : join(process.cwd(), options.out);
      const saveDir = options.out.endsWith('/') || !options.out.endsWith('.json');

      if (saveDir) {
        await saveSetDirectory(song, absOut);
        console.log(chalk.green(`✓ Saved to ${absOut}/`));
        console.log(chalk.dim('  Edit "genre" in meta.json to complete metadata.'));
      } else {
        await writeSongFile(absOut, song);
        console.log(chalk.green(`✓ Saved to ${absOut}`));
      }
    } else {
      const savedPath = await saveSong(song, nameHint);
      console.log(chalk.green(`✓ Saved to ${savedPath}`));
      console.log(chalk.dim('  Edit the "genre" field to complete metadata.'));
      console.log(chalk.dim(`\n  Push into Ableton: ableton-composer push ${savedPath} --setup`));
      console.log(chalk.dim(`  Split into directory: ableton-composer split ${savedPath}`));
    }

  } catch (err) {
    spinner.fail(err.message);
    process.exit(1);
  }
}

// ─── note extraction ──────────────────────────────────────────────────────────

/**
 * Extract all notes from an array of MusicXML measures.
 * Returns a flat array of { pitch, time, duration, velocity, lyrics? } with absolute beat times.
 *
 * Handles:
 *  - Variable divisions per measure
 *  - Chord notes (simultaneous with previous)
 *  - Rests (advance cursor, no note)
 *  - Grace notes (skipped)
 *  - Tied notes (durations merged across measures)
 *  - Dynamics for velocity
 *  - Lyrics attached to notes
 *  - Unpitched percussion via MusicXML midi-unpitched maps
 */
function extractNotes(measures, beatsPerBar, unpitchedMidiMap = new Map()) {
  let currentDivisions = 1;
  let currentVelocity  = DEFAULT_VELOCITY;
  let measureBeat      = 0;
  const notes          = [];
  const pendingTies    = {}; // midi pitch → note object (for tie extension)

  for (const measure of measures) {
    // Update divisions
    const attrs = asArray(measure.attributes)[0];
    if (attrs?.divisions) currentDivisions = Number(attrs.divisions);

    // Update velocity from dynamics
    for (const dir of asArray(measure.direction)) {
      const v = extractDynamic(dir);
      if (v !== null) currentVelocity = v;
    }

    // Process notes
    const measureNotes = asArray(measure.note);
    let cursor     = measureBeat;
    let prevCursor = measureBeat;

    for (const n of measureNotes) {
      if (n.grace !== undefined) continue; // skip grace notes

      const beatDur = (Number(n.duration) || 0) / currentDivisions;
      const isRest  = n.rest !== undefined;
      const isChord = n.chord !== undefined;

      // Chord note: starts at the same position as the previous note
      if (isChord) cursor = prevCursor;

      const midi = noteToMidi(n, unpitchedMidiMap);

      if (!isRest && midi !== null) {
        const ties      = asArray(n.tie);
        const isTieStop  = ties.some(t => t['@_type'] === 'stop');
        const isTieStart = ties.some(t => t['@_type'] === 'start');

        if (isTieStop && pendingTies[midi]) {
          // Extend the tied note's duration
          pendingTies[midi].duration += beatDur;
          if (!isTieStart) delete pendingTies[midi];
        } else {
          const noteObj = { pitch: midi, time: cursor, duration: beatDur, velocity: currentVelocity };
          const lyrics = extractLyrics(n);
          if (lyrics.length > 0) noteObj.lyrics = lyrics;
          notes.push(noteObj);
          if (isTieStart) pendingTies[midi] = noteObj;
        }
      }

      prevCursor = cursor;
      if (!isChord) cursor += beatDur;
    }

    measureBeat += beatsPerBar;
  }

  return notes;
}

/**
 * Extract MusicXML chord symbols (<harmony>) as absolute beat events.
 *
 * MusicXML can place harmony by document order and/or <offset>. Because this
 * parser does not preserve mixed child order, no-offset chords are distributed
 * across the measure as a practical fallback for common lead-sheet exports.
 */
function extractHarmony(measures, beatsPerBar) {
  let currentDivisions = 1;
  let measureBeat      = 0;
  const events         = [];

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
        time:   round3(measureBeat + offsetBeats),
        symbol: parsed.symbol,
        root:   parsed.root,
        kind:   parsed.kind,
        bass:   parsed.bass,
      });
    });

    measureBeat += beatsPerBar;
  }

  return events;
}

// ─── helpers ─────────────────────────────────────────────────────────────────

function pitchToMidi(step, octave, alter) {
  return (octave + 1) * 12 + (STEP_SEMITONES[step] ?? 0) + Math.round(alter);
}

function noteToMidi(note, unpitchedMidiMap) {
  if (note.pitch) {
    return pitchToMidi(
      note.pitch.step,
      Number(note.pitch.octave),
      Number(note.pitch.alter) || 0,
    );
  }

  if (note.unpitched) {
    const instrumentId = note.instrument?.['@_id'];
    const mappedMidi = instrumentId ? unpitchedMidiMap.get(instrumentId) : null;
    if (Number.isFinite(mappedMidi)) return mappedMidi;

    const displayStep = note.unpitched['display-step'];
    const displayOctave = Number(note.unpitched['display-octave']);
    if (displayStep && Number.isFinite(displayOctave)) {
      return pitchToMidi(displayStep, displayOctave, 0);
    }
  }

  return null;
}

function extractUnpitchedMidiMap(scorePart) {
  const entries = new Map();
  for (const midiInstrument of asArray(scorePart?.['midi-instrument'])) {
    const id = midiInstrument?.['@_id'];
    const midi = Number(midiInstrument?.['midi-unpitched']);
    if (id && Number.isFinite(midi)) entries.set(id, midi);
  }
  return entries;
}

function extractLyrics(note) {
  return asArray(note.lyric)
    .map(lyric => {
      const text = textValue(lyric.text);
      if (!text) return null;
      return {
        text,
        syllabic: textValue(lyric.syllabic) || null,
        number:   lyric['@_number'] !== undefined ? String(lyric['@_number']) : null,
      };
    })
    .filter(Boolean);
}

function pitchClass(step, alter = 0) {
  return (STEP_SEMITONES[step] + Math.round(alter) + 120) % 12;
}

function parseHarmonySymbol(harmony) {
  const root = harmony.root;
  const rootStep = root?.['root-step'];
  if (!rootStep) return null;

  const rootAlter = Number(root['root-alter']) || 0;
  const rootName  = `${rootStep}${alterSuffix(rootAlter)}`;
  const kindValue = textValue(harmony.kind) || 'major';
  const kindText  = attrValue(harmony.kind, 'text');
  const suffix    = kindText || kindSuffix(kindValue);

  const bass = harmony.bass
    ? `${harmony.bass['bass-step']}${alterSuffix(Number(harmony.bass['bass-alter']) || 0)}`
    : null;

  return {
    root:   rootName,
    kind:   kindValue,
    bass,
    symbol: `${rootName}${suffix}${bass ? `/${bass}` : ''}`,
  };
}

function harmonyToNotes(harmonyEvents, sectionLengthBeats) {
  const notes = [];

  for (let i = 0; i < harmonyEvents.length; i++) {
    const event = harmonyEvents[i];
    const nextTime = harmonyEvents[i + 1]?.time ?? sectionLengthBeats;
    const duration = Math.max(0.25, round3(nextTime - event.time));
    const chordPitches = chordVoicing(event);

    for (const pitch of chordPitches) {
      notes.push({
        pitch,
        time:     event.time,
        duration,
        velocity: 72,
        muted:    false,
      });
    }
  }

  return notes;
}

function chordVoicing(event) {
  const root = parsePitchName(event.root);
  if (!root) return [];

  const intervals = kindIntervals(event.kind);
  const rootMidi  = 60 + root.pc;
  const pitches   = intervals.map(interval => rootMidi + interval);

  if (event.bass) {
    const bass = parsePitchName(event.bass);
    if (bass) pitches.unshift(48 + bass.pc);
  }

  return [...new Set(pitches)].sort((a, b) => a - b);
}

function parsePitchName(name) {
  const match = /^([A-G])([#b]{0,2})$/.exec(name);
  if (!match) return null;
  const [, step, accidentals] = match;
  const alter = [...accidentals].reduce((sum, ch) => sum + (ch === '#' ? 1 : -1), 0);
  return { step, alter, pc: pitchClass(step, alter) };
}

function kindIntervals(kind) {
  const normalized = String(kind || 'major').toLowerCase();
  if (normalized.includes('minor-major')) return [0, 3, 7, 11];
  if (normalized.includes('major-minor')) return [0, 4, 7, 10];
  if (normalized.includes('major-seventh')) return [0, 4, 7, 11];
  if (normalized.includes('minor-seventh')) return [0, 3, 7, 10];
  if (normalized.includes('dominant-ninth')) return [0, 4, 7, 10, 14];
  if (normalized.includes('major-ninth')) return [0, 4, 7, 11, 14];
  if (normalized.includes('minor-ninth')) return [0, 3, 7, 10, 14];
  if (normalized.includes('dominant')) return [0, 4, 7, 10];
  if (normalized.includes('half-diminished')) return [0, 3, 6, 10];
  if (normalized.includes('diminished-seventh')) return [0, 3, 6, 9];
  if (normalized.includes('diminished')) return [0, 3, 6];
  if (normalized.includes('augmented')) return [0, 4, 8];
  if (normalized.includes('suspended-fourth')) return [0, 5, 7];
  if (normalized.includes('suspended-second')) return [0, 2, 7];
  if (normalized.includes('minor-sixth')) return [0, 3, 7, 9];
  if (normalized.includes('major-sixth')) return [0, 4, 7, 9];
  if (normalized.includes('minor')) return [0, 3, 7];
  return [0, 4, 7];
}

function chordClipName(harmonyEvents) {
  const symbols = [];
  for (const event of harmonyEvents) {
    if (symbols[symbols.length - 1] !== event.symbol) symbols.push(event.symbol);
  }
  const suffix = symbols.length > 8 ? ' ...' : '';
  return symbols.slice(0, 8).join(' ') + suffix;
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

function alterSuffix(alter) {
  if (alter > 0) return '#'.repeat(alter);
  if (alter < 0) return 'b'.repeat(Math.abs(alter));
  return '';
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

function fifthsToScale(fifths, mode) {
  const idx = Math.max(0, Math.min(14, fifths + 7));
  return mode === 'minor' ? `${MINOR_KEYS[idx]} minor` : `${MAJOR_KEYS[idx]} major`;
}

function extractDynamic(dir) {
  for (const dt of asArray(dir['direction-type'])) {
    if (!dt.dynamics) continue;
    const key = Object.keys(dt.dynamics).find(k => DYNAMIC_VELOCITY[k]);
    if (key) return DYNAMIC_VELOCITY[key];
  }
  return null;
}

function buildWindows(totalMeasures, beatsPerBar, splitEvery, nameHint) {
  if (!splitEvery) {
    return [{
      name:      nameHint,
      startBeat: 0,
      endBeat:   totalMeasures * beatsPerBar,
      bars:      totalMeasures,
    }];
  }

  const windows = [];
  for (let m = 0; m < totalMeasures; m += splitEvery) {
    const endM = Math.min(m + splitEvery, totalMeasures);
    windows.push({
      name:      `${nameHint}_${String(windows.length).padStart(2, '0')}`,
      startBeat: m * beatsPerBar,
      endBeat:   endM * beatsPerBar,
      bars:      endM - m,
    });
  }
  return windows;
}

function applyTrackRenames(tracksOption, partLabels) {
  if (!tracksOption) return;
  const parts     = tracksOption.split(',').map(s => s.trim()).filter(Boolean);
  const isMapMode = parts.some(p => p.includes(':'));

  if (isMapMode) {
    for (const part of parts) {
      const colonIdx = part.indexOf(':');
      if (colonIdx === -1) continue;
      const orig    = part.slice(0, colonIdx).trim();
      const newName = part.slice(colonIdx + 1).trim();
      const found   = partLabels.find(p => p.name === orig);
      if (found) found.name = newName;
    }
  } else {
    for (let i = 0; i < parts.length && i < partLabels.length; i++) {
      partLabels[i].name = parts[i];
    }
  }
}

/** Ensure a value is always an array (handles undefined, single object, array). */
function asArray(val) {
  if (!val) return [];
  return Array.isArray(val) ? val : [val];
}

function round3(n) {
  return Math.round(n * 1000) / 1000;
}

/**
 * Read a MusicXML file as a UTF-8 string.
 * Handles both plain .xml/.musicxml and compressed .mxl (ZIP) formats.
 *
 * .mxl structure:
 *   META-INF/container.xml  → lists the rootfile path
 *   <rootfile>.xml          → the actual MusicXML score
 */
async function readXmlContent(filePath) {
  const buffer = await readFile(filePath).catch(() => {
    throw new Error(`File not found: ${filePath}`);
  });

  if (!filePath.toLowerCase().endsWith('.mxl')) {
    return buffer.toString('utf-8');
  }

  // Decompress the .mxl ZIP archive
  const { unzipSync } = await import('fflate');
  const unzipped = unzipSync(new Uint8Array(buffer));

  // Try to read META-INF/container.xml for the canonical rootfile path
  const containerBytes = unzipped['META-INF/container.xml'];
  if (containerBytes) {
    const containerXml = new TextDecoder().decode(containerBytes);
    const match = containerXml.match(/full-path="([^"]+\.xml)"/);
    if (match) {
      const bytes = unzipped[match[1]];
      if (bytes) return new TextDecoder().decode(bytes);
    }
  }

  // Fallback: use the first .xml file that isn't in META-INF
  for (const [name, bytes] of Object.entries(unzipped)) {
    if (name.endsWith('.xml') && !name.startsWith('META-INF')) {
      return new TextDecoder().decode(bytes);
    }
  }

  throw new Error('No MusicXML score found inside the .mxl archive.');
}
