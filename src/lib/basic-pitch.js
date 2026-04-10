import { access, mkdir } from 'fs/promises';
import { constants } from 'fs';
import { basename, dirname, extname, join } from 'path';
import { spawn } from 'child_process';

export async function resolveBasicPitchBinary(explicitPath) {
  const candidates = [explicitPath, 'basic-pitch'].filter(Boolean);
  for (const candidate of candidates) {
    const resolved = await resolveBinary(candidate);
    if (resolved) return resolved;
  }

  throw new Error("Basic Pitch dependency not found. Install it with 'pip install basic-pitch' so the 'basic-pitch' CLI is available, or pass --basic-pitch-bin <path>.");
}

export async function ensureAudioInput(pathname) {
  const resolved = pathname.startsWith('/') ? pathname : join(process.cwd(), pathname);
  try {
    await access(resolved, constants.R_OK);
    return resolved;
  } catch {
    throw new Error(`Audio input not found: ${resolved}`);
  }
}

export function resolveMidiOutputPath(audioPath, outPath) {
  if (outPath) {
    return outPath.startsWith('/') ? outPath : join(process.cwd(), outPath);
  }

  const stem = basename(audioPath, extname(audioPath));
  return join(process.cwd(), 'midis', `${stem}.mid`);
}

export async function runBasicPitchCli({ binary, audioPath, midiOutPath, extraArgs = [], logPath }) {
  const outputDir = dirname(midiOutPath);
  await mkdir(outputDir, { recursive: true });
  const args = [outputDir, audioPath, ...extraArgs];

  const { stdout, stderr } = await spawnAndCapture(binary, args);

  const expectedMidi = join(outputDir, `${basename(audioPath, extname(audioPath))}_basic_pitch.mid`);
  const finalMidi = await movePredictedMidi(expectedMidi, midiOutPath);

  if (logPath) {
    await mkdir(dirname(logPath), { recursive: true });
    await import('fs/promises').then(({ writeFile }) => writeFile(logPath, `${stdout}\n${stderr}`.trim(), 'utf-8')).catch(() => {});
  }

  return { stdout, stderr, midiPath: finalMidi };
}

async function movePredictedMidi(expectedMidi, targetMidi) {
  const { rename, copyFile, unlink } = await import('fs/promises');

  try {
    await access(expectedMidi, constants.R_OK);
  } catch {
    throw new Error(`Basic Pitch did not produce the expected MIDI file: ${expectedMidi}`);
  }

  if (expectedMidi === targetMidi) return targetMidi;

  await mkdir(dirname(targetMidi), { recursive: true });
  try {
    await rename(expectedMidi, targetMidi);
  } catch {
    await copyFile(expectedMidi, targetMidi);
    await unlink(expectedMidi).catch(() => {});
  }

  return targetMidi;
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
        reject(new Error((stderr || stdout || `Basic Pitch exited with code ${code}`).trim()));
        return;
      }
      resolve({ stdout, stderr });
    });
  });
}
