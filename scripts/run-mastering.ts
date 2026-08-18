/**
 * @fileoverview `npm run master` — clean and encode everything recorded so far.
 *
 * Run after a session. The pass is incremental, so it costs only the takes that
 * session added, and it can be re-run after changing any constant in
 * `lib/audio-constants.ts` without anyone recording again.
 */

import path from 'node:path';

import {isFfmpegAvailable, masterAllTakes} from '../lib/mastering';
import {loadStudioConfig} from '../lib/studio-config';

/**
 * Return to the start of the line and erase it.
 *
 * Written as an escape rather than a literal control character, which survives
 * editors, diffs and copy-paste intact.
 */
const CLEAR_LINE = '\r\u001b[2K';

function main(): void {
  const config = loadStudioConfig(path.resolve(process.cwd()));

  if (!isFfmpegAvailable()) {
    console.error('ffmpeg is not installed. Install it with:\n\n  brew install ffmpeg\n');
    process.exitCode = 1;
    return;
  }

  // A carriage return only redraws a line on a terminal. Piped to a file or a
  // log it stacks up as unreadable padding, so progress is shown only when
  // someone is watching.
  const isTerminal = process.stdout.isTTY === true;

  const report = masterAllTakes(config, (audioPath, index, total) => {
    if (isTerminal) {
      process.stdout.write(`${CLEAR_LINE}[${index + 1}/${total}] ${audioPath}`);
    }
  });

  if (isTerminal) {
    process.stdout.write(CLEAR_LINE);
  }
  console.log(`mastered ${report.mastered.length}`);
  console.log(`already current ${report.skipped.length}`);

  if (report.failed.length) {
    console.error(`\nfailed ${report.failed.length}:`);
    for (const failure of report.failed) {
      console.error(`  ${failure.audioPath} — ${failure.reason}`);
    }
    process.exitCode = 1;
  }
}

main();
