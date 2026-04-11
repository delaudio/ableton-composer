import { createHash } from 'crypto';

const PROMPT_SUMMARY_LIMIT = 180;

export function createProvenance({
  sourceType,
  operation,
  sourcePath,
  sourceFormat,
  sourceHash,
  originSourcePath,
  originSourceFormat,
  originSourceHash,
  stemName,
  separationMetadata,
  engine,
  provider,
  model,
  prompt,
  styleProfilePath,
  details = {},
  ...entryDetails
} = {}) {
  const now = new Date().toISOString();
  const combinedDetails = { ...entryDetails, ...details };
  const entry = createHistoryEntry(operation || sourceType || 'create', {
    source_path: sourcePath,
    source_format: sourceFormat,
    source_hash: sourceHash,
    origin_source_path: originSourcePath,
    origin_source_format: originSourceFormat,
    origin_source_hash: originSourceHash,
    stem_name: stemName,
    separation_metadata: separationMetadata,
    engine,
    provider,
    model,
    prompt,
    style_profile: styleProfilePath,
    ...combinedDetails,
  }, now);

  return pruneUndefined({
    source_type: sourceType,
    source_path: sourcePath,
    source_format: sourceFormat,
    source_hash: sourceHash,
    origin_source_path: originSourcePath,
    origin_source_format: originSourceFormat,
    origin_source_hash: originSourceHash,
    stem_name: stemName,
    separation_metadata: separationMetadata,
    engine,
    provider,
    model,
    prompt_summary: summarizePrompt(prompt),
    prompt_hash: hashPrompt(prompt),
    style_profile: styleProfilePath,
    created_at: now,
    updated_at: now,
    transforms: [entry],
  });
}

export function appendProvenance(song, operation, details = {}) {
  if (!song?.meta) return song;

  const now = new Date().toISOString();
  const previous = song.meta.provenance && typeof song.meta.provenance === 'object'
    ? song.meta.provenance
    : {};

  song.meta.provenance = pruneUndefined({
    ...previous,
    updated_at: now,
    transforms: [
      ...(Array.isArray(previous.transforms) ? previous.transforms : []),
      createHistoryEntry(operation, details, now),
    ],
  });

  if (!song.meta.provenance.created_at) {
    song.meta.provenance.created_at = now;
  }

  return song;
}

function createHistoryEntry(operation, details = {}, at = new Date().toISOString()) {
  return pruneUndefined({
    operation,
    at,
    source_path: details.source_path,
    source_format: details.source_format,
    source_hash: details.source_hash,
    origin_source_path: details.origin_source_path,
    origin_source_format: details.origin_source_format,
    origin_source_hash: details.origin_source_hash,
    stem_name: details.stem_name,
    separation_metadata: details.separation_metadata,
    engine: details.engine,
    provider: details.provider,
    model: details.model,
    prompt_summary: summarizePrompt(details.prompt),
    prompt_hash: hashPrompt(details.prompt),
    style_profile: details.style_profile ?? details.styleProfilePath,
    sections: details.sections,
    tracks: details.tracks,
    output: details.output,
  });
}

function summarizePrompt(prompt) {
  if (!prompt) return undefined;
  const normalized = String(prompt).replace(/\s+/g, ' ').trim();
  if (!normalized) return undefined;
  return normalized.length > PROMPT_SUMMARY_LIMIT
    ? `${normalized.slice(0, PROMPT_SUMMARY_LIMIT - 1)}…`
    : normalized;
}

function hashPrompt(prompt) {
  if (!prompt) return undefined;
  const normalized = String(prompt).replace(/\s+/g, ' ').trim();
  if (!normalized) return undefined;
  return createHash('sha256').update(normalized).digest('hex').slice(0, 16);
}

function pruneUndefined(obj) {
  return Object.fromEntries(
    Object.entries(obj).filter(([, value]) => value !== undefined && value !== null && value !== ''),
  );
}
