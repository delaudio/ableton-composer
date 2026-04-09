import { readFile } from 'fs/promises';
import { join } from 'path';
import { loadSong } from './storage.js';
import { analyzeSong } from './analysis.js';
import { loadStyleProfile } from './profiles.js';

export async function loadComparableProfile(target) {
  const abs = target.startsWith('/') ? target : join(process.cwd(), target);

  if (target.endsWith('.json')) {
    try {
      const raw = await readFile(abs, 'utf-8');
      const parsed = JSON.parse(raw);

      if (parsed?.type === 'profile-bundle') {
        const loaded = await loadStyleProfile(abs);
        return normalizeComparableProfile(loaded.profile);
      }

      if (parsed?.meta && Array.isArray(parsed.sections)) {
        return analyzeSong(parsed, abs);
      }

      if (parsed._meta || parsed.bpm_range || parsed.key_consensus || parsed.arrangement || parsed.rhythm) {
        return normalizeComparableProfile(parsed);
      }
    } catch {}
  }

  const { song, filepath } = await loadSong(target);
  return analyzeSong(song, filepath);
}

export function normalizeComparableProfile(profile) {
  if (profile?.bpm != null && profile?.key && profile?.arrangement?.track_presence) {
    return profile;
  }

  const rhythmByTrack = profile?.rhythm?.notes_per_bar
    ? profile.rhythm.notes_per_bar
    : Object.fromEntries(
      Object.entries(profile?.rhythm?.by_track ?? {}).map(([name, info]) => [name, info.notes_per_bar])
    );

  const pitchByTrack = profile?.pitch?.by_track ?? {};
  const chordsByTrack = profile?.pitch?.chords_by_track ?? {};

  return {
    _meta: {
      ...(profile._meta ?? {}),
      compare_source_kind: isAggregateProfile(profile) ? 'aggregate' : 'single',
    },
    bpm: profile?.bpm ?? profile?.bpm_range?.avg ?? null,
    bpm_range: profile?.bpm_range ?? null,
    key: profile?.key ?? profile?.key_consensus ?? 'unknown',
    key_confidence: profile?.key_confidence ?? null,
    key_consensus: profile?.key_consensus ?? null,
    mode_consensus: profile?.mode_consensus ?? null,
    structure: {
      section_count: profile?.structure?.section_count ?? profile?.structure?.section_count_range?.avg ?? null,
      section_count_range: profile?.structure?.section_count_range ?? null,
      bars_per_section: profile?.structure?.bars_per_section ?? profile?.structure?.bars_per_section_avg ?? null,
      bars_per_section_avg: profile?.structure?.bars_per_section_avg ?? null,
    },
    arrangement: {
      track_presence: profile?.arrangement?.track_presence ?? {},
      role_presence: profile?.arrangement?.role_presence ?? {},
    },
    rhythm: {
      notes_per_bar: rhythmByTrack ?? {},
      notes_per_bar_by_role: profile?.rhythm?.notes_per_bar_by_role ?? {},
    },
    pitch: {
      by_track: pitchByTrack,
      chords_by_track: chordsByTrack,
    },
  };
}

function isAggregateProfile(profile) {
  return Boolean(
    profile?.bpm_range ||
    profile?.key_consensus ||
    profile?.mode_consensus ||
    profile?.structure?.section_count_range ||
    profile?._meta?.sets_analyzed ||
    ['album', 'artist', 'collection'].includes(profile?._meta?.scope)
  );
}
