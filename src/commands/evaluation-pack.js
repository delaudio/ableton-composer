import chalk from 'chalk';
import { mkdir, writeFile } from 'fs/promises';
import { join } from 'path';
import { analyzeSong, compareProfiles } from '../lib/analysis.js';
import { loadComparableProfile } from '../lib/comparison.js';
import { runSongCritique } from '../lib/critique-runner.js';
import { validateRoundtrip } from '../lib/roundtrip.js';
import { loadSong, slugify } from '../lib/storage.js';

export async function evaluationPackCommand(targets, options) {
  try {
    const reportDir = resolveReportDir(targets, options.out);
    await mkdir(reportDir, { recursive: true });

    const roundtripFormats = parseRoundtripFormats(options.roundtrip);
    const referenceProfile = options.reference ? await loadComparableProfile(options.reference) : null;
    const referenceLabel = options.reference || null;
    const entries = [];

    for (const target of targets) {
      const { song, filepath, isDirectory } = await loadSong(target);
      const analysis = analyzeSong(song, filepath);
      const entry = {
        target,
        source_path: filepath,
        is_directory: isDirectory,
        summary: summarizeSong(song, analysis),
      };

      if (referenceProfile) {
        entry.compare = compareProfiles(referenceProfile, analysis);
      }

      if (roundtripFormats.length > 0) {
        entry.roundtrip = {};
        for (const format of roundtripFormats) {
          entry.roundtrip[format] = await validateRoundtrip(song, { via: format });
        }
      }

      if (options.critique) {
        entry.critique = await runSongCritique(song, filepath, {
          rubric: options.rubric || 'auto',
          model: options.model,
          provider: options.provider || 'anthropic',
        });
      }

      entries.push(entry);
      console.log(chalk.green(`✓ Evaluated ${target}`));
    }

    const pack = {
      type: 'evaluation-pack',
      created_at: new Date().toISOString(),
      reference: referenceLabel,
      critique: Boolean(options.critique),
      critique_provider: options.critique ? (options.provider || 'anthropic') : null,
      critique_rubric: options.critique ? (options.rubric || 'auto') : null,
      roundtrip_formats: roundtripFormats,
      targets: entries,
    };

    const jsonPath = join(reportDir, 'evaluation-pack.json');
    const mdPath = join(reportDir, 'README.md');
    await writeFile(jsonPath, JSON.stringify(pack, null, 2), 'utf-8');
    await writeFile(mdPath, renderMarkdown(pack), 'utf-8');

    console.log(chalk.bold(`\n Evaluation Pack`));
    console.log(chalk.dim(`  dir:   ${reportDir}`));
    console.log(chalk.dim(`  json:  ${jsonPath}`));
    console.log(chalk.dim(`  notes: ${mdPath}`));
  } catch (err) {
    console.error(chalk.red(`✗ ${err.message}`));
    process.exit(1);
  }
}

function summarizeSong(song, analysis) {
  return {
    genre: song.meta?.genre || '',
    bpm: Number(song.meta?.bpm || 0),
    scale: song.meta?.scale || '',
    time_signature: song.meta?.time_signature || '4/4',
    sections: song.sections?.length || 0,
    tracks: [...new Set((song.sections || []).flatMap(section => (section.tracks || []).map(track => track.ableton_name)))],
    notes: (song.sections || []).reduce(
      (sum, section) => sum + (section.tracks || []).reduce((trackSum, track) => trackSum + (track.clip?.notes?.length || 0), 0),
      0,
    ),
    analyzed_key: analysis.key,
  };
}

function resolveReportDir(targets, outPath) {
  if (outPath) {
    return outPath.startsWith('/') ? outPath : join(process.cwd(), outPath);
  }
  const base = targets.length === 1 ? slugify(targets[0]) : `batch-${targets.length}-sets`;
  return join(process.cwd(), 'reports', `${base}-evaluation-pack`);
}

function parseRoundtripFormats(value) {
  if (!value) return [];
  const formats = String(value)
    .split(',')
    .map(item => item.trim().toLowerCase())
    .filter(Boolean);
  for (const format of formats) {
    if (!['midi', 'musicxml', 'mxl'].includes(format)) {
      throw new Error(`Unsupported round-trip format "${format}". Use midi, musicxml, or mxl.`);
    }
  }
  return [...new Set(formats)];
}

function renderMarkdown(pack) {
  const lines = [
    '# Evaluation Pack',
    '',
    `- Created: ${pack.created_at}`,
    `- Targets: ${pack.targets.length}`,
    `- Reference: ${pack.reference || '(none)'}`,
    `- Critique: ${pack.critique ? `yes (${pack.critique_provider}, rubric ${pack.critique_rubric})` : 'no'}`,
    `- Round-trip formats: ${pack.roundtrip_formats.join(', ') || '(none)'}`,
    '',
  ];

  for (const entry of pack.targets) {
    lines.push(`## ${entry.target}`);
    lines.push('');
    lines.push(`- Source: ${entry.source_path}${entry.is_directory ? '/' : ''}`);
    lines.push(`- BPM / key: ${entry.summary.bpm} / ${entry.summary.scale || entry.summary.analyzed_key || 'unknown'}`);
    lines.push(`- Sections: ${entry.summary.sections}`);
    lines.push(`- Tracks: ${entry.summary.tracks.join(', ') || '(none)'}`);
    lines.push(`- Notes: ${entry.summary.notes}`);

    if (entry.compare) {
      lines.push(`- Compare fidelity: ${entry.compare.fidelity_score}%`);
    }

    if (entry.critique) {
      lines.push(`- Critique score: ${entry.critique.score}/100`);
      lines.push(`- Critique summary: ${entry.critique.summary}`);
    }

    if (entry.roundtrip) {
      for (const [format, report] of Object.entries(entry.roundtrip)) {
        lines.push(`- Round-trip ${format}: ${report.comparison.note_match_pct}% notes, ${report.comparison.track_name_overlap_pct}% track overlap`);
      }
    }

    lines.push('');
  }

  return `${lines.join('\n')}\n`;
}
