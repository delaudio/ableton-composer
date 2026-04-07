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
const BASS_TRACK_NAMES = /(bass|sub|bajo|x-tra.?bass|acoustic bass|string bajo)/i;
const PAD_TRACK_NAMES = /(pad|string|strings|atmosphere|choir|chour|halo)/i;
const LEAD_TRACK_NAMES = /(lead|melody|hook|solo|celesta|knack|eco|blow)/i;
const CHORD_TRACK_NAMES = /(chord|piano|keys|rhodes|organ|organo|nylon|guitarra)/i;
const FX_TRACK_NAMES = /(fx|effekt|effect|efecto|breath|noise|sweep|rise|impact)/i;

export function isDrumTrack(trackName) {
  return DRUM_TRACK_NAMES.test(trackName.trim());
}

export function classifyTrackRole(trackName) {
  const name = trackName.trim();
  if (isDrumTrack(name) || /drum|hihat|tambo|kit|reprizdr|bass drum/i.test(name)) return 'drums';
  if (BASS_TRACK_NAMES.test(name)) return 'bass';
  if (PAD_TRACK_NAMES.test(name)) return 'pad';
  if (LEAD_TRACK_NAMES.test(name)) return 'lead';
  if (CHORD_TRACK_NAMES.test(name)) return 'chords';
  if (FX_TRACK_NAMES.test(name)) return 'fx';
  return 'other';
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

function quantizeStep(time, stepsPerBar = 16, beatsPerBar = 4) {
  const stepSize = beatsPerBar / stepsPerBar;
  return Math.round(time / stepSize) % stepsPerBar;
}

function onsetHistogram(notes, beatsPerBar = 4, stepsPerBar = 16) {
  const histogram = new Array(stepsPerBar).fill(0);
  for (const note of notes) {
    histogram[quantizeStep(note.time, stepsPerBar, beatsPerBar)] += 1;
  }
  const total = histogram.reduce((sum, value) => sum + value, 0);
  if (total === 0) return histogram;
  return histogram.map(value => Math.round((value / total) * 100) / 100);
}

function dominantStepPattern(notes, beatsPerBar = 4, stepsPerBar = 16) {
  const stepSet = [...new Set(notes.map(note => quantizeStep(note.time, stepsPerBar, beatsPerBar)))].sort((a, b) => a - b);
  return stepSet.join('-');
}

function analyzeSectionRhythm(section, beatsPerBar) {
  const notes = section.tracks.flatMap(track => track.clip?.notes ?? []);
  return {
    section: section.name,
    bars: section.bars,
    notes_per_bar: section.bars > 0 ? Math.round((notes.length / section.bars) * 10) / 10 : 0,
    syncopation: syncopationRatio(notes),
  };
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

function detectChordEvents(notes) {
  if (notes.length < 2) return [];

  const sorted = [...notes].sort((a, b) => a.time - b.time);
  const events = [];
  let cluster = [sorted[0]];

  const pushCluster = current => {
    if (current.length < 2) return;
    const pcs = [...new Set(current.map(n => PITCH_CLASS_NAMES[n.pitch % 12]))].sort();
    const lowest = current.reduce((lo, note) => note.pitch < lo.pitch ? note : lo, current[0]);
    events.push({
      time: current[0].time,
      chord: pcs.join('-'),
      bass_pc: PITCH_CLASS_NAMES[lowest.pitch % 12],
    });
  };

  for (let i = 1; i < sorted.length; i++) {
    if (sorted[i].time - cluster[0].time <= CHORD_WINDOW) {
      cluster.push(sorted[i]);
    } else {
      pushCluster(cluster);
      cluster = [sorted[i]];
    }
  }
  pushCluster(cluster);

  return events;
}

function summarizeSectionHarmony(section, beatsPerBar) {
  const pitchedNotes = section.tracks
    .filter(track => !isDrumTrack(track.ableton_name))
    .flatMap(track => track.clip?.notes ?? []);

  const events = detectChordEvents(pitchedNotes);
  const progressionByBar = Array.from({ length: section.bars || 0 }, (_, barIndex) => {
    const inBar = events.filter(event => Math.floor(event.time / beatsPerBar) === barIndex);
    const chord = inBar[0]?.chord || null;
    return {
      bar: barIndex + 1,
      chord,
      bass_pc: inBar[0]?.bass_pc || null,
      event_count: inBar.length,
    };
  });

  const chordEvents = progressionByBar.filter(entry => entry.chord);
  const rootTransitions = [];
  for (let i = 1; i < chordEvents.length; i++) {
    rootTransitions.push(`${chordEvents[i - 1].bass_pc}->${chordEvents[i].bass_pc}`);
  }

  const harmonicRhythm = section.bars > 0
    ? Math.round((events.length / section.bars) * 100) / 100
    : 0;

  return {
    section: section.name,
    bars: section.bars,
    harmonic_rhythm_changes_per_bar: harmonicRhythm,
    progression_by_bar: progressionByBar,
    top_chords: topCounts(chordEvents.map(entry => entry.chord), 6),
    bass_root_motion: topCounts(rootTransitions, 6),
  };
}

function topCounts(values, topN = 5) {
  const counts = {};
  for (const value of values.filter(Boolean)) counts[value] = (counts[value] || 0) + 1;
  return Object.entries(counts)
    .sort((a, b) => b[1] - a[1])
    .slice(0, topN)
    .map(([value, count]) => ({ value, count }));
}

export function analyzeHarmony(song, source = '') {
  const { meta, sections } = song;
  const flatMeta = meta.bpm !== undefined ? meta : (meta.meta ?? meta);
  const beatsPerBar = parseInt((flatMeta.time_signature || '4/4').split('/')[0], 10) || 4;

  const sectionHarmony = sections.map(section => summarizeSectionHarmony(section, beatsPerBar));
  const allChordTransitions = [];
  const allBassTransitions = [];
  const allTopChords = [];

  for (const section of sectionHarmony) {
    const sequence = section.progression_by_bar.filter(entry => entry.chord);
    for (let i = 1; i < sequence.length; i++) {
      allChordTransitions.push(`${sequence[i - 1].chord}->${sequence[i].chord}`);
    }
    allBassTransitions.push(...section.bass_root_motion.flatMap(entry => Array(entry.count).fill(entry.value)));
    allTopChords.push(...section.top_chords.flatMap(entry => Array(entry.count).fill(entry.value)));
  }

  return {
    _meta: {
      source,
      sections_analyzed: sections.length,
      generated_at: new Date().toISOString(),
    },
    harmony: {
      harmonic_rhythm_avg: sectionHarmony.length
        ? Math.round((sectionHarmony.reduce((sum, section) => sum + section.harmonic_rhythm_changes_per_bar, 0) / sectionHarmony.length) * 100) / 100
        : 0,
      top_chords: topCounts(allTopChords, 10),
      top_progressions: topCounts(allChordTransitions, 10),
      top_bass_root_motion: topCounts(allBassTransitions, 10),
      by_section: sectionHarmony,
    },
  };
}

export function aggregateHarmonyProfiles(profiles) {
  if (profiles.length === 0) return null;

  const harmonicRhythmValues = profiles
    .map(profile => profile.harmony?.harmonic_rhythm_avg)
    .filter(value => typeof value === 'number');

  const topChords = [];
  const topProgressions = [];
  const topBassMotion = [];

  for (const profile of profiles) {
    topChords.push(...(profile.harmony?.top_chords ?? []).flatMap(entry => Array(entry.count).fill(entry.value)));
    topProgressions.push(...(profile.harmony?.top_progressions ?? []).flatMap(entry => Array(entry.count).fill(entry.value)));
    topBassMotion.push(...(profile.harmony?.top_bass_root_motion ?? []).flatMap(entry => Array(entry.count).fill(entry.value)));
  }

  return {
    _meta: {
      sources: profiles.map(profile => profile._meta?.source).filter(Boolean),
      sets_analyzed: profiles.length,
      generated_at: new Date().toISOString(),
    },
    harmony: {
      harmonic_rhythm_avg: harmonicRhythmValues.length
        ? Math.round((harmonicRhythmValues.reduce((sum, value) => sum + value, 0) / harmonicRhythmValues.length) * 100) / 100
        : 0,
      top_chords: topCounts(topChords, 12),
      top_progressions: topCounts(topProgressions, 12),
      top_bass_root_motion: topCounts(topBassMotion, 12),
    },
  };
}

export function analyzeRhythm(song, source = '') {
  const { meta, sections } = song;
  const flatMeta = meta.bpm !== undefined ? meta : (meta.meta ?? meta);
  const beatsPerBar = parseInt((flatMeta.time_signature || '4/4').split('/')[0], 10) || 4;

  const allNotesByTrack = new Map();
  for (const section of sections) {
    for (const track of section.tracks) {
      const notes = track.clip?.notes ?? [];
      if (!allNotesByTrack.has(track.ableton_name)) allNotesByTrack.set(track.ableton_name, []);
      allNotesByTrack.get(track.ableton_name).push(...notes);
    }
  }

  const byTrack = {};
  for (const [name, notes] of allNotesByTrack.entries()) {
    byTrack[name] = {
      notes_per_bar: (() => {
        const totalBars = sections.reduce((sum, section) => {
          const track = section.tracks.find(item => item.ableton_name === name);
          return sum + (track?.clip?.length_bars ?? 0);
        }, 0);
        return totalBars > 0 ? Math.round((notes.length / totalBars) * 10) / 10 : 0;
      })(),
      syncopation: syncopationRatio(notes),
      onset_histogram_16: onsetHistogram(notes, beatsPerBar, 16),
      dominant_pattern_16: dominantStepPattern(notes, beatsPerBar, 16),
      avg_duration: avgDuration(notes),
    };
  }

  return {
    _meta: {
      source,
      sections_analyzed: sections.length,
      generated_at: new Date().toISOString(),
    },
    rhythm: {
      avg_section_density: sections.length
        ? Math.round((sections.reduce((sum, section) => sum + ((section.tracks.flatMap(track => track.clip?.notes ?? []).length) / (section.bars || 1)), 0) / sections.length) * 10) / 10
        : 0,
      by_track: byTrack,
      by_section: sections.map(section => analyzeSectionRhythm(section, beatsPerBar)),
    },
  };
}

export function aggregateRhythmProfiles(profiles) {
  if (profiles.length === 0) return null;

  const allTrackNames = [...new Set(profiles.flatMap(profile => Object.keys(profile.rhythm?.by_track ?? {})))];
  const byTrack = {};

  for (const track of allTrackNames) {
    const trackProfiles = profiles
      .map(profile => profile.rhythm?.by_track?.[track])
      .filter(Boolean);

    if (trackProfiles.length === 0) continue;

    const avgHistogram = new Array(16).fill(0);
    for (const entry of trackProfiles) {
      (entry.onset_histogram_16 ?? []).forEach((value, index) => {
        avgHistogram[index] += value;
      });
    }

    byTrack[track] = {
      notes_per_bar: Math.round((trackProfiles.reduce((sum, entry) => sum + (entry.notes_per_bar ?? 0), 0) / trackProfiles.length) * 10) / 10,
      syncopation: Math.round((trackProfiles.reduce((sum, entry) => sum + (entry.syncopation ?? 0), 0) / trackProfiles.length) * 100) / 100,
      avg_duration: Math.round((trackProfiles.reduce((sum, entry) => sum + (entry.avg_duration ?? 0), 0) / trackProfiles.length) * 100) / 100,
      onset_histogram_16: avgHistogram.map(value => Math.round((value / trackProfiles.length) * 100) / 100),
      dominant_patterns_16: topCounts(trackProfiles.map(entry => entry.dominant_pattern_16), 6),
    };
  }

  const sectionDensities = profiles
    .flatMap(profile => profile.rhythm?.by_section ?? [])
    .map(entry => entry.notes_per_bar)
    .filter(value => typeof value === 'number');

  return {
    _meta: {
      sources: profiles.map(profile => profile._meta?.source).filter(Boolean),
      sets_analyzed: profiles.length,
      generated_at: new Date().toISOString(),
    },
    rhythm: {
      avg_section_density: sectionDensities.length
        ? Math.round((sectionDensities.reduce((sum, value) => sum + value, 0) / sectionDensities.length) * 10) / 10
        : 0,
      by_track: byTrack,
    },
  };
}

function activeTracksInSection(section) {
  return section.tracks
    .filter(track => (track.clip?.notes?.length ?? 0) > 0)
    .map(track => track.ableton_name)
    .sort();
}

function uniqueSorted(values) {
  return [...new Set(values.filter(Boolean))].sort();
}

function sectionPositionBucket(index, total) {
  if (total <= 1) return 'single';
  if (index === 0) return 'first';
  if (index === total - 1) return 'final';

  const ratio = index / (total - 1);
  if (ratio < 0.34) return 'early';
  if (ratio < 0.67) return 'middle';
  return 'late';
}

function densityHint(activeCount, totalCount) {
  if (totalCount <= 0 || activeCount <= 0) return 'empty';
  const ratio = activeCount / totalCount;
  if (ratio <= 0.25) return 'sparse';
  if (ratio <= 0.5) return 'restrained';
  if (ratio <= 0.75) return 'medium';
  return 'dense';
}

function sectionEnergy(section) {
  const noteCount = section.tracks.reduce((sum, track) => sum + (track.clip?.notes?.length ?? 0), 0);
  const bars = section.bars || 1;
  return Math.round((noteCount / bars) * 10) / 10;
}

export function analyzeArrangement(song, source = '') {
  const { sections } = song;
  const allTrackNames = [...new Set(sections.flatMap(section => section.tracks.map(track => track.ableton_name)))];
  const allRoles = uniqueSorted(allTrackNames.map(classifyTrackRole));
  const sectionLayers = sections.map((section, index) => {
    const activeTracks = activeTracksInSection(section);
    const activeRoles = uniqueSorted(activeTracks.map(classifyTrackRole));
    const inactiveRoles = allRoles.filter(role => !activeRoles.includes(role));
    const previousActiveRoles = index > 0
      ? uniqueSorted(activeTracksInSection(sections[index - 1]).map(classifyTrackRole))
      : [];
    return {
      section: section.name,
      section_index: index,
      position_bucket: sectionPositionBucket(index, sections.length),
      bars: section.bars,
      active_tracks: activeTracks,
      active_roles: activeRoles,
      inactive_roles: inactiveRoles,
      active_track_count: activeTracks.length,
      active_role_count: activeRoles.length,
      density_hint: densityHint(activeTracks.length, allTrackNames.length),
      energy: sectionEnergy(section),
      entered_roles: activeRoles.filter(role => !previousActiveRoles.includes(role)),
      exited_roles: previousActiveRoles.filter(role => !activeRoles.includes(role)),
    };
  });

  const entryOrder = {};
  for (const track of allTrackNames) {
    const firstIndex = sectionLayers.findIndex(section => section.active_tracks.includes(track));
    entryOrder[track] = firstIndex === -1 ? null : {
      first_section_index: firstIndex,
      first_section_name: sectionLayers[firstIndex]?.section || null,
    };
  }

  const layerCombos = topCounts(sectionLayers.map(section => section.active_tracks.join('|')), 10);
  const roleCombos = topCounts(sectionLayers.map(section => section.active_tracks.map(classifyTrackRole).sort().join('|')), 10);

  return {
    _meta: {
      source,
      sections_analyzed: sections.length,
      generated_at: new Date().toISOString(),
    },
    arrangement: {
      energy_curve: sectionLayers.map(section => ({
        section: section.section,
        energy: section.energy,
        active_track_count: section.active_track_count,
      })),
      by_section: sectionLayers,
      entry_order: entryOrder,
      top_layer_combinations: layerCombos,
      top_role_combinations: roleCombos,
    },
  };
}

export function aggregateArrangementProfiles(profiles) {
  if (profiles.length === 0) return null;

  const allTrackNames = [...new Set(profiles.flatMap(profile => Object.keys(profile.arrangement?.entry_order ?? {})))];
  const allRoles = uniqueSorted(profiles.flatMap(profile => {
    const roleCombos = profile.arrangement?.top_role_combinations ?? [];
    const comboRoles = roleCombos.flatMap(entry => String(entry.value || '').split('|'));
    const sectionRoles = (profile.arrangement?.by_section ?? []).flatMap(section => {
      if (Array.isArray(section.active_roles)) return section.active_roles;
      return (section.active_tracks ?? []).map(classifyTrackRole);
    });
    return [...comboRoles, ...sectionRoles];
  }));
  const entryOrder = {};

  for (const track of allTrackNames) {
    const entries = profiles
      .map(profile => profile.arrangement?.entry_order?.[track]?.first_section_index)
      .filter(value => typeof value === 'number');
    if (entries.length === 0) continue;
    entryOrder[track] = {
      avg_first_section_index: Math.round((entries.reduce((sum, value) => sum + value, 0) / entries.length) * 10) / 10,
    };
  }

  const energyPoints = profiles.flatMap(profile => profile.arrangement?.energy_curve ?? []);
  const activeCounts = energyPoints.map(point => point.active_track_count).filter(value => typeof value === 'number');
  const energies = energyPoints.map(point => point.energy).filter(value => typeof value === 'number');
  const combos = profiles.flatMap(profile =>
    (profile.arrangement?.top_layer_combinations ?? []).flatMap(entry => Array(entry.count).fill(entry.value))
  );
  const roleCombos = profiles.flatMap(profile =>
    (profile.arrangement?.top_role_combinations ?? []).flatMap(entry => Array(entry.count).fill(entry.value))
  );
  const sectionArchetypes = aggregateSectionArchetypes(profiles, allRoles);

  return {
    _meta: {
      sources: profiles.map(profile => profile._meta?.source).filter(Boolean),
      sets_analyzed: profiles.length,
      generated_at: new Date().toISOString(),
    },
    arrangement: {
      avg_active_tracks_per_section: activeCounts.length
        ? Math.round((activeCounts.reduce((sum, value) => sum + value, 0) / activeCounts.length) * 10) / 10
        : 0,
      avg_section_energy: energies.length
        ? Math.round((energies.reduce((sum, value) => sum + value, 0) / energies.length) * 10) / 10
        : 0,
      entry_order: entryOrder,
      top_layer_combinations: topCounts(combos, 12),
      top_role_combinations: topCounts(roleCombos, 12),
      section_archetypes: sectionArchetypes,
    },
  };
}

function aggregateSectionArchetypes(profiles, allRoles) {
  const buckets = new Map();

  for (const profile of profiles) {
    const sections = profile.arrangement?.by_section ?? [];
    sections.forEach((section, index) => {
      const bucket = section.position_bucket || sectionPositionBucket(index, sections.length);
      if (!buckets.has(bucket)) {
        buckets.set(bucket, {
          bucket,
          samples: 0,
          activeCounts: [],
          roleCounts: {},
          energies: [],
          roleCombos: [],
          densityHints: [],
        });
      }

      const target = buckets.get(bucket);
      const activeRoles = Array.isArray(section.active_roles)
        ? section.active_roles
        : uniqueSorted((section.active_tracks ?? []).map(classifyTrackRole));

      target.samples += 1;
      target.activeCounts.push(section.active_track_count ?? (section.active_tracks ?? []).length);
      if (typeof section.energy === 'number') target.energies.push(section.energy);
      if (section.density_hint) target.densityHints.push(section.density_hint);
      target.roleCombos.push(activeRoles.join('|'));
      for (const role of activeRoles) {
        target.roleCounts[role] = (target.roleCounts[role] || 0) + 1;
      }
    });
  }

  const bucketOrder = ['single', 'first', 'early', 'middle', 'late', 'final'];
  return [...buckets.values()]
    .sort((a, b) => bucketOrder.indexOf(a.bucket) - bucketOrder.indexOf(b.bucket))
    .map(bucket => {
      const activeRoleRatios = Object.fromEntries(
        allRoles.map(role => [role, Math.round(((bucket.roleCounts[role] || 0) / bucket.samples) * 100) / 100])
      );
      const commonActiveRoles = Object.entries(activeRoleRatios)
        .filter(([, ratio]) => ratio >= 0.5)
        .sort((a, b) => b[1] - a[1])
        .map(([role]) => role);
      const commonInactiveRoles = Object.entries(activeRoleRatios)
        .filter(([, ratio]) => ratio <= 0.25)
        .sort((a, b) => a[1] - b[1])
        .map(([role]) => role);

      return {
        bucket: bucket.bucket,
        samples: bucket.samples,
        avg_active_tracks: bucket.activeCounts.length
          ? Math.round((bucket.activeCounts.reduce((sum, value) => sum + value, 0) / bucket.activeCounts.length) * 10) / 10
          : 0,
        avg_energy: bucket.energies.length
          ? Math.round((bucket.energies.reduce((sum, value) => sum + value, 0) / bucket.energies.length) * 10) / 10
          : 0,
        common_active_roles: commonActiveRoles,
        common_inactive_roles: commonInactiveRoles,
        role_presence: activeRoleRatios,
        dominant_density_hints: topCounts(bucket.densityHints, 3),
        top_role_combinations: topCounts(bucket.roleCombos, 5),
      };
    });
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
  const rolePresenceAcc = {};
  for (const name of trackNames) {
    const active = sections.filter(s =>
      s.tracks.some(t => t.ableton_name === name && t.clip?.notes?.length > 0)
    ).length;
    trackPresence[name] = Math.round((active / sections.length) * 100) / 100;
    const role = classifyTrackRole(name);
    rolePresenceAcc[role] = Math.max(rolePresenceAcc[role] || 0, trackPresence[name]);
  }

  // ── Rhythm ───────────────────────────────────────────────────────────────
  const notesPerBarByTrack = {};
  const notesPerBarByRole = {};
  const notesPerBarRoleCounts = {};
  for (const [name, notes] of allNotesByTrack) {
    const totalBarsForTrack = sections.reduce((sum, s) => {
      const track = s.tracks.find(t => t.ableton_name === name);
      return sum + (track?.clip?.length_bars ?? 0);
    }, 0);
    notesPerBarByTrack[name] = totalBarsForTrack > 0
      ? Math.round((notes.length / totalBarsForTrack) * 10) / 10
      : 0;
    const role = classifyTrackRole(name);
    notesPerBarByRole[role] = (notesPerBarByRole[role] || 0) + notesPerBarByTrack[name];
    notesPerBarRoleCounts[role] = (notesPerBarRoleCounts[role] || 0) + 1;
  }
  for (const role of Object.keys(notesPerBarByRole)) {
    notesPerBarByRole[role] = Math.round((notesPerBarByRole[role] / notesPerBarRoleCounts[role]) * 10) / 10;
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
      role_presence: rolePresenceAcc,
    },
    rhythm: {
      notes_per_bar:    notesPerBarByTrack,
      notes_per_bar_by_role: notesPerBarByRole,
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
  const rolePresence = {};
  for (const name of allTrackNames) {
    const vals = profiles.map(p => p.arrangement?.track_presence?.[name] ?? 0);
    avgPresence[name] = Math.round((vals.reduce((a, b) => a + b, 0) / vals.length) * 100) / 100;
  }
  const allRoles = [...new Set(profiles.flatMap(p => Object.keys(p.arrangement?.role_presence ?? {})))];
  for (const role of allRoles) {
    const vals = profiles.map(p => p.arrangement?.role_presence?.[role] ?? 0);
    rolePresence[role] = Math.round((vals.reduce((a, b) => a + b, 0) / vals.length) * 100) / 100;
  }

  // Rhythm: avg notes per bar per track
  const avgNotesPerBar = {};
  const avgNotesPerBarByRole = {};
  for (const name of allTrackNames) {
    const vals = profiles.map(p => p.rhythm?.notes_per_bar?.[name]).filter(v => v !== undefined);
    if (vals.length)
      avgNotesPerBar[name] = Math.round((vals.reduce((a, b) => a + b, 0) / vals.length) * 10) / 10;
  }
  for (const role of allRoles) {
    const vals = profiles.map(p => p.rhythm?.notes_per_bar_by_role?.[role]).filter(v => v !== undefined);
    if (vals.length)
      avgNotesPerBarByRole[role] = Math.round((vals.reduce((a, b) => a + b, 0) / vals.length) * 10) / 10;
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
      role_presence:  rolePresence,
    },
    rhythm: {
      notes_per_bar: avgNotesPerBar,
      notes_per_bar_by_role: avgNotesPerBarByRole,
    },
  };
}

// ── Profile comparison ────────────────────────────────────────────────────────

/**
 * Compare a source profile against a generated profile.
 * Returns a structured diff with per-dimension scores and an overall fidelity %.
 *
 * @param {object} source    - Reference style profile (from analyze)
 * @param {object} generated - Profile of the generated set (from analyze)
 * @returns {object} comparison report
 */
export function compareProfiles(source, generated) {
  const report = {};
  const aggregateSource = isAggregateComparable(source);

  report.context = {
    source_kind: source._meta?.compare_source_kind || (aggregateSource ? 'aggregate' : 'single'),
    aggregate_source: aggregateSource,
  };

  // ── Key ──────────────────────────────────────────────────────────────────
  report.key = {
    source:    source.key,
    generated: generated.key,
    match:     source.key === generated.key,
    mode_match: source.key?.split(' ')[1] === generated.key?.split(' ')[1],
  };

  // ── BPM ──────────────────────────────────────────────────────────────────
  report.bpm = {
    source:    source.bpm,
    generated: generated.bpm,
    delta:     source.bpm != null && generated.bpm != null
      ? generated.bpm - source.bpm
      : null,
    in_range: source.bpm_range && generated.bpm != null
      ? generated.bpm >= source.bpm_range.min && generated.bpm <= source.bpm_range.max
      : null,
  };

  // ── Structure ────────────────────────────────────────────────────────────
  report.structure = {
    section_count: compareNumericTarget({
      source: source.structure?.section_count,
      generated: generated.structure?.section_count,
      range: source.structure?.section_count_range,
      tolerance: aggregateSource ? 1 : 0,
    }),
    bars_per_section: compareNumericTarget({
      source: source.structure?.bars_per_section ?? source.structure?.bars_per_section_avg,
      generated: generated.structure?.bars_per_section,
      tolerance: aggregateSource ? 2 : 1,
    }),
  };

  // ── Track presence ───────────────────────────────────────────────────────
  const srcPresence = source.arrangement?.track_presence  ?? {};
  const genPresence = generated.arrangement?.track_presence ?? {};
  const sharedTracks = aggregateSource
    ? Object.keys(srcPresence).filter(t => t in genPresence)
    : Object.keys(srcPresence).filter(t => t in genPresence);
  const srcRolePresence = source.arrangement?.role_presence ?? {};
  const genRolePresence = generated.arrangement?.role_presence ?? {};
  const sharedRoles = [...new Set([...Object.keys(srcRolePresence), ...Object.keys(genRolePresence)])];

  report.track_presence = {};
  for (const t of sharedTracks) {
    const diff = Math.round((genPresence[t] - srcPresence[t]) * 100);
    report.track_presence[t] = {
      source: Math.round(srcPresence[t] * 100),
      generated: Math.round(genPresence[t] * 100),
      delta: diff,
    };
  }
  report.role_presence = {};
  for (const role of sharedRoles) {
    const srcRatio = srcRolePresence[role] ?? 0;
    const genRatio = genRolePresence[role] ?? 0;
    const diff = Math.round((genRatio - srcRatio) * 100);
    report.role_presence[role] = {
      source: Math.round(srcRatio * 100),
      generated: Math.round(genRatio * 100),
      delta: diff,
      score: scorePresenceDelta(diff),
    };
  }

  // ── Rhythm density ───────────────────────────────────────────────────────
  const srcNpb = source.rhythm?.notes_per_bar    ?? {};
  const genNpb = generated.rhythm?.notes_per_bar ?? {};
  const rhythmTracks = Object.keys(srcNpb).filter(t => t in genNpb);
  const srcRoleNpb = source.rhythm?.notes_per_bar_by_role ?? {};
  const genRoleNpb = generated.rhythm?.notes_per_bar_by_role ?? {};
  const rhythmRoles = [...new Set([...Object.keys(srcRoleNpb), ...Object.keys(genRoleNpb)])];

  report.rhythm = {};
  for (const t of rhythmTracks) {
    const ratio = srcNpb[t] > 0 ? genNpb[t] / srcNpb[t] : null;
    report.rhythm[t] = {
      source:    srcNpb[t],
      generated: genNpb[t],
      ratio:     Number.isFinite(ratio) ? Math.round(ratio * 100) / 100 : null,
    };
  }
  report.rhythm_roles = {};
  for (const role of rhythmRoles) {
    const src = srcRoleNpb[role] ?? 0;
    const gen = genRoleNpb[role] ?? 0;
    const ratio = src > 0 ? gen / src : gen > 0 ? Infinity : null;
    report.rhythm_roles[role] = {
      source: src,
      generated: gen,
      ratio: Number.isFinite(ratio) ? Math.round(ratio * 100) / 100 : null,
      score: scoreRatio(ratio),
    };
  }

  // ── Pitch ranges ─────────────────────────────────────────────────────────
  const srcPitch = source.pitch?.by_track    ?? {};
  const genPitch = generated.pitch?.by_track ?? {};
  const pitchTracks = Object.keys(srcPitch).filter(t => t in genPitch);

  report.pitch = {};
  for (const t of pitchTracks) {
    const s = srcPitch[t];
    const g = genPitch[t];
    const overlapLo  = Math.max(s.min, g.min);
    const overlapHi  = Math.min(s.max, g.max);
    const srcRange   = s.max - s.min || 1;
    const overlapPct = overlapHi >= overlapLo
      ? Math.round(((overlapHi - overlapLo) / srcRange) * 100)
      : 0;
    report.pitch[t] = {
      source:      { min: s.min, max: s.max },
      generated:   { min: g.min, max: g.max },
      overlap_pct: overlapPct,
    };
  }

  // ── Chord vocabulary ─────────────────────────────────────────────────────
  const srcChords = source.pitch?.chords_by_track    ?? {};
  const genChords = generated.pitch?.chords_by_track ?? {};
  const chordTracks = Object.keys(srcChords).filter(t => t in genChords);

  report.chords = {};
  for (const t of chordTracks) {
    const srcSet = new Set(srcChords[t].map(c => c.chord));
    const genSet = new Set(genChords[t].map(c => c.chord));
    const common = [...srcSet].filter(c => genSet.has(c));
    report.chords[t] = {
      source_top:    [...srcSet].slice(0, 5),
      generated_top: [...genSet].slice(0, 5),
      common,
      overlap_pct: srcSet.size > 0 ? Math.round((common.length / srcSet.size) * 100) : 0,
    };
  }

  // ── Overall fidelity score ────────────────────────────────────────────────
  const scores = [];

  const keyScore = report.key.match ? 100 : report.key.mode_match ? (aggregateSource ? 65 : 50) : 0;
  scores.push({ name: 'key', weight: aggregateSource ? 0.15 : 0.25, score: keyScore });

  if (report.bpm.source != null && report.bpm.generated != null) {
    scores.push({ name: 'bpm', weight: 0.10, score: scoreBpm(report.bpm, aggregateSource) });
  }

  const structureScores = [report.structure.section_count.score, report.structure.bars_per_section.score]
    .filter(Number.isFinite);
  if (structureScores.length > 0) {
    const avg = structureScores.reduce((sum, score) => sum + score, 0) / structureScores.length;
    scores.push({ name: 'structure', weight: aggregateSource ? 0.15 : 0.10, score: Math.round(avg) });
  }

  if (sharedRoles.length > 0) {
    const avg = sharedRoles.reduce((sum, role) => sum + report.role_presence[role].score, 0) / sharedRoles.length;
    scores.push({ name: 'role_presence', weight: aggregateSource ? 0.25 : 0.15, score: Math.round(avg) });
  }

  if (rhythmTracks.length > 0 || rhythmRoles.length > 0) {
    const rhythmTrackScores = rhythmTracks.map(t => scoreRatio(report.rhythm[t].ratio));
    const rhythmRoleScores = rhythmRoles.map(role => report.rhythm_roles[role].score);
    if (rhythmRoleScores.length > 0) {
      const avg = rhythmRoleScores.reduce((sum, score) => sum + score, 0) / rhythmRoleScores.length;
      scores.push({ name: 'rhythm_roles', weight: aggregateSource ? 0.20 : 0.15, score: Math.round(avg) });
    } else if (rhythmTrackScores.length > 0) {
      const avg = rhythmTrackScores.reduce((sum, score) => sum + score, 0) / rhythmTrackScores.length;
      scores.push({ name: 'rhythm_tracks', weight: 0.15, score: Math.round(avg) });
    }
  }

  // Pitch range overlap: average across tracks
  if (pitchTracks.length > 0) {
    const avg = pitchTracks.reduce((s, t) => s + report.pitch[t].overlap_pct, 0) / pitchTracks.length;
    scores.push({ name: 'pitch_range', weight: aggregateSource ? 0.05 : 0.15, score: avg });
  }

  // Chord overlap: average across tracks
  if (chordTracks.length > 0) {
    const avg = chordTracks.reduce((s, t) => s + report.chords[t].overlap_pct, 0) / chordTracks.length;
    scores.push({ name: 'chords', weight: aggregateSource ? 0.10 : 0.15, score: avg });
  }

  const totalWeight = scores.reduce((s, x) => s + x.weight, 0);
  const fidelity    = totalWeight > 0
    ? Math.round(scores.reduce((s, x) => s + x.score * x.weight, 0) / totalWeight)
    : 0;

  report.fidelity_score = fidelity;
  report.component_scores = scores.map(item => ({ ...item, score: Math.round(item.score) }));
  return report;
}

function isAggregateComparable(profile) {
  return Boolean(
    profile?._meta?.compare_source_kind === 'aggregate' ||
    profile?.bpm_range ||
    profile?.key_consensus ||
    profile?.mode_consensus ||
    profile?.structure?.section_count_range ||
    profile?._meta?.sets_analyzed ||
    ['album', 'artist', 'collection'].includes(profile?._meta?.scope)
  );
}

function compareNumericTarget({ source, generated, range = null, tolerance = 0 }) {
  const sourceLabel = range
    ? `${range.min}-${range.max} (avg ${range.avg})`
    : source ?? 'unknown';

  if (generated == null || (source == null && !range)) {
    return { source, source_label: sourceLabel, generated, delta: null, in_range: null, score: 0 };
  }

  if (range) {
    const inRange = generated >= range.min && generated <= range.max;
    const distance = inRange ? 0 : Math.min(Math.abs(generated - range.min), Math.abs(generated - range.max));
    return {
      source: range.avg,
      source_label: sourceLabel,
      generated,
      delta: generated - range.avg,
      in_range: inRange,
      score: inRange ? 100 : Math.max(0, 100 - distance * 25),
    };
  }

  const delta = generated - source;
  const distance = Math.max(0, Math.abs(delta) - tolerance);
  return {
    source,
    source_label: sourceLabel,
    generated,
    delta,
    in_range: Math.abs(delta) <= tolerance,
    score: Math.max(0, 100 - distance * 25),
  };
}

function scorePresenceDelta(deltaPct) {
  return Math.max(0, 100 - Math.abs(deltaPct) * 1.5);
}

function scoreRatio(ratio) {
  if (ratio == null || !Number.isFinite(ratio) || ratio <= 0) return 0;
  return Math.round(Math.min(ratio, 1 / ratio, 1) * 100);
}

function scoreBpm(bpm, aggregateSource) {
  if (bpm.in_range === true) return 100;
  if (bpm.delta == null) return 0;
  const tolerance = aggregateSource ? 5 : 2;
  const distance = Math.max(0, Math.abs(bpm.delta) - tolerance);
  return Math.max(0, 100 - distance * 5);
}
