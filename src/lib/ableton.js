/**
 * Higher-level ableton-js wrapper.
 *
 * ableton-js communicates with Live via a Max for Live companion patch.
 * The M4L patch must be open in your Live set (on any track — a dedicated
 * "Composer Bridge" MIDI track works well).
 *
 * Install the M4L patch from node_modules/ableton-js/ableton/midi-script/
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
 * Connect and return the Ableton instance.
 */
export async function connect() {
  const ableton = getAbleton();
  await ableton.start();
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
 * @param {boolean} [opts.overwrite=false] - Delete existing clip before creating
 * @param {string} [opts.timeSignature='4/4'] - For beats-per-bar calculation
 */
export async function pushClip(track, slotIndex, clipDef, opts = {}) {
  const { overwrite = false, timeSignature = '4/4' } = opts;
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

  // Map our notes to ableton-js format
  const notes = clipDef.notes.map(n => ({
    pitch:    n.pitch,
    time:     n.time,
    duration: n.duration,
    velocity: n.velocity,
    muted:    n.muted ?? false,
  }));

  await clip.addNewNotes(notes);
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

  for (let sectionIndex = 0; sectionIndex < song.sections.length; sectionIndex++) {
    const section = song.sections[sectionIndex];
    onProgress(`Section [${sectionIndex}] "${section.name}"`);

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

        await pushClip(found.track, sectionIndex, trackDef.clip, { overwrite, timeSignature });
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
