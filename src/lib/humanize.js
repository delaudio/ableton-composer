/**
 * Note humanization — applies swing, micro-timing, and velocity variation
 * to MIDI notes to add a more natural or stylistic feel.
 *
 * All transforms are applied to a copy of the note array; originals are not mutated.
 */

// ── Profiles ──────────────────────────────────────────────────────────────────

export const HUMANIZE_PROFILES = {
  tight: {
    description: 'Studio — barely noticeable imperfections',
    swing:    0,
    timing:   0.010,   // ±beats random offset per note
    velocity: 0.07,    // ±fraction of original velocity
  },
  loose: {
    description: 'Natural — like a good live drummer',
    swing:    0,
    timing:   0.025,
    velocity: 0.14,
  },
  swing: {
    description: 'MPC light swing — 16th off-beats pushed forward ~57%',
    swing:    0.57,
    timing:   0.010,
    velocity: 0.10,
  },
  'swing-heavy': {
    description: 'Triplet swing — 16th off-beats at ~65%',
    swing:    0.65,
    timing:   0.015,
    velocity: 0.12,
  },
  vinyl: {
    description: 'Warm vinyl — subtle swing with timing drift',
    swing:    0.54,
    timing:   0.020,
    velocity: 0.12,
  },
  idm: {
    description: 'Glitchy IDM — strong irregular timing and velocity variation',
    swing:    0,
    timing:   0.040,
    velocity: 0.22,
  },
};

// ── Core transform ────────────────────────────────────────────────────────────

/**
 * Apply humanization to an array of notes.
 *
 * @param {object[]} notes      - Note array from a clip (not mutated)
 * @param {string|object} spec  - Profile name (e.g. "swing") or custom params object
 * @param {number} lengthBars   - Clip length in bars (used to clamp note times)
 * @param {number} beatsPerBar  - Beats per bar (default 4)
 * @returns {object[]}          - New note array with humanized times/velocities
 */
export function applyHumanize(notes, spec, lengthBars = 4, beatsPerBar = 4) {
  const params = resolveParams(spec);
  if (!params) return notes;

  const clipLength = lengthBars * beatsPerBar;

  return notes.map(note => {
    let time     = note.time;
    let velocity = note.velocity;

    // ── Swing ────────────────────────────────────────────────────────────────
    // Detect 16th-note off-beats (positions where time % 0.5 ≈ 0.25)
    // and shift them forward by (swingRatio - 0.5) * 0.5 beats.
    if (params.swing > 0) {
      const posInHalfBeat = time % 0.5;
      if (Math.abs(posInHalfBeat - 0.25) < 0.06) {
        const shift = (params.swing - 0.5) * 0.5;
        time = time + shift;
      }
    }

    // ── Random timing nudge ─────────────────────────────────────────────────��
    if (params.timing > 0) {
      time = time + (Math.random() * 2 - 1) * params.timing;
    }

    // Clamp time: must be >= 0 and < clip length
    time = Math.max(0, Math.min(clipLength - 0.01, time));
    time = Math.round(time * 10000) / 10000;

    // ── Velocity variation ───────────────────────────────────────────────────
    if (params.velocity > 0) {
      const delta = (Math.random() * 2 - 1) * params.velocity * note.velocity;
      velocity = Math.round(Math.max(1, Math.min(127, note.velocity + delta)));
    }

    return { ...note, time, velocity };
  });
}

// ── Param resolution ──────────────────────────────────────────────────────────

/**
 * Resolve a spec to a params object.
 * - string  → look up in HUMANIZE_PROFILES
 * - object  → merge with defaults
 * - null/undefined → returns null (no-op)
 */
export function resolveParams(spec) {
  if (!spec) return null;

  if (typeof spec === 'string') {
    const profile = HUMANIZE_PROFILES[spec];
    if (!profile) throw new Error(`Unknown humanize profile: "${spec}". Available: ${Object.keys(HUMANIZE_PROFILES).join(', ')}`);
    return profile;
  }

  if (typeof spec === 'object') {
    return {
      swing:    spec.swing    ?? 0,
      timing:   spec.timing   ?? 0,
      velocity: spec.velocity ?? 0,
    };
  }

  return null;
}

// ── Apply to a full song ──────────────────────────────────────────────────────

/**
 * Deep-clone a song and apply humanization to every clip.
 * Drum tracks are excluded from swing (timing and velocity still apply).
 *
 * @param {object}        song        - AbletonSong object
 * @param {string|object} spec        - Profile name or params
 * @param {number}        beatsPerBar
 * @returns {object} New song with humanized notes
 */
export function humanizeSong(song, spec, beatsPerBar = 4) {
  const params = resolveParams(spec);
  if (!params) return song;

  return {
    ...song,
    sections: song.sections.map(section => ({
      ...section,
      tracks: section.tracks.map(track => {
        if (!track.clip?.notes?.length) return track;

        // Drums: skip swing, keep timing + velocity humanization
        const trackParams = isDrumTrack(track.ableton_name)
          ? { ...params, swing: 0 }
          : params;

        return {
          ...track,
          clip: {
            ...track.clip,
            notes: applyHumanize(
              track.clip.notes,
              trackParams,
              track.clip.length_bars ?? section.bars,
              beatsPerBar,
            ),
          },
        };
      }),
    })),
  };
}

// ── Helpers ───────────────────────────────────────────────────────────────────

const DRUM_TRACK_NAMES = /^(drums?|dr|kick|snare|perc|percussion|hh|hihat|hi.hat)$/i;

function isDrumTrack(name) {
  return DRUM_TRACK_NAMES.test((name ?? '').trim());
}
