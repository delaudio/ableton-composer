import { access, copyFile, mkdir, readdir, readFile, stat, writeFile } from 'fs/promises';
import { constants } from 'fs';
import { basename, dirname, extname, join } from 'path';
import { spawn } from 'child_process';
import { createHash } from 'crypto';
import { slugify } from './storage.js';

const STEM_BASENAMES = ['drums', 'bass', 'vocals', 'other'];

export async function ensureSeparationInput(pathname) {
  const resolved = pathname.startsWith('/') ? pathname : join(process.cwd(), pathname);
  try {
    await access(resolved, constants.R_OK);
    return resolved;
  } catch {
    throw new Error(`Audio input not found: ${resolved}`);
  }
}

export async function resolveDemucsBinary(explicitPath) {
  const candidates = [explicitPath, 'demucs'].filter(Boolean);
  for (const candidate of candidates) {
    const resolved = await resolveBinary(candidate);
    if (resolved) return resolved;
  }

  throw new Error("Demucs dependency not found. Install it with 'pip install demucs' so the 'demucs' CLI is available, or pass --demucs-bin <path>.");
}

export function resolveSeparationOutputDir(audioPath, outPath) {
  if (outPath) {
    return outPath.startsWith('/') ? outPath : join(process.cwd(), outPath);
  }

  const stem = basename(audioPath, extname(audioPath));
  return join(process.cwd(), 'stems', 'separated', slugify(stem) || stem || 'separation');
}

export async function runDemucsSeparation({
  binary,
  audioPath,
  outputDir,
  model = 'htdemucs',
  stems = STEM_BASENAMES,
  logPath,
}) {
  const tempRoot = join(outputDir, '_demucs-temp');
  await mkdir(tempRoot, { recursive: true });
  await mkdir(outputDir, { recursive: true });

  const args = ['--out', tempRoot, '-n', model, audioPath];
  const { stdout, stderr } = await spawnAndCapture(binary, args);

  const sourceStem = basename(audioPath, extname(audioPath));
  const demucsStemDir = join(tempRoot, model, sourceStem);
  await access(demucsStemDir, constants.R_OK).catch(() => {
    throw new Error(`Demucs did not produce the expected stem directory: ${demucsStemDir}`);
  });

  const outputs = [];
  for (const stemName of stems) {
    const sourceFile = await findStemFile(demucsStemDir, stemName);
    if (!sourceFile) continue;

    const targetPath = join(outputDir, `${stemName}${extname(sourceFile) || '.wav'}`);
    await copyFile(sourceFile, targetPath);
    outputs.push({ stem: stemName, path: targetPath });
  }

  if (outputs.length === 0) {
    throw new Error(`Demucs completed but no expected stems were found in ${demucsStemDir}`);
  }

  if (logPath) {
    await mkdir(dirname(logPath), { recursive: true });
    await writeFile(logPath, `${stdout}\n${stderr}`.trim(), 'utf-8').catch(() => {});
  }

  await import('fs/promises').then(({ rm }) => rm(tempRoot, { recursive: true, force: true })).catch(() => {});

  return { stdout, stderr, outputs, tempRoot, model };
}

export async function writeSeparationMetadata({
  sourcePath,
  engine,
  model,
  outputDir,
  outputs,
}) {
  const metadata = {
    type: 'stem-separation',
    version: '0.1',
    created_at: new Date().toISOString(),
    source_audio: {
      path: sourcePath,
      format: extname(sourcePath).replace(/^\./, '').toLowerCase() || 'audio',
      hash: await hashFile(sourcePath),
    },
    engine,
    model,
    stems: outputs.map(entry => ({
      name: entry.stem,
      path: entry.path,
      filename: basename(entry.path),
    })),
  };

  const target = join(outputDir, 'separation.json');
  await writeFile(target, JSON.stringify(metadata, null, 2), 'utf-8');
  return target;
}

async function findStemFile(dir, stemName) {
  const entries = await readdir(dir);
  const match = entries.find(entry => {
    const lower = entry.toLowerCase();
    return lower === `${stemName}.wav` || lower === `${stemName}.mp3` || lower === `${stemName}.flac`;
  });
  return match ? join(dir, match) : null;
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
    child.on('close', code => resolve(code === 0 ? (output.trim() || null) : null));
  });
}

function spawnAndCapture(command, args) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { stdio: ['ignore', 'pipe', 'pipe'] });
    let stdout = '';
    let stderr = '';

    child.stdout.on('data', chunk => { stdout += String(chunk); });
    child.stderr.on('data', chunk => { stderr += String(chunk); });
    child.on('error', reject);
    child.on('close', code => {
      if (code !== 0) {
        reject(new Error((stderr || stdout || `Demucs exited with code ${code}`).trim()));
        return;
      }
      resolve({ stdout, stderr });
    });
  });
}

async function hashFile(pathname) {
  const buffer = await readFile(pathname);
  return createHash('sha256').update(buffer).digest('hex').slice(0, 16);
}
