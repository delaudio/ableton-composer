const { spawn } = require('child_process');
const fs = require('fs');
const path = require('path');

const WATCH_DIRS = ['./content', './templates', './static', './styles'];
const BUILD_SCRIPT = path.join(__dirname, 'node_modules', 'minuto', 'build.js');
const SERVE_SCRIPT = path.join(__dirname, 'serve.cjs');

let building = false;
let needsRebuild = false;

function build() {
  if (building) {
    needsRebuild = true;
    return;
  }

  building = true;
  console.log('\nRebuilding...');

  const buildProcess = spawn(process.execPath, [BUILD_SCRIPT], {
    cwd: __dirname,
    stdio: 'inherit',
  });

  buildProcess.on('close', code => {
    building = false;
    if (code === 0) {
      console.log('Ready');
    }
    if (needsRebuild) {
      needsRebuild = false;
      build();
    }
  });
}

function watchDir(dir) {
  const absDir = path.join(__dirname, dir);
  if (!fs.existsSync(absDir)) return null;

  let debounceTimer;
  const watcher = fs.watch(absDir, { recursive: true }, (eventType, filename) => {
    if (!filename) return;
    if (
      filename.startsWith('.') ||
      filename.endsWith('~') ||
      filename.endsWith('.swp') ||
      filename.includes('.tmp')
    ) {
      return;
    }

    clearTimeout(debounceTimer);
    debounceTimer = setTimeout(() => {
      console.log(`Changed: ${path.join(dir, filename)}`);
      build();
    }, 100);
  });

  console.log(`Watching: ${dir}`);
  return watcher;
}

build();
WATCH_DIRS.forEach(watchDir);

console.log('Starting server...');
const serverProcess = spawn(process.execPath, [SERVE_SCRIPT], {
  cwd: __dirname,
  stdio: 'inherit',
});

process.on('SIGINT', () => {
  console.log('\nShutting down...');
  serverProcess.kill();
  process.exit(0);
});
