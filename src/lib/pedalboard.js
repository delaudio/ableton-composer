import { access, mkdir, readFile, writeFile } from 'fs/promises';
import { constants } from 'fs';
import { join, dirname } from 'path';
import { spawn } from 'child_process';

const DEFAULT_WORKER = join(process.cwd(), 'scripts', 'pedalboard_render.py');

export async function loadRenderPlanForPedalboard(pathname) {
  const resolvedPath = pathname.startsWith('/') ? pathname : join(process.cwd(), pathname);
  const raw = await readFile(resolvedPath, 'utf-8');
  const plan = JSON.parse(raw);
  validateRenderChainPlan(plan, resolvedPath);
  return { plan, resolvedPath };
}

export async function resolvePythonBinary(explicitPath) {
  const candidates = [
    explicitPath,
    process.env.PYTHON_BIN,
    'python3',
    'python',
  ].filter(Boolean);

  for (const candidate of candidates) {
    const resolved = await resolveBinary(candidate);
    if (resolved) return resolved;
  }

  throw new Error('Python not found. Install Python 3 or pass --python-bin <path>. Pedalboard rendering is optional and disabled by default.');
}

export async function ensurePedalboardWorker(workerPath = DEFAULT_WORKER) {
  const resolved = workerPath.startsWith('/') ? workerPath : join(process.cwd(), workerPath);
  try {
    await access(resolved, constants.R_OK);
    return resolved;
  } catch {
    throw new Error(`Pedalboard worker script not found: ${resolved}`);
  }
}

export async function runPedalboardWorker({ pythonBin, workerPath, planPath, outDir, mode = 'stems', logPath }) {
  const args = [workerPath, '--plan', planPath, '--mode', mode];
  if (outDir) args.push('--out', outDir);

  await mkdir(dirname(logPath || join(process.cwd(), 'tmp.log')), { recursive: true }).catch(() => {});

  return new Promise((resolve, reject) => {
    const child = spawn(pythonBin, args, { stdio: ['ignore', 'pipe', 'pipe'] });
    let stdout = '';
    let stderr = '';

    child.stdout.on('data', chunk => { stdout += String(chunk); });
    child.stderr.on('data', chunk => { stderr += String(chunk); });
    child.on('error', reject);
    child.on('close', async code => {
      if (logPath) {
        await writeFile(logPath, `${stdout}\n${stderr}`.trim(), 'utf-8').catch(() => {});
      }

      if (code !== 0) {
        reject(new Error((stderr || stdout || `Pedalboard worker exited with code ${code}`).trim()));
        return;
      }

      const parsed = tryParseJson(stdout.trim());
      resolve({ stdout, stderr, result: parsed });
    });
  });
}

function tryParseJson(value) {
  try {
    return JSON.parse(value);
  } catch {
    return null;
  }
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
