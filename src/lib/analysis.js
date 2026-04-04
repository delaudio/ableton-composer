/**
 * Music analysis functions — extract style features from AbletonSong JSON sets.
 */

// ── Key detection (Krumhansl-Schmuckler) ─────────────────────────────────────

const PITCH_CLASS_NAMES = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'];

// Krumhansl-Schmuckler tonal hierarchy profiles
const MAJOR_PROFILE = [6.35, 2.23, 3.48, 2.33, 4.38, 4.09, 2.52, 5.19, 2.39, 3.66, 2.29, 2.88];
const MINOR_PROFILE = [6.33, 2.68, 3.52, 5.38, 2.60, 3.53, 2.54, 4.75, 3.98, 2.69, 3.34, 3.17];

function pearsonCorrelation(a, b) {
  const n    = a.length;
  const meanA = a.reduce((s, x) => s + x, 0) / n;
  const meanB = b.reduce((s, x) => s + x, 0) / n;
  let num = 0, denA = 0, denB = 0;
  for (let i = 0; i < n; i++) {
    num  += (a[i] - meanA) * (b[i] - meanB);
    denA += (a[i] - meanA) ** 2;
    denB += (b[i] - meanB) ** 2;
  }
  return (denA === 0 || denB === 0) ? 0 : num / Math.sqrt(denA * denB);
}

function rotatePc(profile, n) {
  return profile.map((_, i) => profile[(i - n + 12) % 12]);
}

export function detectKey(pitchClassCounts) {
  const total = pitchClassCounts.reduce((a, b) => a + b, 0);
  if (total === 0) return { key: 'unknown', root: null, mode: null, confidence: 0 };

  const norm = pitchClassCounts.map(c => c / total);

  let best = { score: -Infinity, root: 0, mode: 'major' };

  for (let root = 0; root < 12; root++) {
    const majorScore = pearsonCorrelation(norm, rotatePc(MAJOR_PROFILE, root));
    const minorScore = pearsonCorrelation(norm, rotatePc(MINOR_PROFILE, root));

    if (majorScore > best.score) best = { score: majorScore, root, mode: 'major' };
    if (minorScore > best.score) best = { score: minorScore, root, mode: 'minor' };
  }

  return {
    key:        `${PITCH_CLASS_NAMES[best.root]} ${best.mode}`,
    root:       best.root,
    mode:       best.mode,
    confidence: Math.round(best.score * 100) / 100,
  };
}

// ── Track classification ──────────────────────────────────────────────────────

const DRUM_TRACK_NAMES = /^(drums?|dr|kick|snare|perc|percussion|hh|hihat|hi.hat)$/i;

export function isDrumTrack(trackName) {
  return DRUM_TRACK_NAMES.test(trackName.trim());
}

// ── Pitch class counts ────────────────────────────────────────────────────────

/**
 * Build a 12-element pitch class count array from an array of notes.
 * Weights each note by its velocity and duration.
 */
export function pitchClassCounts(notes) {
  const counts = new Array(12).fill(0);
  for (const n of notes) {
    const pc = n.pitch % 12;
    counts[pc] += (n.velocity / 127) * n.duration;
  }
  return counts;
}

// ── Rhythm analysis ───────────────────────────────────────────────────────────

/**
 * Returns notes-per-bar for a clip.
 */
export function notesPerBar(clip) {
  if (!clip.length_bars || clip.length_bars === 0) return 0;
  return clip.notes.length / clip.length_bars;
}

/**
 * Syncopation ratio: fraction of note onsets on off-beats (non-integer beat positions).
 */
export function syncopationRatio(notes) {
  if (notes.length === 0) return 0;
  const offbeat = notes.filter(n => n.time % 1 !== 0).length;
  return Math.round((offbeat / notes.length) * 100) / 100;
}

// ── Pitch range ───────────────────────────────────────────────────────────────

export function pitchRange(notes) {
  if (notes.length === 0) return null;
  const pitches = notes.map(n => n.pitch);
  const min = Math.min(...pitches);
  const max = Math.max(...pitches);
  return { min, max, semitones: max - min };
}

// ── Chord detection ───────────────────────────────────────────────────────────

const CHORD_WINDOW = 0.1; // beats — notes within this window are considered simultaneous

/**
 * Group notes into simultaneous clusters (chords) using a sliding time window.
 * Returns an array of pitch-class sets (sorted, deduped), e.g. ["A","C","E"].
 */
export function detectChords(notes) {
  if (notes.length < 2) return [];

  const sorted  = [...notes].sort((a, b) => a.time - b.time);
  const chords  = [];
  let cluster   = [sorted[0]];

  for (let i = 1; i < sorted.length; i++) {
    if (sorted[i].time - cluster[0].time <= CHORD_WINDOW) {
      cluster.push(sorted[i]);
    } else {
      if (cluster.length >= 2) {
        const pcs = [...new Set(cluster.map(n => PITCH_CLASS_NAMES[n.pitch % 12]))];
        chords.push(pcs.sort().join('-'));
      }
      cluster = [sorted[i]];
    }
  }
  if (cluster.length >= 2) {
    const pcs = [...new Set(cluster.map(n => PITCH_CLASS_NAMES[n.pitch % 12]))];
    chords.push(pcs.sort().join('-'));
  }

  return chords;
}

/**
 * Count chord occurrences and return top N most frequent, with counts.
 * e.g. [{ chord: "A-C-E", count: 12 }, ...]
 */
export function topChords(notes, topN = 5) {
  const all    = detectChords(notes);
  if (all.length === 0) return [];
  const counts = {};
  for (const c of all) counts[c] = (counts[c] || 0) + 1;
  return Object.entries(counts)
    .sort((a, b) => b[1] - a[1])
    .slice(0, topN)
    .map(([chord, count]) => ({ chord, count }));
}

// ── Average note duration ─────────────────────────────────────────────────────

export function avgDuration(notes) {
  if (notes.length === 0) return 0;
  const total = notes.reduce((s, n) => s + n.duration, 0);
  return Math.round((total / notes.length) * 100) / 100;
}

// ── Full set analysis ─────────────────────────────────────────────────────────

/**
 * Analyze a loaded AbletonSong and return a style profile.
 *
 * @param {object} song    - Parsed AbletonSong { meta, sections[] }
 * @param {string} source  - Path string for the _meta field
 * @returns {object} style profile
 */
export function analyzeSong(song, source = '') {
  const { meta, sections } = song;
  // Handle both flat format ({ bpm, time_signature }) and double-wrapped ({ meta: { bpm } })
  const flatMeta   = meta.bpm !== undefined ? meta : (meta.meta ?? meta);
  const beatsPerBar = parseInt((flatMeta.time_signature || '4/4').split('/')[0], 10) || 4;

  // ── Collect all notes per track (excluding drums for pitch analysis) ─────
  const allNotesByTrack = new Map();   // trackName → notes[]
  const drumNotesByTrack = new Map();  // drum tracks only
  const allPitchNotes = [];            // non-drum notes for key detection

  for (const section of sections) {
    for (const track of section.tracks) {
      const { ableton_name: name, clip } = track;
      if (!clip?.notes) continue;

      if (!allNotesByTrack.has(name)) allNotesByTrack.set(name, []);
      allNotesByTrack.get(name).push(...clip.notes);

      if (isDrumTrack(name)) {
        if (!drumNotesByTrack.has(name)) drumNotesByTrack.set(name, []);
        drumNotesByTrack.get(name).push(...clip.notes);
      } else {
        allPitchNotes.push(...clip.notes);
      }
    }
  }

  // ── Key detection ────────────────────────────────────────────────────────
  const pcCounts  = pitchClassCounts(allPitchNotes);
  const keyResult = detectKey(pcCounts);

  // ── Structure ────────────────────────────────────────────────────────────
  const sectionNames = sections.map(s => s.name);
  const barCounts    = sections.map(s => s.bars ?? s.tracks[0]?.clip?.length_bars ?? 0);
  const avgBars      = barCounts.length
    ? Math.round((barCounts.reduce((a, b) => a + b, 0) / barCounts.length) * 10) / 10
    : 0;
  const totalBars    = barCounts.reduce((a, b) => a + b, 0);

  // ── Arrangement ──────────────────────────────────────────────────────────
  const trackNames = [...new Set(sections.flatMap(s => s.tracks.map(t => t.ableton_name)))];

  const bySection = {};
  for (const section of sections) {
    bySection[section.name] = section.tracks
      .filter(t => t.clip?.notes?.length > 0)
      .map(t => t.ableton_name);
  }

  // Track presence ratio: fraction of sections where the track has notes
  const trackPresence = {};
  for (const name of trackNames) {
    const active = sections.filter(s =>
      s.tracks.some(t => t.ableton_name === name && t.clip?.notes?.length > 0)
    ).length;
    trackPresence[name] = Math.round((active / sections.length) * 100) / 100;
  }

  // ── Rhythm ───────────────────────────────────────────────────────────────
  const notesPerBarByTrack = {};
  for (const [name, notes] of allNotesByTrack) {
    const totalBarsForTrack = sections.reduce((sum, s) => {
      const track = s.tracks.find(t => t.ableton_name === name);
      return sum + (track?.clip?.length_bars ?? 0);
    }, 0);
    notesPerBarByTrack[name] = totalBarsForTrack > 0
      ? Math.round((notes.length / totalBarsForTrack) * 10) / 10
      : 0;
  }

  // Drum syncopation (off-beat ratio for drum tracks)
  const drumSyncopation = {};
  for (const [name, notes] of drumNotesByTrack) {
    drumSyncopation[name] = syncopationRatio(notes);
  }

  // ── Pitch / melody ───────────────────────────────────────────────────────
  const pitchByTrack = {};
  for (const [name, notes] of allNotesByTrack) {
    if (isDrumTrack(name)) continue;
    const range = pitchRange(notes);
    if (range) {
      pitchByTrack[name] = {
        ...range,
        avg_velocity: Math.round(notes.reduce((s, n) => s + n.velocity, 0) / notes.length),
        avg_duration: avgDuration(notes),
      };
    }
  }

  // ── Chord detection (non-drum tracks only) ───────────────────────────────
  const chordsByTrack = {};
  for (const [name, notes] of allNotesByTrack) {
    if (isDrumTrack(name)) continue;
    const top = topChords(notes);
    if (top.length > 0) chordsByTrack[name] = top;
  }

  // Pitch class distribution (named)
  const pcNamed = {};
  for (let i = 0; i < 12; i++) {
    if (pcCounts[i] > 0)
      pcNamed[PITCH_CLASS_NAMES[i]] = Math.round(pcCounts[i] * 100) / 100;
  }

  // ── Per-section key detection ────────────────────────────────────────────
  const keyBySection = {};
  for (const section of sections) {
    const sectionNotes = [];
    for (const track of section.tracks) {
      if (!track.clip?.notes || isDrumTrack(track.ableton_name)) continue;
      sectionNotes.push(...track.clip.notes);
    }
    const sectionPc  = pitchClassCounts(sectionNotes);
    const sectionKey = detectKey(sectionPc);
    if (sectionKey.key !== 'unknown') {
      keyBySection[section.name] = { key: sectionKey.key, confidence: sectionKey.confidence };
    }
  }

  // ── Assemble profile ─────────────────────────────────────────────────────
  return {
    _meta: {
      source,
      sections_analyzed: sections.length,
      generated_at: new Date().toISOString(),
    },
    bpm:            flatMeta.bpm ?? null,
    time_signature: flatMeta.time_signature ?? '4/4',
    key:            keyResult.key,
    key_confidence: keyResult.confidence,
    structure: {
      section_count:    sections.length,
      bars_per_section: avgBars,
      total_bars:       totalBars,
      section_sequence: sectionNames,
    },
    arrangement: {
      tracks:        trackNames,
      by_section:    bySection,
      track_presence: trackPresence,
    },
    rhythm: {
      notes_per_bar:    notesPerBarByTrack,
      drum_syncopation: drumSyncopation,
    },
    pitch: {
      pitch_classes:  pcNamed,
      by_track:       pitchByTrack,
      chords_by_track: chordsByTrack,
      key_by_section: keyBySection,
    },
  };
}

// ── Collection aggregation ────────────────────────────────────────────────────

/**
 * Aggregate multiple style profiles into a single "collection profile".
 * BPM → range, key → consensus vote, structure → most common patterns.
 *
 * @param {object[]} profiles
 * @returns {object} aggregated profile
 */
export function aggregateProfiles(profiles) {
  if (profiles.length === 0) return null;

  // BPM range
  const bpms = profiles.map(p => p.bpm).filter(Boolean);
  const bpmRange = bpms.length
    ? { min: Math.min(...bpms), max: Math.max(...bpms), avg: Math.round(bpms.reduce((a, b) => a + b, 0) / bpms.length) }
    : null;

  // Key consensus (most common key)
  const keyCounts = {};
  for (const p of profiles) {
    if (p.key && p.key !== 'unknown') keyCounts[p.key] = (keyCounts[p.key] || 0) + 1;
  }
  const consensusKey = Object.entries(keyCounts).sort((a, b) => b[1] - a[1])[0]?.[0] ?? 'unknown';

  // Mode consensus
  const modes = profiles.map(p => p.key?.includes('minor') ? 'minor' : 'major').filter(Boolean);
  const modeCount = modes.reduce((acc, m) => { acc[m] = (acc[m] || 0) + 1; return acc; }, {});
  const consensusMode = Object.entries(modeCount).sort((a, b) => b[1] - a[1])[0]?.[0] ?? 'major';

  // Structure: average bars per section, section count range
  const barsPerSection = profiles.map(p => p.structure?.bars_per_section).filter(Boolean);
  const sectionCounts  = profiles.map(p => p.structure?.section_count).filter(Boolean);

  // Track presence: average across profiles
  const allTrackNames = [...new Set(profiles.flatMap(p => p.arrangement?.tracks ?? []))];
  const avgPresence   = {};
  for (const name of allTrackNames) {
    const vals = profiles.map(p => p.arrangement?.track_presence?.[name] ?? 0);
    avgPresence[name] = Math.round((vals.reduce((a, b) => a + b, 0) / vals.length) * 100) / 100;
  }

  // Rhythm: avg notes per bar per track
  const avgNotesPerBar = {};
  for (const name of allTrackNames) {
    const vals = profiles.map(p => p.rhythm?.notes_per_bar?.[name]).filter(v => v !== undefined);
    if (vals.length)
      avgNotesPerBar[name] = Math.round((vals.reduce((a, b) => a + b, 0) / vals.length) * 10) / 10;
  }

  return {
    _meta: {
      sources:       profiles.map(p => p._meta?.source).filter(Boolean),
      sets_analyzed: profiles.length,
      generated_at:  new Date().toISOString(),
    },
    bpm_range:      bpmRange,
    time_signature: profiles[0]?.time_signature ?? '4/4',
    key_consensus:  consensusKey,
    mode_consensus: consensusMode,
    structure: {
      section_count_range: sectionCounts.length
        ? { min: Math.min(...sectionCounts), max: Math.max(...sectionCounts), avg: Math.round(sectionCounts.reduce((a,b) => a+b, 0) / sectionCounts.length) }
        : null,
      bars_per_section_avg: barsPerSection.length
        ? Math.round(barsPerSection.reduce((a, b) => a + b, 0) / barsPerSection.length * 10) / 10
        : null,
    },
    arrangement: {
      tracks:         allTrackNames,
      track_presence: avgPresence,
    },
    rhythm: {
      notes_per_bar: avgNotesPerBar,
    },
  };
}
