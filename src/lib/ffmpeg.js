import { access, mkdir, readFile, writeFile } from 'fs/promises';
import { constants } from 'fs';
import { basename, dirname, join } from 'path';
import { spawn } from 'child_process';

export async function loadRenderChainPlanFile(pathname) {
  const resolvedPath = pathname.startsWith('/') ? pathname : join(process.cwd(), pathname);
  const raw = await readFile(resolvedPath, 'utf-8');
  const plan = JSON.parse(raw);
  validateRenderChainPlan(plan, resolvedPath);
  return { plan, resolvedPath };
}

export async function resolveFfmpegBinary(explicitPath) {
  const candidates = [
    explicitPath,
    process.env.FFMPEG_BIN,
    'ffmpeg',
  ].filter(Boolean);

  for (const candidate of candidates) {
    const resolved = await resolveBinary(candidate);
    if (resolved) return resolved;
  }

  throw new Error('ffmpeg not found. Install ffmpeg or pass --ffmpeg-bin <path>. This workflow is optional and only handles post-processing/mixdown, not MIDI instrument rendering.');
}

export function buildFfmpegMixdownInvocation(plan, options = {}) {
  const audioTracks = (plan.tracks || []).filter(track => track.source?.type === 'external-stem' && track.source?.stem_path);
  if (audioTracks.length === 0) {
    throw new Error('Render plan has no external audio stems available for ffmpeg mixdown. ffmpeg fallback only works on existing audio, not MIDI-only tracks.');
  }

  const outPath = resolveOutputPath(plan.outputs?.mixdown_path, options.out, 'mixdown.wav');
  const args = ['-y'];

  for (const track of audioTracks) {
    args.push('-i', track.source.stem_path);
  }

  const { filterGraph, finalLabel } = buildMixFilterGraph(audioTracks, {
    normalize: options.normalize === true || plan.render_settings?.normalize_master === true,
  });

  args.push(
    '-filter_complex', filterGraph,
    '-map', finalLabel,
    '-ar', String(plan.render_settings?.sample_rate || 44100),
    '-ac', String(plan.render_settings?.channels || 2),
  );

  if ((plan.render_settings?.bit_depth || 24) >= 24) {
    args.push('-c:a', 'pcm_s24le');
  } else {
    args.push('-c:a', 'pcm_s16le');
  }

  args.push(outPath);
  return { args, outPath, trackCount: audioTracks.length };
}

export function buildFfmpegConvertInvocation(inputPath, outputPath, options = {}) {
  const outPath = resolveOutputPath(null, outputPath, `converted-${basename(inputPath)}`);
  const args = ['-y', '-i', inputPath];

  if (options.sampleRate) args.push('-ar', String(parseInt(options.sampleRate, 10) || 44100));
  if (options.channels) args.push('-ac', String(parseInt(options.channels, 10) || 2));
  if (options.normalize) args.push('-af', 'loudnorm');
  if (options.codec) args.push('-c:a', String(options.codec));

  args.push(outPath);
  return { args, outPath };
}

export async function runFfmpeg(binaryPath, args, options = {}) {
  const cwd = options.cwd || process.cwd();
  const logPath = options.logPath || null;

  await mkdir(dirname(logPath || join(cwd, 'tmp.log')), { recursive: true }).catch(() => {});

  return new Promise((resolve, reject) => {
    const child = spawn(binaryPath, args, { cwd, stdio: ['ignore', 'pipe', 'pipe'] });
    let stdout = '';
    let stderr = '';

    child.stdout.on('data', chunk => {
      stdout += String(chunk);
    });
    child.stderr.on('data', chunk => {
      stderr += String(chunk);
    });
    child.on('error', reject);
    child.on('close', async code => {
      if (logPath) {
        await writeFile(logPath, `${stdout}\n${stderr}`.trim(), 'utf-8').catch(() => {});
      }

      if (code !== 0) {
        reject(new Error(`ffmpeg exited with code ${code}\n${stderr.trim() || stdout.trim()}`.trim()));
        return;
      }

      resolve({ stdout, stderr });
    });
  });
}

function buildMixFilterGraph(tracks, options = {}) {
  const stages = [];
  const labels = [];

  tracks.forEach((track, index) => {
    let current = `[${index}:a]`;
    const chain = [];
    const gainDb = Number(track.mix?.gain_db || 0);
    const pan = Number(track.mix?.pan || 0);

    if (Number.isFinite(gainDb) && gainDb !== 0) {
      chain.push(`volume=${gainDb}dB`);
    }

    if (Number.isFinite(pan) && pan !== 0) {
      const clamped = Math.max(-1, Math.min(1, pan));
      const left = (clamped <= 0 ? 1 : 1 - clamped).toFixed(3);
      const right = (clamped >= 0 ? 1 : 1 + clamped).toFixed(3);
      chain.push(`pan=stereo|FL=${left}*FL+${left}*FR|FR=${right}*FL+${right}*FR`);
    }

    if (chain.length > 0) {
      const label = `t${index}`;
      stages.push(`${current}${chain.join(',')}[${label}]`);
      current = `[${label}]`;
    }

    labels.push(current);
  });

  const mixLabel = 'mix';
  stages.push(`${labels.join('')}amix=inputs=${labels.length}:normalize=0[${mixLabel}]`);

  let finalLabel = `[${mixLabel}]`;
  if (options.normalize === true) {
    stages.push(`${finalLabel}loudnorm[master]`);
    finalLabel = '[master]';
  }

  return {
    filterGraph: stages.join(';'),
    finalLabel,
  };
}

async function resolveBinary(candidate) {
  if (!candidate) return null;

  if (candidate.includes('/')) {
    try {
      await access(candidate, constants.X_OK);
      return candidate;
    } catch {
      return null;
    }
  }

  return new Promise(resolve => {
    const child = spawn('which', [candidate], { stdio: ['ignore', 'pipe', 'ignore'] });
    let output = '';
    child.stdout.on('data', chunk => { output += String(chunk); });
    child.on('error', () => resolve(null));
    child.on('close', code => {
      if (code !== 0) {
        resolve(null);
        return;
      }
      resolve(output.trim() || null);
    });
  });
}

function resolveOutputPath(planPath, overridePath, fallbackName) {
  if (overridePath) {
    return overridePath.startsWith('/') ? overridePath : join(process.cwd(), overridePath);
  }
  if (planPath) {
    return planPath.startsWith('/') ? planPath : join(process.cwd(), planPath);
  }
  return join(process.cwd(), fallbackName);
}

function validateRenderChainPlan(plan, resolvedPath) {
  if (!plan || typeof plan !== 'object') {
    throw new Error(`Invalid render chain plan: ${resolvedPath}`);
  }
  if (plan.type !== 'render-chain') {
    throw new Error(`Unsupported render chain plan type in ${resolvedPath}; expected "render-chain"`);
  }
  if (!Array.isArray(plan.tracks)) {
    throw new Error(`Render chain plan tracks missing or invalid: ${resolvedPath}`);
  }
}
