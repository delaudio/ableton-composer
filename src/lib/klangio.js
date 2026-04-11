import { access, copyFile, mkdir, readFile, stat, writeFile } from 'fs/promises';
import { constants } from 'fs';
import { basename, dirname, extname, join } from 'path';
import { createHash } from 'crypto';

const DEFAULT_BASE_URL = 'https://api.klang.io/v1';
const DEFAULT_CREATE_PATH = '/jobs';
const DEFAULT_STATUS_TEMPLATE = '/jobs/{jobId}';
const DEFAULT_RESULT_TEMPLATE = '/jobs/{jobId}/result?format={format}';
const DEFAULT_POLL_MS = 3000;
const DEFAULT_TIMEOUT_MS = 5 * 60 * 1000;
const SUPPORTED_KLANGIO_FORMATS = new Set(['midi', 'musicxml']);

export async function resolveKlangioApiKey(explicitKey) {
  const apiKey = String(explicitKey || process.env.KLANGIO_API_KEY || '').trim();
  if (!apiKey) {
    throw new Error('Klangio credentials not configured. Set KLANGIO_API_KEY or pass --klangio-api-key <key>.');
  }
  return apiKey;
}

export function resolveKlangioBaseUrl(explicitBaseUrl) {
  return String(explicitBaseUrl || process.env.KLANGIO_BASE_URL || DEFAULT_BASE_URL).trim().replace(/\/+$/, '');
}

export function resolveKlangioCacheDir(explicitDir) {
  if (explicitDir) {
    return explicitDir.startsWith('/') ? explicitDir : join(process.cwd(), explicitDir);
  }
  return join(process.cwd(), 'transcriptions', 'cache', 'klangio');
}

export function resolveMusicXmlOutputPath(audioPath, outPath) {
  if (outPath) {
    return outPath.startsWith('/') ? outPath : join(process.cwd(), outPath);
  }

  const stem = basename(audioPath, extname(audioPath));
  return join(process.cwd(), 'transcriptions', `${stem}.musicxml`);
}

export function resolveKlangioFormats(options = {}) {
  const requested = new Set();
  if (options.out || options.toSet) requested.add('midi');
  if (options.xmlOut || options.preferMusicxml) requested.add('musicxml');
  if (requested.size === 0) requested.add('midi');
  return [...requested];
}

export async function runKlangioTranscription({
  apiKey,
  baseUrl,
  audioPath,
  formats,
  mode = 'universal',
  cacheDir,
  refreshCache = false,
  pollMs = DEFAULT_POLL_MS,
  timeoutMs = DEFAULT_TIMEOUT_MS,
  logPath,
}) {
  const normalizedFormats = normalizeFormats(formats);
  const cacheContext = await prepareCacheContext({
    audioPath,
    baseDir: cacheDir,
    mode,
    formats: normalizedFormats,
  });

  if (!refreshCache) {
    const cached = await loadCachedArtifacts(cacheContext, normalizedFormats);
    if (cached) {
      await writeLog(logPath, [
        'Klangio cache hit',
        `cache_dir=${cacheContext.dir}`,
        `formats=${normalizedFormats.join(',')}`,
      ]);
      return {
        cached: true,
        cacheDir: cacheContext.dir,
        requestKey: cacheContext.requestKey,
        outputs: cached.outputs,
        metadataPath: cached.metadataPath,
        response: cached.metadata,
      };
    }
  }

  const createResponse = await createKlangioJob({
    apiKey,
    baseUrl,
    audioPath,
    formats: normalizedFormats,
    mode,
  });
  const jobId = resolveJobId(createResponse);
  if (!jobId) {
    throw new Error('Klangio job creation did not return a job id.');
  }

  const status = await waitForKlangioJob({
    apiKey,
    baseUrl,
    jobId,
    pollMs,
    timeoutMs,
  });

  const outputs = {};
  for (const format of normalizedFormats) {
    const cachePath = join(cacheContext.dir, artifactFilename(format));
    await downloadKlangioArtifact({
      apiKey,
      baseUrl,
      jobId,
      format,
      status,
      targetPath: cachePath,
    });
    outputs[format] = cachePath;
  }

  const metadata = {
    type: 'klangio-transcription',
    version: '0.1',
    created_at: new Date().toISOString(),
    request: {
      base_url: baseUrl,
      mode,
      formats: normalizedFormats,
      audio_path: audioPath,
      audio_hash: cacheContext.audioHash,
      cache_key: cacheContext.requestKey,
    },
    job: {
      id: jobId,
      status: extractStatusValue(status),
    },
    outputs,
    raw: {
      created: createResponse,
      completed: status,
    },
  };
  const metadataPath = join(cacheContext.dir, 'job.json');

  await mkdir(cacheContext.dir, { recursive: true });
  await writeFile(metadataPath, JSON.stringify(metadata, null, 2), 'utf-8');
  await writeLog(logPath, [
    `job_id=${jobId}`,
    `mode=${mode}`,
    `formats=${normalizedFormats.join(',')}`,
    `cache_dir=${cacheContext.dir}`,
  ]);

  return {
    cached: false,
    cacheDir: cacheContext.dir,
    requestKey: cacheContext.requestKey,
    outputs,
    metadataPath,
    response: metadata,
  };
}

export async function copyKlangioArtifacts(run, outputs = {}) {
  const copied = {};

  if (outputs.midiOutPath && run.outputs.midi) {
    copied.midiPath = await copyArtifact(run.outputs.midi, outputs.midiOutPath);
  } else if (run.outputs.midi) {
    copied.midiPath = run.outputs.midi;
  }

  if (outputs.musicXmlOutPath && run.outputs.musicxml) {
    copied.musicXmlPath = await copyArtifact(run.outputs.musicxml, outputs.musicXmlOutPath);
  } else if (run.outputs.musicxml) {
    copied.musicXmlPath = run.outputs.musicxml;
  }

  return copied;
}

async function createKlangioJob({ apiKey, baseUrl, audioPath, formats, mode }) {
  const buffer = await readFile(audioPath);
  const form = new FormData();
  form.append('file', new Blob([buffer]), basename(audioPath));
  form.append('type', 'transcription');
  form.append('mode', mode);
  form.append('output_format', formats[0]);
  form.append('output_formats', formats.join(','));

  for (const format of formats) {
    form.append('output_formats[]', format);
  }

  const response = await fetchKlangio(joinUrl(baseUrl, DEFAULT_CREATE_PATH), {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${apiKey}`,
    },
    body: form,
  });

  if (!response.ok) {
    const message = await safeReadText(response);
    throw new Error(`Klangio job creation failed (${response.status}): ${message || response.statusText}`);
  }

  return safeReadJson(response);
}

async function waitForKlangioJob({ apiKey, baseUrl, jobId, pollMs, timeoutMs }) {
  const deadline = Date.now() + timeoutMs;

  while (Date.now() <= deadline) {
    const response = await fetchKlangio(joinUrl(baseUrl, renderTemplate(DEFAULT_STATUS_TEMPLATE, { jobId })), {
      headers: {
        Authorization: `Bearer ${apiKey}`,
      },
    });

    if (!response.ok) {
      const message = await safeReadText(response);
      throw new Error(`Klangio status lookup failed (${response.status}): ${message || response.statusText}`);
    }

    const payload = await safeReadJson(response);
    const status = normalizeStatus(extractStatusValue(payload));
    if (status === 'completed') return payload;
    if (status === 'failed') {
      throw new Error(`Klangio transcription failed: ${extractFailureReason(payload)}`);
    }

    await sleep(pollMs);
  }

  throw new Error(`Timed out waiting for Klangio transcription after ${timeoutMs}ms.`);
}

async function downloadKlangioArtifact({ apiKey, baseUrl, jobId, format, status, targetPath }) {
  const url = resolveArtifactUrl(status, format, baseUrl, jobId);
  const response = await fetchKlangio(url, {
    headers: {
      Authorization: `Bearer ${apiKey}`,
    },
  });

  if (!response.ok) {
    const message = await safeReadText(response);
    throw new Error(`Klangio ${format} download failed (${response.status}): ${message || response.statusText}`);
  }

  const bytes = new Uint8Array(await response.arrayBuffer());
  await mkdir(dirname(targetPath), { recursive: true });
  await writeFile(targetPath, bytes);
}

async function prepareCacheContext({ audioPath, baseDir, mode, formats }) {
  const buffer = await readFile(audioPath);
  const audioHash = createHash('sha256').update(buffer).digest('hex').slice(0, 16);
  const requestKey = createHash('sha256')
    .update(JSON.stringify({
      audio_hash: audioHash,
      mode,
      formats,
    }))
    .digest('hex')
    .slice(0, 16);
  const dir = join(baseDir, requestKey);
  return { dir, requestKey, audioHash };
}

async function loadCachedArtifacts(cacheContext, formats) {
  const outputs = {};
  for (const format of formats) {
    const pathname = join(cacheContext.dir, artifactFilename(format));
    try {
      await access(pathname, constants.R_OK);
      outputs[format] = pathname;
    } catch {
      return null;
    }
  }

  const metadataPath = join(cacheContext.dir, 'job.json');
  let metadata = null;
  try {
    const raw = await readFile(metadataPath, 'utf-8');
    metadata = JSON.parse(raw);
  } catch {
    metadata = null;
  }

  return { outputs, metadataPath, metadata };
}

function artifactFilename(format) {
  return format === 'musicxml' ? 'result.musicxml' : 'result.mid';
}

function normalizeFormats(formats) {
  const normalized = [...new Set((formats || []).map(format => String(format || '').trim().toLowerCase()).filter(Boolean))];
  if (normalized.length === 0) normalized.push('midi');

  for (const format of normalized) {
    if (!SUPPORTED_KLANGIO_FORMATS.has(format)) {
      throw new Error(`Unsupported Klangio output format: ${format}. Expected one of: midi, musicxml.`);
    }
  }

  return normalized;
}

function resolveJobId(payload) {
  return payload?.job_id || payload?.id || payload?.job?.id || payload?.data?.id || null;
}

function extractStatusValue(payload) {
  return payload?.status || payload?.job?.status || payload?.data?.status || payload?.state || '';
}

function normalizeStatus(value) {
  const normalized = String(value || '').trim().toLowerCase();
  if (['completed', 'complete', 'done', 'finished', 'succeeded', 'success'].includes(normalized)) return 'completed';
  if (['failed', 'error', 'cancelled', 'canceled'].includes(normalized)) return 'failed';
  return 'pending';
}

function extractFailureReason(payload) {
  return payload?.error?.message || payload?.error || payload?.message || payload?.detail || 'unknown error';
}

function resolveArtifactUrl(status, format, baseUrl, jobId) {
  const direct = findArtifactUrl(status, format);
  if (direct) {
    if (direct.startsWith('http://') || direct.startsWith('https://')) return direct;
    return new URL(direct, `${baseUrl}/`).toString();
  }
  return joinUrl(baseUrl, renderTemplate(DEFAULT_RESULT_TEMPLATE, { jobId, format }));
}

function findArtifactUrl(payload, format) {
  const candidates = [
    payload?.result?.[format],
    payload?.result?.downloads?.[format],
    payload?.result?.files?.[format],
    payload?.downloads?.[format],
    payload?.files?.[format],
    payload?.artifacts?.[format],
    payload?.output_files?.[format],
  ];

  for (const candidate of candidates) {
    if (!candidate) continue;
    if (typeof candidate === 'string') return candidate;
    if (typeof candidate?.url === 'string') return candidate.url;
    if (typeof candidate?.download_url === 'string') return candidate.download_url;
    if (typeof candidate?.href === 'string') return candidate.href;
  }

  return null;
}

async function copyArtifact(sourcePath, targetPath) {
  const resolved = targetPath.startsWith('/') ? targetPath : join(process.cwd(), targetPath);
  await mkdir(dirname(resolved), { recursive: true });
  const sourceStat = await stat(sourcePath);
  const targetExists = await stat(resolved).catch(() => null);
  if (!targetExists || targetExists.size !== sourceStat.size) {
    await copyFile(sourcePath, resolved);
  }
  return resolved;
}

async function safeReadJson(response) {
  const text = await response.text();
  if (!text.trim()) return {};
  return JSON.parse(text);
}

async function safeReadText(response) {
  try {
    return (await response.text()).trim();
  } catch {
    return '';
  }
}

function renderTemplate(template, values) {
  return template.replace(/\{(\w+)\}/g, (_, key) => values[key] ?? '');
}

function joinUrl(baseUrl, path) {
  return `${baseUrl.replace(/\/+$/, '')}/${String(path || '').replace(/^\/+/, '')}`;
}

async function fetchKlangio(url, init) {
  try {
    return await fetch(url, init);
  } catch (err) {
    throw new Error(`Could not reach Klangio endpoint ${url}: ${err.message}`);
  }
}

async function writeLog(logPath, lines) {
  if (!logPath) return;
  try {
    await mkdir(dirname(logPath), { recursive: true });
    await writeFile(logPath, lines.filter(Boolean).join('\n'), 'utf-8');
  } catch {
    // non-fatal
  }
}

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}
