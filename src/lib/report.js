import { analyzeSong } from './analysis.js';

export function buildSongReport(song, sourcePath = '') {
  const analysis = analyzeSong(song, sourcePath || '(report)');
  const sections = buildSectionSummaries(song.sections || []);
  const tracks = buildTrackSummaries(song.sections || []);
  const rolePresence = buildRolePresence(sections);
  const densityRange = buildDensityRange(sections);
  const totalBars = sections.reduce((sum, section) => sum + section.bars, 0);
  const noteCount = sections.reduce((sum, section) => sum + section.note_count, 0);

  return {
    type: 'song-report',
    generated_at: new Date().toISOString(),
    source_path: sourcePath,
    summary: {
      title: song.meta?.genre || song.sections?.[0]?.name || 'Untitled Song',
      bpm: Number(song.meta?.bpm || 0) || null,
      scale: song.meta?.scale || '',
      time_signature: song.meta?.time_signature || '4/4',
      genre: song.meta?.genre || '',
      description: song.meta?.description || '',
      sections: sections.length,
      tracks: tracks.length,
      bars: totalBars,
      notes: noteCount,
    },
    analysis: {
      key: analysis.key,
      bpm: analysis.bpm,
      role_constraints: analysis.role_constraints || {},
    },
    sections,
    tracks,
    role_presence: rolePresence,
    density_range: densityRange,
    timeline_svg: buildTimelineSvg(sections),
    energy_svg: buildEnergySvg(sections),
  };
}

export function renderSongReportMarkdown(report) {
  const lines = [
    '---',
    `title: Song Report - ${escapeFrontmatter(report.summary.title)}`,
    `description: Static report for ${escapeFrontmatter(report.summary.title)}`,
    'template: docs',
    '---',
    '',
    `# ${report.summary.title}`,
    '',
    report.summary.description || 'Static report generated from an AbletonSong set.',
    '',
    '## Snapshot',
    '',
    `- BPM: ${report.summary.bpm ?? 'n/a'}`,
    `- Scale: ${report.summary.scale || report.analysis.key || 'unknown'}`,
    `- Time signature: ${report.summary.time_signature}`,
    `- Sections: ${report.summary.sections}`,
    `- Tracks: ${report.summary.tracks}`,
    `- Bars: ${report.summary.bars}`,
    `- Notes: ${report.summary.notes}`,
    report.source_path ? `- Source: ${report.source_path}` : null,
    '',
    '## Timeline',
    '',
    report.timeline_svg,
    '',
    '## Energy Curve',
    '',
    report.energy_svg,
    '',
    '## Sections',
    '',
    '| Section | Bars | Tracks | Roles | Notes | Notes/Bar | Energy |',
    '| --- | ---: | ---: | --- | ---: | ---: | ---: |',
    ...report.sections.map(section => `| ${section.name} | ${section.bars} | ${section.track_count} | ${section.roles.join(', ') || 'none'} | ${section.note_count} | ${formatDecimal(section.notes_per_bar)} | ${section.energy} |`),
    '',
    '## Tracks',
    '',
    '| Track | Sections | Roles | Notes | Range | Avg Notes/Bar |',
    '| --- | ---: | --- | ---: | --- | ---: |',
    ...report.tracks.map(track => `| ${track.name} | ${track.sections_active} | ${track.roles.join(', ') || 'none'} | ${track.note_count} | ${track.pitch_range || 'n/a'} | ${formatDecimal(track.avg_notes_per_bar)} |`),
    '',
    '## Role Presence',
    '',
    '| Role | Active Sections | Presence |',
    '| --- | ---: | ---: |',
    ...report.role_presence.map(role => `| ${role.role} | ${role.active_sections}/${report.summary.sections} | ${role.presence_pct}% |`),
    '',
    '## Density Notes',
    '',
    `- Section density range: ${formatDecimal(report.density_range.min)} to ${formatDecimal(report.density_range.max)} notes/bar`,
    `- Median-ish reference: ${formatDecimal(report.density_range.avg)} notes/bar`,
    '',
  ].filter(Boolean);

  return `${lines.join('\n')}\n`;
}

function buildSectionSummaries(sections) {
  return sections.map((section, index) => {
    const tracks = Array.isArray(section.tracks) ? section.tracks : [];
    const noteCount = tracks.reduce((sum, track) => sum + (track.clip?.notes?.length || 0), 0);
    const bars = Number(section.bars) || inferSectionBars(section);
    const roles = [...new Set(tracks.map(track => inferRoleFromName(track.ableton_name)).filter(Boolean))];
    const notesPerBar = bars > 0 ? noteCount / bars : 0;

    return {
      index,
      name: section.name || `section_${index + 1}`,
      bars,
      track_count: tracks.length,
      note_count: noteCount,
      notes_per_bar: notesPerBar,
      roles,
      energy: inferEnergy(notesPerBar, tracks.length, roles.length),
      track_names: tracks.map(track => track.ableton_name),
    };
  });
}

function buildTrackSummaries(sections) {
  const byTrack = new Map();

  for (const section of sections) {
    for (const track of section.tracks || []) {
      const name = track.ableton_name;
      if (!name) continue;

      if (!byTrack.has(name)) {
        byTrack.set(name, {
          name,
          roles: new Set(),
          note_count: 0,
          bars: 0,
          sections_active: 0,
          pitches: [],
        });
      }

      const entry = byTrack.get(name);
      const notes = Array.isArray(track.clip?.notes) ? track.clip.notes : [];
      entry.note_count += notes.length;
      entry.bars += Number(section.bars) || inferSectionBars(section);
      entry.sections_active += notes.length > 0 ? 1 : 0;
      entry.roles.add(inferRoleFromName(name));
      entry.pitches.push(...notes.map(note => note.pitch).filter(Number.isFinite));
    }
  }

  return [...byTrack.values()].map(track => ({
    name: track.name,
    roles: [...track.roles].filter(Boolean),
    note_count: track.note_count,
    sections_active: track.sections_active,
    pitch_range: track.pitches.length > 0 ? `${Math.min(...track.pitches)}-${Math.max(...track.pitches)}` : '',
    avg_notes_per_bar: track.bars > 0 ? track.note_count / track.bars : 0,
  }));
}

function buildRolePresence(sections) {
  const counts = new Map();

  for (const section of sections) {
    for (const role of section.roles) {
      counts.set(role, (counts.get(role) || 0) + 1);
    }
  }

  return [...counts.entries()]
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0], 'en'))
    .map(([role, activeSections]) => ({
      role,
      active_sections: activeSections,
      presence_pct: Math.round((activeSections / Math.max(1, sections.length)) * 100),
    }));
}

function buildDensityRange(sections) {
  const values = sections.map(section => section.notes_per_bar);
  if (values.length === 0) return { min: 0, max: 0, avg: 0 };

  const sum = values.reduce((acc, value) => acc + value, 0);
  return {
    min: Math.min(...values),
    max: Math.max(...values),
    avg: sum / values.length,
  };
}

function buildTimelineSvg(sections) {
  const totalBars = Math.max(1, sections.reduce((sum, section) => sum + section.bars, 0));
  const width = 960;
  const height = 136;
  let cursor = 0;

  const rects = sections.map((section, index) => {
    const x = Math.round((cursor / totalBars) * width);
    const w = Math.max(24, Math.round((section.bars / totalBars) * width));
    const fill = SECTION_COLORS[index % SECTION_COLORS.length];
    const label = escapeXml(compactTimelineLabel(section.name, index, w, sections.length));
    const notes = compactTimelineMeta(section, w);
    const anchor = w < 64 ? 'middle' : 'start';
    const textX = w < 64 ? Math.round(x + (w / 2)) : x + 12;
    const tooltip = escapeXml(formatSectionTooltip(section, index));
    cursor += section.bars;

    return [
      `<g data-report-tooltip="${tooltip}" style="cursor: default;">`,
      `<rect x="${x}" y="18" width="${w}" height="58" rx="8" fill="${fill}" opacity="0.92"></rect>`,
      `<text x="${textX}" y="42" fill="#111111" font-size="${w < 64 ? 12 : 14}" text-anchor="${anchor}" font-family="ui-monospace, SFMono-Regular, Menlo, monospace">${label}</text>`,
      notes ? `<text x="${textX}" y="60" fill="#333333" font-size="${w < 64 ? 10 : 11}" text-anchor="${anchor}" font-family="ui-monospace, SFMono-Regular, Menlo, monospace">${escapeXml(notes)}</text>` : '',
      `</g>`,
    ].join('');
  }).join('');

  return `<svg viewBox="0 0 ${width} ${height}" width="100%" role="img" aria-label="Song section timeline"><rect x="0" y="0" width="${width}" height="${height}" rx="14" fill="#f5f1e8"></rect>${rects}<text x="24" y="112" fill="#5b5b5b" font-size="11" font-family="ui-monospace, SFMono-Regular, Menlo, monospace">Detailed section names remain listed in the Sections table below.</text></svg>`;
}

function buildEnergySvg(sections) {
  const width = 960;
  const height = 220;
  const padding = 40;
  const maxEnergy = Math.max(1, ...sections.map(section => section.energy));
  const step = sections.length > 1 ? (width - padding * 2) / (sections.length - 1) : 0;
  const compactAxis = sections.length >= 8;

  const points = sections.map((section, index) => {
    const x = padding + index * step;
    const y = height - padding - ((section.energy / maxEnergy) * (height - padding * 2));
    return [Math.round(x), Math.round(y)];
  });

  const polyline = points.map(([x, y]) => `${x},${y}`).join(' ');
  const dots = points.map(([x, y], index) => {
    const section = sections[index];
    const label = compactAxis ? compactTimelineLabel(section.name, index, 72, sections.length) : truncateLabel(section.name, 12);
    const tooltip = escapeXml(`${formatSectionTooltip(section, index)}\nEnergy: ${section.energy}/10`);
    return [
      `<g data-report-tooltip="${tooltip}" style="cursor: default;">`,
      `<circle cx="${x}" cy="${y}" r="5" fill="#0f766e"></circle>`,
      `<text x="${x}" y="${height - 12}" text-anchor="middle" fill="#333333" font-size="10" font-family="ui-monospace, SFMono-Regular, Menlo, monospace">${escapeXml(label)}</text>`,
      `</g>`,
    ].join('');
  }).join('');

  const footer = compactAxis
    ? `<text x="24" y="${height - 24}" fill="#5b5b5b" font-size="11" font-family="ui-monospace, SFMono-Regular, Menlo, monospace">Hover points for full section names and energy details.</text>`
    : '';

  return `<svg viewBox="0 0 ${width} ${height}" width="100%" role="img" aria-label="Section energy curve"><rect x="0" y="0" width="${width}" height="${height}" rx="14" fill="#eef7f5"></rect><line x1="${padding}" y1="${height - padding}" x2="${width - padding}" y2="${height - padding}" stroke="#6b7280" stroke-width="1"></line><line x1="${padding}" y1="${padding}" x2="${padding}" y2="${height - padding}" stroke="#6b7280" stroke-width="1"></line><polyline fill="none" stroke="#0f766e" stroke-width="4" points="${polyline}"></polyline>${dots}${footer}</svg>`;
}

function inferRoleFromName(name) {
  const value = String(name || '').toLowerCase();
  if (/\bdrum|kick|snare|hat|perc/.test(value)) return 'drums';
  if (/\bbass|sub|808/.test(value)) return 'bass';
  if (/\blead|melody|hook/.test(value)) return 'lead';
  if (/\bpad|string|atmos/.test(value)) return 'pad';
  if (/\bkey|piano|rhodes|organ/.test(value)) return 'keys';
  if (/\bvocal|vox|choir/.test(value)) return 'vocals';
  if (/\bfx|impact|rise|noise/.test(value)) return 'fx';
  return 'other';
}

function inferEnergy(notesPerBar, trackCount, roleCount) {
  return Math.max(1, Math.min(10, Math.round((notesPerBar * 0.6) + (trackCount * 0.7) + (roleCount * 0.9))));
}

function inferSectionBars(section) {
  const clipBars = (section.tracks || [])
    .map(track => Number(track.clip?.length_bars) || 0)
    .filter(Boolean);
  return clipBars.length > 0 ? Math.max(...clipBars) : 1;
}

function formatDecimal(value) {
  return Number(value || 0).toFixed(2).replace(/\.00$/, '');
}

function compactTimelineLabel(name, index, width, sectionCount) {
  if (width < 42) return String(index + 1);
  if (width < 64) return String(index + 1).padStart(2, '0');
  if (sectionCount >= 10) return `S${String(index + 1).padStart(2, '0')}`;

  const normalized = String(name || `section_${index + 1}`);
  if (width < 96) return truncateLabel(normalized, 8);
  if (width < 140) return truncateLabel(normalized, 14);
  return truncateLabel(normalized, 24);
}

function compactTimelineMeta(section, width) {
  if (width < 42) return '';
  if (width < 64) return `${section.bars}b`;
  if (width < 96) return `${section.bars}b · ${section.note_count}n`;
  return `${section.bars} bars · ${section.note_count} notes`;
}

function formatSectionTooltip(section, index) {
  return `S${String(index + 1).padStart(2, '0')} · ${section.name}\n${section.bars} bars · ${section.note_count} notes · ${section.track_count} tracks`;
}

function truncateLabel(value, maxLength) {
  const input = String(value || '');
  if (input.length <= maxLength) return input;
  return `${input.slice(0, Math.max(1, maxLength - 1))}…`;
}

function escapeXml(value) {
  return String(value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

function escapeFrontmatter(value) {
  return String(value).replace(/:/g, ' -');
}

const SECTION_COLORS = [
  '#f4b942',
  '#ff7b54',
  '#7ad3c2',
  '#8ea8ff',
  '#d88cff',
  '#94c356',
  '#ff9fb2',
  '#6fd3ff',
];
