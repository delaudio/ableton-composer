/**
 * Higher-level ableton-js wrapper.
 *
 * ableton-js (v2.x) communicates with Ableton Live via a Python MIDI Remote Script
 * over UDP. The script must be installed at:
 *   ~/Music/Ableton/User Library/Remote Scripts/AbletonJS/
 * and activated in Live → Preferences → Link, Tempo & MIDI → Control Surfaces.
 *
 * NOTE: v2.x has no start() method — the UDP socket and heartbeat start in the
 * constructor automatically. connect() waits for the first successful handshake.
 */

import { Ableton } from 'ableton-js';

let _instance = null;

export function getAbleton() {
  if (!_instance) {
    _instance = new Ableton({ logger: process.env.DEBUG ? console : undefined });
  }
  return _instance;
}

/**
 * Wait for Ableton to be reachable and return the instance.
 * The connection is established automatically on construction;
 * this function just waits until the heartbeat confirms Live is responding.
 */
export async function connect() {
  const ableton = getAbleton();

  if (ableton.isConnected()) return ableton;

  await new Promise((resolve, reject) => {
    const timeout = setTimeout(() => {
      reject(new Error(
        'Timed out waiting for Ableton Live.\n' +
        'Make sure Live is open and AbletonJS is set as a Control Surface in Preferences → Link, Tempo & MIDI.'
      ));
    }, 10_000);

    ableton.once('connect', () => {
      clearTimeout(timeout);
      resolve();
    });

    // Handle the race condition where it connected between isConnected() check and once()
    if (ableton.isConnected()) {
      clearTimeout(timeout);
      resolve();
    }
  });

  return ableton;
}

/**
 * Disconnect from Ableton.
 */
export async function disconnect() {
  if (_instance) {
    await _instance.close();
    _instance = null;
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
 * Get all MIDI tracks with their names.
 * Returns an array of { index, name, track } objects.
 */
export async function getMidiTracks(ableton) {
  const tracks = await ableton.song.get('tracks');
  const result = [];

  for (let i = 0; i < tracks.length; i++) {
    const track = tracks[i];
    try {
      const name = await track.get('name');
      // Filter to MIDI tracks only (they have clip_slots with MIDI capability)
      // We try getting clip_slots; audio tracks will still return them but addNewNotes will fail
      result.push({ index: i, name, track });
    } catch {
      // Skip problematic tracks
    }
  }

  return result;
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

  // v2.x API: setNotes replaces/adds notes in the clip
  await clip.setNotes(notes);
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
