/**
 * Higher-level ableton-js wrapper.
 *
 * ableton-js (v4.x) communicates with Ableton Live via a Python MIDI Remote Script
 * over UDP. The script must be installed at:
 *   ~/Music/Ableton/User Library/Remote Scripts/AbletonJS/
 * and activated in Live → Preferences → Link, Tempo & MIDI → Control Surfaces.
 *
 * NOTE: v4.x requires an explicit `start()` call. The library now uses random
 * client/server ports coordinated through temp port files, so connect() is the
 * place where we establish and wait for the Live handshake.
 */

import { Ableton } from 'ableton-js';

let _instance = null;
let _startPromise = null;

export function getAbleton() {
  if (!_instance) {
    _instance = new Ableton({ logger: process.env.DEBUG ? console : undefined });
  }
  return _instance;
}

/**
 * Wait for Ableton to be reachable and return the instance.
 * In ableton-js v4.x the connection is started explicitly.
 */
export async function connect() {
  const ableton = getAbleton();

  if (ableton.isConnected()) return ableton;

  if (!_startPromise) {
    _startPromise = withTimeout(ableton.start(), 10_000, 'Connection timed out.')
      .catch(async err => {
        await ableton.close().catch(() => {});
        _instance = null;
        throw new Error(
          'Timed out waiting for Ableton Live.\n' +
          'Make sure Live is open and AbletonJS is set as a Control Surface in Preferences → Link, Tempo & MIDI.\n' +
          `Underlying ableton-js error: ${normalizeErrorMessage(err)}`
        );
      })
      .finally(() => {
        _startPromise = null;
      });
  }

  await _startPromise;

  return ableton;
}

/**
 * Disconnect from Ableton.
 */
export async function disconnect() {
  if (_instance) {
    await _instance.close();
    _instance = null;
    _startPromise = null;
  }
}

/**
 * Prepare a Live set for a push: create any missing MIDI tracks (by name)
 * and add scenes until the set has at least `requiredSceneCount`.
 *
 * @param {string[]} requiredTrackNames  - Ordered list of track names needed
 * @param {number}   requiredSceneCount  - Minimum number of scenes needed
 * @returns {Promise<{tracks: string[], scenes: number[]}>} What was created
 */
export async function setupLiveSet(requiredTrackNames, requiredSceneCount) {
  const ableton = getAbleton();
  const created = { tracks: [], scenes: [] };

  // ── Tracks ──────────────────────────────────────────────────────────────────
  const existing = await getMidiTracks(ableton);
  const existingNames = new Set(existing.map(t => t.name));

  for (const name of requiredTrackNames) {
    if (existingNames.has(name)) continue;

    // Create at end (-1) and rename immediately
    await ableton.song.createMidiTrack(-1);
    const allTracks = await ableton.song.get('tracks');
    const newTrack = allTracks[allTracks.length - 1];
    await newTrack.set('name', name);

    created.tracks.push(name);
    existingNames.add(name);
  }

  // ── Scenes ──────────────────────────────────────────────────────────────────
  const scenes = await ableton.song.get('scenes');

  for (let i = scenes.length; i < requiredSceneCount; i++) {
    await ableton.song.createScene(-1);
    created.scenes.push(i);
  }

  return created;
}

/**
 * Prepare a Live set for stem workflows: create any missing audio tracks by
 * name and apply colors when provided.
 *
 * @param {{name: string, color?: string|null}[]} requiredTracks
 * @returns {Promise<{tracks: string[], reused: string[], colored: string[]}>}
 */
export async function setupAudioTracks(requiredTracks) {
  const ableton = getAbleton();
  const created = [];
  const reused = [];
  const colored = [];

  const existing = await getTracks(ableton);
  const existingByName = new Map(existing.map(t => [t.name, t]));

  for (const def of requiredTracks) {
    let found = existingByName.get(def.name);

    if (!found) {
      await ableton.song.createAudioTrack(-1);
      const allTracks = await getTracks(ableton);
      found = allTracks[allTracks.length - 1];
      await found.track.set('name', def.name);
      created.push(def.name);
      existingByName.set(def.name, found);
    } else {
      reused.push(def.name);
    }

    if (def.color) {
      const resolvedColor = normalizeAbletonColor(def.color);
      if (resolvedColor) {
        try {
          await found.track.set('color', resolvedColor);
          colored.push(def.name);
        } catch {
          // Non-fatal: some Live/device states may reject color changes
        }
      }
    }
  }

  return { tracks: created, reused, colored };
}

/**
 * Get all normal tracks with their names.
 * Returns an array of { index, name, track } objects.
 */
export async function getTracks(ableton) {
  const tracks = await ableton.song.get('tracks');
  const result = [];

  for (let i = 0; i < tracks.length; i++) {
    const track = tracks[i];
    try {
      const name = await track.get('name');
      result.push({ index: i, name, track });
    } catch {
      // Skip problematic tracks
    }
  }

  return result;
}

/**
 * Get all MIDI tracks with their names.
 * Returns an array of { index, name, track } objects.
 */
export async function getMidiTracks(ableton) {
  return getTracks(ableton);
}

/**
 * Get a track by its name (case-sensitive).
 * Returns null if not found.
 */
export async function getTrackByName(ableton, name) {
  const tracks = await getMidiTracks(ableton);
  return tracks.find(t => t.name === name) ?? null;
}

/**
 * Push a single clip definition onto a track at a given slot index.
 *
 * @param {object} track       - ableton-js track object
 * @param {number} slotIndex   - Clip slot (scene) index
 * @param {object} clipDef     - { length_bars, notes: [{pitch, time, duration, velocity, muted}] }
 * @param {object} [opts]
 * @param {boolean} [opts.overwrite=false]      - Delete existing clip before creating
 * @param {string}  [opts.timeSignature='4/4']  - For beats-per-bar calculation
 * @param {string}  [opts.clipName]             - Name to assign to the created clip
 */
export async function pushClip(track, slotIndex, clipDef, opts = {}) {
  const { overwrite = false, timeSignature = '4/4', clipName } = opts;
  const beatsPerBar = parseBeatsPerBar(timeSignature);
  const lengthBeats = clipDef.length_bars * beatsPerBar;

  const clipSlots = await track.get('clip_slots');

  if (!clipSlots[slotIndex]) {
    throw new Error(`Track has no clip slot at index ${slotIndex}`);
  }

  const slot = clipSlots[slotIndex];

  // Check if a clip already exists in this slot
  const hasClip = await slot.get('has_clip');

  if (hasClip) {
    if (!overwrite) {
      throw new Error(
        `Slot ${slotIndex} already has a clip. Use --overwrite to replace it.`
      );
    }
    await slot.deleteClip();
  }

  // Create a new clip with the specified length
  await slot.createClip(lengthBeats);

  // Get the newly created clip
  const clip = await slot.get('clip');

  // Set clip name if provided
  if (clipName) {
    await clip.set('name', clipName);
  }

  // Map our notes to ableton-js format
  const notes = clipDef.notes.map(n => ({
    pitch:    n.pitch,
    time:     n.time,
    duration: n.duration,
    velocity: n.velocity,
    muted:    n.muted ?? false,
  }));

  // ableton-js clip.setNotes replaces/adds notes in the clip
  await clip.setNotes(notes);
}

function withTimeout(promise, timeoutMs, message) {
  return Promise.race([
    promise,
    new Promise((_, reject) => setTimeout(() => reject(new Error(message)), timeoutMs)),
  ]);
}

function normalizeErrorMessage(err) {
  if (!err) return 'unknown error';
  if (typeof err === 'string') return err;
  if (err instanceof Error) return err.message || err.name;
  return String(err);
}

/**
 * Push a full AbletonSong JSON into the current Live set.
 * Each section maps to a scene index.
 *
 * @param {object} song      - Parsed AbletonSong
 * @param {object} [opts]
 * @param {boolean} [opts.overwrite] - Replace existing clips
 * @param {boolean} [opts.dryRun]    - Log what would happen without writing
 * @param {Function} [opts.onProgress] - Called with (message) for each step
 * @returns {Promise<{pushed: number, skipped: string[], errors: string[]}>}
 */
export async function pushSong(song, opts = {}) {
  const { overwrite = false, dryRun = false, onProgress = () => {} } = opts;
  const ableton = getAbleton();
  const timeSignature = song.meta.time_signature || '4/4';

  let pushed = 0;
  const skipped = [];
  const errors = [];

  // Cache scenes list once — used to name each scene row
  let scenes = null;
  try {
    scenes = await ableton.song.get('scenes');
  } catch {
    // Non-fatal: scene naming will be skipped if unavailable
  }

  for (let sectionIndex = 0; sectionIndex < song.sections.length; sectionIndex++) {
    const section = song.sections[sectionIndex];
    onProgress(`Section [${sectionIndex}] "${section.name}"`);

    if (!dryRun && scenes && scenes[sectionIndex]) {
      try {
        await scenes[sectionIndex].set('name', section.name);
      } catch {
        // Non-fatal: continue even if scene naming fails
      }
    }

    for (const trackDef of section.tracks) {
      const label = `  ${trackDef.ableton_name} → slot ${sectionIndex}`;

      if (dryRun) {
        onProgress(`${label} [dry-run, ${trackDef.clip.notes.length} notes]`);
        pushed++;
        continue;
      }

      try {
        const found = await getTrackByName(ableton, trackDef.ableton_name);

        if (!found) {
          const msg = `Track "${trackDef.ableton_name}" not found in Live set`;
          errors.push(msg);
          onProgress(`  ✗ ${msg}`);
          continue;
        }

        const clipName = trackDef.clip?.name || `${section.name} — ${trackDef.ableton_name}`;
        await pushClip(found.track, sectionIndex, trackDef.clip, { overwrite, timeSignature, clipName });
        onProgress(`${label} ✓ (${trackDef.clip.notes.length} notes)`);
        pushed++;
      } catch (err) {
        const msg = `${trackDef.ableton_name}: ${err.message}`;
        errors.push(msg);
        onProgress(`  ✗ ${msg}`);
      }
    }
  }

  return { pushed, skipped, errors };
}

// ─── helpers ────────────────────────────────────────────────────────────────

function parseBeatsPerBar(timeSignature) {
  const [numerator] = timeSignature.split('/').map(Number);
  return numerator ?? 4;
}

function normalizeAbletonColor(color) {
  if (typeof color !== 'string') return null;
  const named = ABLETON_NAMED_COLORS[color.toLowerCase()];
  if (named) return named;
  if (/^#?[0-9a-f]{6}$/i.test(color)) {
    return color.startsWith('#') ? color : `#${color}`;
  }
  return null;
}

const ABLETON_NAMED_COLORS = {
  red: '#ff5a5a',
  blue: '#4f83ff',
  purple: '#a66bff',
  green: '#58c46b',
  yellow: '#ffd24d',
  gray: '#8a8a8a',
  grey: '#8a8a8a',
};
