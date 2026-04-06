import { mkdir, readFile, writeFile } from 'fs/promises';
import { dirname, join } from 'path';

const PROFILE_ROOT = 'profiles';
const VALID_SCOPES = new Set(['song', 'album', 'artist', 'collection']);

export function slugifyProfileSegment(value) {
  return String(value || '')
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '')
    .slice(0, 80);
}

export function enrichProfileMetadata(profile, metadata = {}) {
  profile._meta ??= {};
  profile._meta.scope = metadata.scope || profile._meta.scope || 'song';
  profile._meta.domain = metadata.domain || profile._meta.domain || 'core';
  profile._meta.artist = metadata.artist || profile._meta.artist || null;
  profile._meta.album = metadata.album || profile._meta.album || null;
  profile._meta.song = metadata.song || profile._meta.song || null;
  profile._meta.source_paths = metadata.sourcePaths || profile._meta.source_paths || [];
  return profile;
}

export function resolveProfileTarget({ options = {}, fallbackTarget, defaultScope = 'song' }) {
  const scope = VALID_SCOPES.has(options.scope) ? options.scope : defaultScope;
  const artist = options.artist ? slugifyProfileSegment(options.artist) : null;
  const album = options.album ? slugifyProfileSegment(options.album) : null;
  const song = options.song ? slugifyProfileSegment(options.song) : slugifyProfileSegment(fallbackTarget);

  const parts = [process.cwd(), PROFILE_ROOT, `${scope}s`];
  if (artist) parts.push(artist);
  if (album && scope !== 'artist') parts.push(album);
  if (scope === 'song') parts.push(song || 'untitled');
  if (scope === 'album' && !album) parts.push(song || 'untitled');
  if (scope === 'artist' && !artist) parts.push(song || 'untitled');
  if (scope === 'collection') parts.push(song || 'untitled');

  return {
    dir: join(...parts),
    scope,
    artist: options.artist || null,
    album: options.album || null,
    song: options.song || (scope === 'song' ? fallbackTarget : null),
  };
}

export async function saveProfileWithBundle({ profile, options = {}, fallbackTarget, defaultScope = 'song', writeBundle = true }) {
  return saveProfileSetWithBundle({
    profiles: { core: profile },
    options,
    fallbackTarget,
    defaultScope,
    writeBundle,
  });
}

export async function saveProfileSetWithBundle({ profiles, options = {}, fallbackTarget, defaultScope = 'song', writeBundle = true }) {
  const target = resolveProfileTarget({ options, fallbackTarget, defaultScope });
  await mkdir(target.dir, { recursive: true });
  const writtenProfiles = {};

  for (const [domain, profile] of Object.entries(profiles)) {
    const enriched = enrichProfileMetadata(profile, {
      scope: target.scope,
      domain,
      artist: target.artist,
      album: target.album,
      song: target.song,
      sourcePaths: profile._meta?.source_paths || [profile._meta?.source].filter(Boolean),
    });
    const path = join(target.dir, `${domain}.json`);
    await writeFile(path, JSON.stringify(enriched, null, 2), 'utf-8');
    writtenProfiles[domain] = path;
  }

  const promptProfile = buildPromptProfile(profiles);
  const promptPath = join(target.dir, 'prompt.json');
  await writeFile(promptPath, JSON.stringify(promptProfile, null, 2), 'utf-8');
  writtenProfiles.prompt = promptPath;

  let bundlePath = null;
  if (writeBundle) {
    const bundle = {
      type: 'profile-bundle',
      scope: target.scope,
      artist: target.artist,
      album: target.album,
      song: target.song,
      profiles: Object.fromEntries(
        Object.keys(writtenProfiles).map(domain => [domain, `${domain}.json`])
      ),
    };
    bundlePath = join(target.dir, 'bundle.json');
    await writeFile(bundlePath, JSON.stringify(bundle, null, 2), 'utf-8');
  }

  return { paths: writtenProfiles, corePath: writtenProfiles.core || null, bundlePath, target };
}

export async function loadStyleProfile(pathname) {
  const raw = await readFile(pathname, 'utf-8');
  const parsed = JSON.parse(raw);

  if (parsed?.type === 'profile-bundle') {
    const coreRelPath = parsed.profiles?.core;
    if (!coreRelPath) {
      throw new Error(`Bundle has no core profile: ${pathname}`);
    }
    const promptRelPath = parsed.profiles?.prompt;

    if (promptRelPath) {
      const promptPath = join(dirname(pathname), promptRelPath);
      const promptRaw = await readFile(promptPath, 'utf-8');
      return {
        profile: JSON.parse(promptRaw),
        resolvedPath: promptPath,
        bundle: parsed,
      };
    }

    const loadedProfiles = {};

    for (const [domain, relPath] of Object.entries(parsed.profiles || {})) {
      const absPath = join(dirname(pathname), relPath);
      const domainRaw = await readFile(absPath, 'utf-8');
      loadedProfiles[domain] = JSON.parse(domainRaw);
    }

    const profile = {
      ...loadedProfiles.core,
      _bundle: {
        ...parsed,
        resolved_profiles: Object.fromEntries(
          Object.entries(parsed.profiles || {}).map(([domain, relPath]) => [domain, join(dirname(pathname), relPath)])
        ),
      },
    };

    for (const [domain, domainProfile] of Object.entries(loadedProfiles)) {
      if (domain === 'core') continue;
      profile[domain] = domainProfile[domain] ?? domainProfile;
    }

    return { profile, resolvedPath: join(dirname(pathname), coreRelPath), bundle: parsed };
  }

  return { profile: parsed, resolvedPath: pathname, bundle: null };
}

function buildPromptProfile(profiles) {
  const core = profiles.core ?? {};
  const harmony = profiles.harmony?.harmony ?? {};
  const rhythm = profiles.rhythm?.rhythm ?? {};
  const arrangement = profiles.arrangement?.arrangement ?? {};

  const compact = {
    _meta: {
      ...(core._meta ?? {}),
      domain: 'prompt',
      prompt_ready: true,
      source_domains: Object.keys(profiles),
    },
  };

  if (core.bpm != null) compact.bpm = core.bpm;
  if (core.bpm_range) compact.bpm_range = core.bpm_range;
  if (core.time_signature) compact.time_signature = core.time_signature;
  if (core.key) compact.key = core.key;
  if (core.key_confidence != null) compact.key_confidence = core.key_confidence;
  if (core.key_consensus) compact.key_consensus = core.key_consensus;
  if (core.mode_consensus) compact.mode_consensus = core.mode_consensus;
  if (core.structure) {
    compact.structure = {
      section_count: core.structure.section_count,
      section_count_range: core.structure.section_count_range,
      bars_per_section: core.structure.bars_per_section,
      bars_per_section_avg: core.structure.bars_per_section_avg,
      total_bars: core.structure.total_bars,
      section_sequence: (core.structure.section_sequence ?? []).slice(0, 12),
    };
  }
  if (core.arrangement) {
    const rolePresence = core.arrangement.role_presence ?? {};
    const roleConstraints = deriveRoleConstraints({
      rolePresence,
      avgActiveTracksPerSection: profiles.arrangement?.arrangement?.avg_active_tracks_per_section,
    });
    compact.arrangement = {
      tracks: selectTopKeys(core.arrangement.track_presence ?? {}, 12),
      track_presence: pickKeys(core.arrangement.track_presence ?? {}, selectTopKeys(core.arrangement.track_presence ?? {}, 12)),
      role_presence: rolePresence,
      role_constraints: roleConstraints,
      by_section: trimSectionMap(core.arrangement.by_section ?? {}, 8),
    };
  }
  if (core.pitch) {
    compact.pitch = {
      pitch_classes: topObjectEntries(core.pitch.pitch_classes ?? {}, 8),
      by_track: pickObjectEntriesByKeys(core.pitch.by_track ?? {}, selectTopKeys(core.arrangement?.track_presence ?? {}, 8)),
      chords_by_track: pickObjectEntriesByKeys(core.pitch.chords_by_track ?? {}, selectTopKeys(core.arrangement?.track_presence ?? {}, 8), 5),
      key_by_section: trimSectionMap(core.pitch.key_by_section ?? {}, 8),
    };
  }

  compact.harmony = {
    harmonic_rhythm_avg: harmony.harmonic_rhythm_avg,
    top_chords: (harmony.top_chords ?? []).slice(0, 8),
    top_progressions: (harmony.top_progressions ?? []).slice(0, 8),
    top_bass_root_motion: (harmony.top_bass_root_motion ?? []).slice(0, 8),
  };

  const rhythmTrackKeys = selectRhythmTracks(rhythm.by_track ?? {}, core.arrangement?.track_presence ?? {}, 10);
  compact.rhythm = {
    avg_section_density: rhythm.avg_section_density,
    notes_per_bar_by_role: core.rhythm?.notes_per_bar_by_role ?? {},
    by_track: Object.fromEntries(
      rhythmTrackKeys.map(key => {
        const entry = rhythm.by_track?.[key] ?? {};
        return [key, {
          notes_per_bar: entry.notes_per_bar,
          syncopation: entry.syncopation,
          avg_duration: entry.avg_duration,
          onset_histogram_16: (entry.onset_histogram_16 ?? []).slice(0, 16),
          dominant_pattern_16: entry.dominant_pattern_16,
          dominant_patterns_16: (entry.dominant_patterns_16 ?? []).slice(0, 3),
        }];
      })
    ),
    by_section: (rhythm.by_section ?? []).slice(0, 8),
  };

  compact.arrangement = {
    ...(compact.arrangement ?? {}),
    avg_active_tracks_per_section: arrangement.avg_active_tracks_per_section,
    avg_section_energy: arrangement.avg_section_energy,
    energy_curve: (arrangement.energy_curve ?? []).slice(0, 8),
    section_signals: compactSectionSignals(arrangement.by_section ?? [], 8),
    section_archetypes: (arrangement.section_archetypes ?? []).slice(0, 6).map(compactSectionArchetype),
    entry_order: pickObjectEntriesByKeys(arrangement.entry_order ?? {}, selectTopKeys(core.arrangement?.track_presence ?? {}, 10)),
    top_layer_combinations: (arrangement.top_layer_combinations ?? []).slice(0, 6),
    top_role_combinations: (arrangement.top_role_combinations ?? []).slice(0, 6),
  };

  return compact;
}

function compactSectionSignals(sections, count = 8) {
  return sections.slice(0, count).map(section => ({
    section: section.section,
    section_index: section.section_index,
    position_bucket: section.position_bucket,
    bars: section.bars,
    active_roles: (section.active_roles ?? []).slice(0, 8),
    inactive_roles: (section.inactive_roles ?? []).slice(0, 8),
    entered_roles: (section.entered_roles ?? []).slice(0, 6),
    exited_roles: (section.exited_roles ?? []).slice(0, 6),
    active_track_count: section.active_track_count,
    active_role_count: section.active_role_count,
    density_hint: section.density_hint,
    energy: section.energy,
  }));
}

function compactSectionArchetype(archetype) {
  return {
    bucket: archetype.bucket,
    samples: archetype.samples,
    avg_active_tracks: archetype.avg_active_tracks,
    avg_energy: archetype.avg_energy,
    common_active_roles: (archetype.common_active_roles ?? []).slice(0, 8),
    common_inactive_roles: (archetype.common_inactive_roles ?? []).slice(0, 8),
    dominant_density_hints: (archetype.dominant_density_hints ?? []).slice(0, 3),
    top_role_combinations: (archetype.top_role_combinations ?? []).slice(0, 4),
  };
}

function deriveRoleConstraints({ rolePresence = {}, avgActiveTracksPerSection = null }) {
  const entries = Object.entries(rolePresence)
    .filter(([role]) => role !== 'other')
    .sort((a, b) => b[1] - a[1]);

  const totalRolePresence = entries.reduce((sum, [, ratio]) => sum + ratio, 0);
  const roleCountTarget = totalRolePresence > 0 ? Math.max(1, Math.round(totalRolePresence)) : null;
  const roleCountCap = totalRolePresence > 0 ? Math.max(2, Math.ceil(totalRolePresence + 0.5)) : null;

  return {
    target_active_roles_per_section: roleCountTarget,
    max_active_roles_per_section: roleCountCap,
    avg_active_tracks_per_section: avgActiveTracksPerSection,
    anchor_roles: entries.filter(([, ratio]) => ratio >= 0.4).map(([role]) => role).slice(0, 4),
    occasional_roles: entries.filter(([, ratio]) => ratio > 0.15 && ratio < 0.4).map(([role]) => role).slice(0, 6),
    sparse_roles: entries.filter(([, ratio]) => ratio <= 0.15).map(([role]) => role).slice(0, 6),
  };
}

function selectTopKeys(obj, count = 8) {
  return Object.entries(obj)
    .sort((a, b) => (b[1] ?? 0) - (a[1] ?? 0))
    .slice(0, count)
    .map(([key]) => key);
}

function topObjectEntries(obj, count = 8) {
  return Object.fromEntries(
    Object.entries(obj)
      .sort((a, b) => (b[1] ?? 0) - (a[1] ?? 0))
      .slice(0, count)
  );
}

function pickKeys(obj, keys) {
  return Object.fromEntries(keys.filter(key => key in obj).map(key => [key, obj[key]]));
}

function pickObjectEntriesByKeys(obj, keys, listLimit = null) {
  return Object.fromEntries(
    keys
      .filter(key => key in obj)
      .map(key => {
        const value = obj[key];
        if (listLimit != null && Array.isArray(value)) return [key, value.slice(0, listLimit)];
        return [key, value];
      })
  );
}

function trimSectionMap(obj, count = 8) {
  return Object.fromEntries(Object.entries(obj).slice(0, count));
}

function selectRhythmTracks(byTrack, presence, count = 10) {
  const scored = Object.entries(byTrack).map(([key, value]) => {
    const p = presence[key] ?? 0;
    const npb = value.notes_per_bar ?? 0;
    return { key, score: p * 10 + npb };
  });
  return scored.sort((a, b) => b.score - a.score).slice(0, count).map(item => item.key);
}
