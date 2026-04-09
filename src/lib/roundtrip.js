import { mkdtemp, rm } from 'fs/promises';
import { tmpdir } from 'os';
import { join } from 'path';
import { exportSongToMidi } from './midi-export.js';
import { exportSongToMusicXml } from './musicxml.js';

export async function validateRoundtrip(song, { via }) {
  const tempDir = await mkdtemp(join(tmpdir(), `ac-roundtrip-${via}-`));

  try {
    const exportPath = join(tempDir, via === 'midi' ? 'roundtrip.mid' : via === 'musicxml' ? 'roundtrip.musicxml' : 'roundtrip.mxl');

    if (via === 'midi') {
      await exportSongToMidi(song, exportPath);
    } else if (via === 'musicxml' || via === 'mxl') {
      await exportSongToMusicXml(song, exportPath);
    } else {
      throw new Error(`Unsupported round-trip format: ${via}`);
    }

    const reimported = await reimportExport(exportPath, via, tempDir);
    return buildRoundtripReport(song, reimported, via, exportPath);
  } finally {
    await rm(tempDir, { recursive: true, force: true });
  }
}

async function reimportExport(exportPath, via, tempDir) {
  if (via === 'midi') {
    const { importMidiFromFile } = await import('../commands/import-midi-runtime.js');
    return importMidiFromFile(exportPath);
  }

  const { importXmlFromFile } = await import('../commands/import-xml-runtime.js');
  const tempOut = join(tempDir, 'reimported-set');
  const song = await importXmlFromFile(exportPath, { outDir: tempOut });
  return song;
}

function buildRoundtripReport(sourceSong, importedSong, via, exportPath) {
  const sourceFlat = flattenSong(sourceSong);
  const importedFlat = flattenSong(importedSong);

  const sourceTracks = [...new Set(sourceFlat.map(note => note.track))].sort();
  const importedTracks = [...new Set(importedFlat.map(note => note.track))].sort();

  const noteComparison = compareFlattenedNotes(sourceFlat, importedFlat);
  const trackComparison = compareTrackSets(sourceTracks, importedTracks);

  return {
    format: via,
    export_path: exportPath,
    source: summarizeSong(sourceSong, sourceFlat, sourceTracks),
    imported: summarizeSong(importedSong, importedFlat, importedTracks),
    comparison: {
      bpm_match: Number(sourceSong.meta?.bpm || 0) === Number(importedSong.meta?.bpm || 0),
      time_signature_match: String(sourceSong.meta?.time_signature || '4/4') === String(importedSong.meta?.time_signature || '4/4'),
      note_count_delta: importedFlat.length - sourceFlat.length,
      track_name_overlap_pct: percentage(trackComparison.shared.length, Math.max(sourceTracks.length, importedTracks.length, 1)),
      missing_tracks: trackComparison.missing,
      extra_tracks: trackComparison.extra,
      matched_notes: noteComparison.matched,
      unmatched_source_notes: noteComparison.unmatchedSource,
      unmatched_imported_notes: noteComparison.unmatchedImported,
      note_match_pct: percentage(noteComparison.matched, Math.max(sourceFlat.length, importedFlat.length, 1)),
      pitch_mismatch_count: noteComparison.pitchMismatch,
      timing_mismatch_count: noteComparison.timingMismatch,
      duration_mismatch_count: noteComparison.durationMismatch,
      section_count_delta: (importedSong.sections?.length || 0) - (sourceSong.sections?.length || 0),
    },
  };
}

function summarizeSong(song, flatNotes, trackNames) {
  return {
    bpm: Number(song.meta?.bpm || 0),
    time_signature: String(song.meta?.time_signature || '4/4'),
    sections: song.sections?.length || 0,
    tracks: trackNames,
    note_count: flatNotes.length,
  };
}

function flattenSong(song) {
  const beatsPerBar = parseBeatsPerBar(song.meta?.time_signature || '4/4');
  const flat = [];
  let sectionStartBeat = 0;

  for (const section of song.sections || []) {
    const bars = Number(section.bars) || inferSectionBars(section, beatsPerBar);
    for (const track of section.tracks || []) {
      for (const note of track.clip?.notes || []) {
        flat.push({
          track: track.ableton_name,
          pitch: Number(note.pitch),
          time: round3(sectionStartBeat + Number(note.time || 0)),
          duration: round3(Number(note.duration || 0)),
        });
      }
    }
    sectionStartBeat += bars * beatsPerBar;
  }

  return flat.sort((a, b) =>
    a.track.localeCompare(b.track, 'en') ||
    a.time - b.time ||
    a.pitch - b.pitch ||
    a.duration - b.duration
  );
}

function compareFlattenedNotes(source, imported) {
  const usedImported = new Set();
  let matched = 0;
  let pitchMismatch = 0;
  let timingMismatch = 0;
  let durationMismatch = 0;

  for (const sourceNote of source) {
    const candidateIndex = imported.findIndex((note, index) =>
      !usedImported.has(index) &&
      note.track === sourceNote.track &&
      Math.abs(note.time - sourceNote.time) <= 0.05
    );

    if (candidateIndex === -1) continue;

    usedImported.add(candidateIndex);
    const importedNote = imported[candidateIndex];

    const pitchOk = importedNote.pitch === sourceNote.pitch;
    const timeOk = Math.abs(importedNote.time - sourceNote.time) <= 0.01;
    const durationOk = Math.abs(importedNote.duration - sourceNote.duration) <= 0.125;

    if (pitchOk && timeOk) matched++;
    if (!pitchOk) pitchMismatch++;
    if (!timeOk) timingMismatch++;
    if (!durationOk) durationMismatch++;
  }

  return {
    matched,
    unmatchedSource: source.length - matched,
    unmatchedImported: imported.length - matched,
    pitchMismatch,
    timingMismatch,
    durationMismatch,
  };
}

function compareTrackSets(sourceTracks, importedTracks) {
  const importedSet = new Set(importedTracks);
  const sourceSet = new Set(sourceTracks);
  return {
    shared: sourceTracks.filter(track => importedSet.has(track)),
    missing: sourceTracks.filter(track => !importedSet.has(track)),
    extra: importedTracks.filter(track => !sourceSet.has(track)),
  };
}

function inferSectionBars(section, beatsPerBar) {
  const clipLengths = (section.tracks || []).map(track => Number(track.clip?.length_bars) || 0).filter(Boolean);
  if (clipLengths.length > 0) return Math.max(...clipLengths);
  const lastBeat = Math.max(0, ...(section.tracks || []).flatMap(track =>
    (track.clip?.notes || []).map(note => Number(note.time || 0) + Number(note.duration || 0))
  ));
  return Math.max(1, Math.ceil(lastBeat / beatsPerBar));
}

function parseBeatsPerBar(signature) {
  return Number(String(signature).split('/')[0]) || 4;
}

function percentage(part, total) {
  return Math.round((part / total) * 100);
}

function round3(value) {
  return Math.round(value * 1000) / 1000;
}
