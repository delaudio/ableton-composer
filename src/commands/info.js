/**
 * info command — introspect the current Ableton Live set.
 * Shows tracks, devices, and clip slot states.
 *
 * Usage:
 *   ableton-composer info
 *   ableton-composer info --devices    (also show device parameters)
 */

import chalk from 'chalk';
import ora from 'ora';
import { connect, disconnect, getMidiTracks } from '../lib/ableton.js';

export async function infoCommand(options) {
  const spinner = ora('Connecting to Ableton Live...').start();

  try {
    const ableton = await connect();
    spinner.succeed('Connected');

    const [tempo, timeSignature, tracks] = await Promise.all([
      ableton.song.get('tempo'),
      ableton.song.get('signature_numerator').then(async n => {
        const d = await ableton.song.get('signature_denominator');
        return `${n}/${d}`;
      }),
      getMidiTracks(ableton),
    ]);

    console.log(chalk.bold(`\n Live Set Info\n`));
    console.log(`  BPM:            ${chalk.cyan(tempo)}`);
    console.log(`  Time signature: ${chalk.cyan(timeSignature)}`);
    console.log(`  MIDI tracks:    ${chalk.cyan(tracks.length)}\n`);

    console.log(chalk.bold('  Tracks\n'));

    for (const { index, name, track } of tracks) {
      console.log(`  ${chalk.cyan(`[${index}]`)} ${name}`);

      if (options.devices) {
        try {
          const devices = await track.get('devices');
          for (const device of devices) {
            const deviceName = await device.get('name');
            console.log(chalk.dim(`       Device: ${deviceName}`));

            if (options.params) {
              const params = await device.get('parameters');
              for (const param of params) {
                const [pName, pValue] = await Promise.all([
                  param.get('name'),
                  param.get('value'),
                ]);
                console.log(chalk.dim(`         ${pName}: ${pValue}`));
              }
            }
          }
        } catch {
          console.log(chalk.dim('       (no devices)'));
        }
      }
    }

    console.log('');
    console.log(chalk.dim('  Copy track names above into --tracks or your song JSON.'));
    console.log(chalk.dim('  Track names are case-sensitive.\n'));

  } catch (err) {
    spinner.fail(err.message);
    console.log(chalk.dim('\n  Make sure the ableton-js M4L patch is loaded in your Live set.'));
    process.exit(1);
  } finally {
    await disconnect();
  }
}
