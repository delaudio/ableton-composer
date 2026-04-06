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
import { readFile, writeFile } from 'fs/promises';
import { join, basename, extname } from 'path';
import { saveSong, saveSetDirectory } from '../lib/storage.js';

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
        'part', 'measure', 'note', 'direction', 'score-part',
        'tie', 'beam', 'slur', 'attributes', 'direction-type',
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
        notes: extractNotes(part.measure, beatsPerBar),
      }))
      .filter(p => p.notes.length > 0);

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

      for (const { name, notes } of partNoteSets) {
        const sectionNotes = notes
          .filter(n => n.time >= win.startBeat && n.time < win.endBeat)
          .map(n => ({
            pitch:    n.pitch,
            time:     round3(n.time - win.startBeat),
            duration: round3(Math.min(n.duration, win.endBeat - n.time)),
            velocity: n.velocity,
            muted:    false,
          }));

        if (sectionNotes.length > 0) {
          tracks.push({ ableton_name: name, clip: { length_bars: win.bars, notes: sectionNotes } });
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

      sections.push({ name: win.name, bars: win.bars, tracks });
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
      },
      sections,
    };

    // ── Save ──────────────────────────────────────────────────────────────────
    if (options.out) {
      const absOut  = options.out.startsWith('/') ? options.out : join(process.cwd(), options.out);
      const saveDir = options.out.endsWith('/') || !options.out.endsWith('.json');

      if (saveDir) {
        await saveSetDirectory(song, absOut);
        console.log(chalk.green(`✓ Saved to ${absOut}/`));
        console.log(chalk.dim('  Edit "genre" in meta.json to complete metadata.'));
      } else {
        await writeFile(absOut, JSON.stringify(song, null, 2), 'utf-8');
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
 * Returns a flat array of { pitch, time, duration, velocity } with absolute beat times.
 *
 * Handles:
 *  - Variable divisions per measure
 *  - Chord notes (simultaneous with previous)
 *  - Rests (advance cursor, no note)
 *  - Grace notes (skipped)
 *  - Tied notes (durations merged across measures)
 *  - Dynamics for velocity
 */
function extractNotes(measures, beatsPerBar) {
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

      if (!isRest && n.pitch) {
        const midi = pitchToMidi(
          n.pitch.step,
          Number(n.pitch.octave),
          Number(n.pitch.alter) || 0,
        );

        const ties      = asArray(n.tie);
        const isTieStop  = ties.some(t => t['@_type'] === 'stop');
        const isTieStart = ties.some(t => t['@_type'] === 'start');

        if (isTieStop && pendingTies[midi]) {
          // Extend the tied note's duration
          pendingTies[midi].duration += beatDur;
          if (!isTieStart) delete pendingTies[midi];
        } else {
          const noteObj = { pitch: midi, time: cursor, duration: beatDur, velocity: currentVelocity };
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

// ─── helpers ─────────────────────────────────────────────────────────────────

function pitchToMidi(step, octave, alter) {
  return (octave + 1) * 12 + (STEP_SEMITONES[step] ?? 0) + Math.round(alter);
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
