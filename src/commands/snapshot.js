/**
 * snapshot command
 *
 * Usage:
 *   ableton-composer snapshot                       (save all tracks)
 *   ableton-composer snapshot --tracks "Bass,Lead"  (save specific tracks)
 *   ableton-composer snapshot --out my-snap.json    (save to explicit path)
 *   ableton-composer snapshot --restore snap.json   (restore parameters)
 */

import chalk from 'chalk';
import ora from 'ora';
import { writeFile, readFile, mkdir } from 'fs/promises';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import { connect, disconnect, getMidiTracks } from '../lib/ableton.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, '../../');

export async function snapshotCommand(options) {
  const spinner = ora();

  try {
    if (options.restore) {
      await restoreSnapshot(options.restore, spinner);
    } else {
      await saveSnapshot(options, spinner);
    }
  } catch (err) {
    spinner.fail(err.message);
    console.log(chalk.dim('\n  Make sure the ableton-js M4L patch is loaded in your Live set.'));
    process.exit(1);
  } finally {
    await disconnect();
  }
}

// ─── save ────────────────────────────────────────────────────────────────────

async function saveSnapshot(options, spinner) {
  spinner.start('Connecting to Ableton Live...');
  const ableton = await connect();
  spinner.succeed('Connected');

  const filterNames = options.tracks
    ? new Set(options.tracks.split(',').map(s => s.trim()))
    : null;

  spinner.start('Reading device parameters...');

  const [setName, setPath] = await Promise.all([
    ableton.song.get('name').catch(() => null),
    ableton.song.get('file_path').catch(() => null),
  ]);

  const allTracks = await getMidiTracks(ableton);
  const tracks = filterNames
    ? allTracks.filter(t => filterNames.has(t.name))
    : allTracks;

  const snapshot = {
    created_at: new Date().toISOString(),
    set_name:   setName,
    set_path:   setPath,
    tracks: [],
  };

  for (const { name, track } of tracks) {
    const trackEntry = { name, devices: [] };

    try {
      const devices = await track.get('devices');

      for (const device of devices) {
        const [deviceName, deviceClass] = await Promise.all([
          device.get('name'),
          device.get('class_display_name').catch(() => null),
        ]);
        const deviceEntry = { name: deviceName, class: deviceClass, parameters: {} };

        try {
          const params = await device.get('parameters');
          for (const param of params) {
            const [pName, pValue] = await Promise.all([
              param.get('name'),
              param.get('value'),
            ]);
            deviceEntry.parameters[pName] = pValue;
          }
        } catch {
          // Device has no parameters — record it with empty params
        }

        trackEntry.devices.push(deviceEntry);
      }
    } catch {
      // Track has no devices — still include the track entry
    }

    snapshot.tracks.push(trackEntry);
  }

  const deviceTotal  = snapshot.tracks.reduce((s, t) => s + t.devices.length, 0);
  const paramTotal   = snapshot.tracks.reduce((s, t) =>
    s + t.devices.reduce((ds, d) => ds + Object.keys(d.parameters).length, 0), 0
  );

  spinner.succeed(
    `Snapshotted ${tracks.length} track(s), ${deviceTotal} device(s), ${paramTotal} parameter(s)`
  );

  if (!setName) {
    console.log(chalk.yellow('  ⚠ Live set has no name — save your project (Cmd+S) to get named snapshots.'));
  }

  // ── resolve output path ───────────────────────────────────────────────────
  let outPath;
  if (options.out) {
    outPath = options.out;
  } else {
    const snapshotsDir = join(ROOT, 'snapshots');
    await mkdir(snapshotsDir, { recursive: true });
    const ts   = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
    const slug = setName
      ? setName.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '')
      : 'snapshot';
    outPath = join(snapshotsDir, `${slug}-${ts}.json`);
  }

  await writeFile(outPath, JSON.stringify(snapshot, null, 2), 'utf-8');

  console.log('');
  if (setName) console.log(chalk.dim(`  Set: ${setName}${setPath ? `  (${setPath})` : ''}`));
  console.log(chalk.green(`✓ Saved to ${outPath}`));
  console.log('');

  // ── print summary ─────────────────────────────────────────────────────────
  for (const t of snapshot.tracks) {
    const pCount = t.devices.reduce((s, d) => s + Object.keys(d.parameters).length, 0);
    console.log(
      chalk.cyan(`  ${t.name}`) +
      chalk.dim(` — ${t.devices.length} device(s), ${pCount} param(s)`)
    );
    for (const d of t.devices) {
      console.log(chalk.dim(`    ${d.name}: ${Object.keys(d.parameters).length} params`));
    }
  }

  console.log('');
  console.log(chalk.dim(`  Restore with: ableton-composer snapshot --restore ${outPath}`));
}

// ─── restore ─────────────────────────────────────────────────────────────────

async function restoreSnapshot(file, spinner) {
  const raw = await readFile(file, 'utf-8').catch(() => {
    throw new Error(`Snapshot file not found: ${file}`);
  });
  const snapshot = JSON.parse(raw);

  console.log(chalk.dim(`  Snapshot from: ${snapshot.created_at}`));
  console.log('');

  spinner.start('Connecting to Ableton Live...');
  const ableton = await connect();
  spinner.succeed('Connected');

  spinner.start('Restoring device parameters...');

  const liveTracks = await getMidiTracks(ableton);
  const liveTrackMap = new Map(liveTracks.map(t => [t.name, t.track]));

  let restored = 0;
  let skipped  = 0;

  for (const trackSnap of snapshot.tracks) {
    const liveTrack = liveTrackMap.get(trackSnap.name);

    if (!liveTrack) {
      spinner.warn(`Track "${trackSnap.name}" not found in Live set — skipped`);
      spinner.start('');
      skipped++;
      continue;
    }

    let liveDevices;
    try {
      liveDevices = await liveTrack.get('devices');
    } catch {
      skipped++;
      continue;
    }

    // Build a map of device name → device object (first occurrence wins)
    const liveDeviceMap = new Map();
    for (const dev of liveDevices) {
      const devName = await dev.get('name');
      if (!liveDeviceMap.has(devName)) {
        liveDeviceMap.set(devName, dev);
      }
    }

    for (const deviceSnap of trackSnap.devices) {
      const liveDev = liveDeviceMap.get(deviceSnap.name);

      if (!liveDev) {
        skipped++;
        continue;
      }

      let liveParams;
      try {
        liveParams = await liveDev.get('parameters');
      } catch {
        skipped++;
        continue;
      }

      // Build param name → param object map
      const liveParamMap = new Map();
      for (const param of liveParams) {
        const pName = await param.get('name');
        if (!liveParamMap.has(pName)) {
          liveParamMap.set(pName, param);
        }
      }

      for (const [paramName, paramValue] of Object.entries(deviceSnap.parameters)) {
        const liveParam = liveParamMap.get(paramName);
        if (!liveParam) {
          skipped++;
          continue;
        }
        try {
          await liveParam.set('value', paramValue);
          restored++;
        } catch {
          // Some parameters are read-only (e.g. "Device On") — skip silently
          skipped++;
        }
      }
    }
  }

  spinner.succeed(
    `Restored ${restored} parameter(s)` +
    (skipped > 0 ? chalk.dim(` (${skipped} skipped — not found or read-only)`) : '')
  );
  console.log('');
}
