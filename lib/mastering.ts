/**
 * @fileoverview Turning masters into the files the app ships.
 *
 * Masters are never modified. Everything here reads a master and writes beside
 * it, so the whole pass can be re-run after changing any constant without
 * anyone having to record again.
 *
 * The pass is also incremental. A take whose delivered file is newer than its
 * master is left alone, which means running it after a session costs only that
 * session.
 */

import {spawnSync} from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';

import {
  DELIVERY_BITRATE_BITS_PER_SECOND,
  HIGH_PASS_CUTOFF_HERTZ,
  LEAD_IN_PADDING_MILLISECONDS,
  TAIL_PADDING_MILLISECONDS,
  TARGET_LOUDNESS_LUFS,
  TARGET_LOUDNESS_RANGE,
  TARGET_TRUE_PEAK_DECIBELS,
  TRIM_THRESHOLD_DECIBELS,
  CAPTURE_SAMPLE_RATE_HERTZ,
  CAPTURE_CHANNEL_COUNT,
} from './audio-constants';
import type {StudioConfig} from './studio-config';
import {deriveLedgerState, readLedger, type RoomToneCapture} from './take-ledger';
import {toMasterFilePath} from './take-storage';

const DELIVERY_FOLDER = 'delivery';
const ARCHIVE_FOLDER = 'archive';

/**
 * Noise floors outside this range are ignored.
 *
 * A room tone that measures very high means something was making noise during
 * the capture, and a floor that measures near silence means the microphone was
 * muted. Either would make the denoiser destructive, so an implausible reading
 * falls back to a conservative default rather than being trusted.
 */
const PLAUSIBLE_NOISE_FLOOR_RANGE = {lowest: -80, highest: -30} as const;
const FALLBACK_NOISE_FLOOR_DECIBELS = -50;

/**
 * Room for everything ffmpeg prints about one take.
 *
 * The default of one megabyte is ample for a few seconds of audio, but a
 * truncated log would silently cut off the loudness report the second pass
 * depends on.
 */
const FFMPEG_OUTPUT_BUFFER_BYTES = 8 * 1024 * 1024;

/** What one pass over the recordings did. */
export interface MasteringReport {
  mastered: string[];
  skipped: string[];
  failed: Array<{audioPath: string; reason: string}>;
}

/** Whether ffmpeg can be found on this machine. */
export function isFfmpegAvailable(): boolean {
  return spawnSync('ffmpeg', ['-version'], {stdio: 'ignore'}).status === 0;
}

/** Absolute path of the delivered file for one take. */
export function toDeliveryFilePath(config: StudioConfig, audioPath: string): string {
  return path.join(config.dataPath, DELIVERY_FOLDER, audioPath);
}

/** Absolute path of the lossless archive copy for one take. */
export function toArchiveFilePath(config: StudioConfig, audioPath: string): string {
  return path.join(config.dataPath, ARCHIVE_FOLDER, audioPath.replace(/\.m4a$/, '.flac'));
}

/**
 * Masters every take that needs it.
 *
 * @param onProgress Called before each take so a long run can report itself.
 * @returns What was done, so the caller can print a summary.
 */
export function masterAllTakes(
  config: StudioConfig,
  onProgress?: (audioPath: string, index: number, total: number) => void,
): MasteringReport {
  if (!isFfmpegAvailable()) {
    throw new Error('ffmpeg is not installed. Install it with: brew install ffmpeg');
  }

  const entries = readLedger(config.dataPath);
  const state = deriveLedgerState(entries);
  const noiseFloorBySession = measureNoiseFloors(entries);

  const takes = [...state.takesByItemId.values()];
  const report: MasteringReport = {mastered: [], skipped: [], failed: []};

  takes.forEach((take, index) => {
    onProgress?.(take.audioPath, index, takes.length);

    const masterPath = toMasterFilePath(config, take.audioPath);
    const deliveryPath = toDeliveryFilePath(config, take.audioPath);

    if (!fs.existsSync(masterPath)) {
      report.failed.push({audioPath: take.audioPath, reason: 'master is missing'});
      return;
    }

    if (isUpToDate(masterPath, deliveryPath)) {
      report.skipped.push(take.audioPath);
      return;
    }

    try {
      const noiseFloor =
        noiseFloorBySession.get(take.sessionId) ?? FALLBACK_NOISE_FLOOR_DECIBELS;
      masterOneTake(masterPath, deliveryPath, toArchiveFilePath(config, take.audioPath), noiseFloor);
      report.mastered.push(take.audioPath);
    } catch (cause) {
      report.failed.push({
        audioPath: take.audioPath,
        reason: cause instanceof Error ? cause.message : String(cause),
      });
    }
  });

  return report;
}

/** Whether a delivered file already reflects its master. */
function isUpToDate(masterPath: string, deliveryPath: string): boolean {
  if (!fs.existsSync(deliveryPath)) {
    return false;
  }
  return fs.statSync(deliveryPath).mtimeMs >= fs.statSync(masterPath).mtimeMs;
}

/**
 * The noise floor one session's takes are cleaned against.
 *
 * Exported for the preview pass, which masters a single take while the speaker
 * is still holding it and needs the same floor the batch pass would use. Reading
 * it from the same place is what makes the preview trustworthy: a preview
 * produced by different numbers is not a preview.
 *
 * @param sessionId Empty before a room tone has been captured, which yields the
 *     conservative fallback rather than an error.
 */
export function findSessionNoiseFloor(config: StudioConfig, sessionId: string): number {
  const floors = measureNoiseFloors(readLedger(config.dataPath));
  return floors.get(sessionId) ?? FALLBACK_NOISE_FLOOR_DECIBELS;
}

/**
 * Reads each session's noise floor from its room tone capture.
 *
 * The average level of three seconds of nobody speaking is the floor the
 * denoiser is told to remove.
 */
function measureNoiseFloors(entries: ReturnType<typeof readLedger>): Map<string, number> {
  const floors = new Map<string, number>();

  for (const entry of entries) {
    if (entry.kind !== 'room-tone') {
      continue;
    }
    const capture = entry as RoomToneCapture;
    const measured = capture.analysis.rootMeanSquareDecibels;
    const plausible =
      measured >= PLAUSIBLE_NOISE_FLOOR_RANGE.lowest &&
      measured <= PLAUSIBLE_NOISE_FLOOR_RANGE.highest;
    floors.set(capture.sessionId, plausible ? measured : FALLBACK_NOISE_FLOOR_DECIBELS);
  }

  return floors;
}

/** The cleanup applied to every take, in the order it has to happen. */
function buildFilterChain(noiseFloorDecibels: number): string {
  const leadInSeconds = LEAD_IN_PADDING_MILLISECONDS / 1000;
  const tailSeconds = TAIL_PADDING_MILLISECONDS / 1000;
  const trim = (keepSeconds: number): string =>
    `silenceremove=start_periods=1:start_silence=${keepSeconds}` +
    `:start_threshold=${TRIM_THRESHOLD_DECIBELS}dB:detection=peak`;

  return [
    `highpass=f=${HIGH_PASS_CUTOFF_HERTZ}`,
    `afftdn=nf=${noiseFloorDecibels.toFixed(1)}`,
    trim(leadInSeconds),
    // Trimming only ever works from the front, so the tail is reached by
    // reversing, trimming the new front, and reversing back.
    'areverse',
    trim(tailSeconds),
    'areverse',
  ].join(',');
}

/**
 * Produces the delivered file and the archive copy for one take.
 *
 * Loudness normalisation runs in two passes. The first measures the take, the
 * second corrects it by exactly that amount. A single pass guesses from a
 * running estimate and drifts between takes, which over thirteen sittings is
 * audible as the volume stepping up and down between words.
 */
function masterOneTake(
  masterPath: string,
  deliveryPath: string,
  archivePath: string,
  noiseFloorDecibels: number,
): void {
  fs.mkdirSync(path.dirname(archivePath), {recursive: true});

  renderDeliveryFile(masterPath, deliveryPath, noiseFloorDecibels);

  // The archive keeps the untouched recording, not the cleaned one, so a change
  // to any constant above can be applied later without loss.
  runFfmpeg(['-y', '-i', masterPath, '-c:a', 'flac', archivePath]);
}

/**
 * Cleans, normalises and encodes one recording into the file the app ships.
 *
 * The single source of what a delivered take sounds like. The batch pass and the
 * preview the speaker hears while recording both come through here, because a
 * preview produced by a second copy of this chain would drift from it and stop
 * being a preview of anything.
 *
 * @param sourcePath A master, or any WAV in the same shape.
 * @param noiseFloorDecibels From the session's room tone; see
 *     {@link findSessionNoiseFloor}.
 */
export function renderDeliveryFile(
  sourcePath: string,
  deliveryPath: string,
  noiseFloorDecibels: number,
): void {
  fs.mkdirSync(path.dirname(deliveryPath), {recursive: true});

  const cleanup = buildFilterChain(noiseFloorDecibels);
  const measured = measureLoudness(sourcePath, cleanup);

  const loudnorm = [
    `loudnorm=I=${TARGET_LOUDNESS_LUFS}`,
    `TP=${TARGET_TRUE_PEAK_DECIBELS}`,
    `LRA=${TARGET_LOUDNESS_RANGE}`,
    `measured_I=${measured.input_i}`,
    `measured_TP=${measured.input_tp}`,
    `measured_LRA=${measured.input_lra}`,
    `measured_thresh=${measured.input_thresh}`,
    `offset=${measured.target_offset}`,
    'linear=true',
    'print_format=summary',
  ].join(':');

  runFfmpeg([
    '-y',
    '-i',
    sourcePath,
    '-af',
    `${cleanup},${loudnorm}`,
    '-c:a',
    'aac',
    '-b:a',
    String(DELIVERY_BITRATE_BITS_PER_SECOND),
    '-ar',
    String(CAPTURE_SAMPLE_RATE_HERTZ),
    '-ac',
    String(CAPTURE_CHANNEL_COUNT),
    // Moves the index to the front of the file. ffmpeg writes it last by
    // default, which means a player has to have the whole file before it can
    // begin — wrong for a phone opening one of two thousand of these, and
    // enough on its own to make Safari refuse to decode the take at all.
    '-movflags',
    '+faststart',
    deliveryPath,
  ]);
}

/**
 * Decodes a delivered take back to plain PCM.
 *
 * For the preview, and it exists because of what a browser will and will not
 * accept. `decodeAudioData` is fussy about AAC in an MP4 — Safari rejects files
 * that ffmpeg, Chromium and every command-line tool read without complaint — and
 * a preview that fails to decode falls back to the raw capture, which makes the
 * processing look as though it does nothing.
 *
 * Decoding here rather than encoding something else keeps the preview honest.
 * What comes back is the delivered file, exactly as it will ship, in a container
 * no browser has ever had trouble with.
 *
 * @param sourcePath The delivered `.m4a`.
 * @param wavPath Where to write the 16-bit PCM.
 */
export function decodeToWav(sourcePath: string, wavPath: string): void {
  runFfmpeg([
    '-y',
    '-i',
    sourcePath,
    '-c:a',
    'pcm_s16le',
    '-ar',
    String(CAPTURE_SAMPLE_RATE_HERTZ),
    '-ac',
    String(CAPTURE_CHANNEL_COUNT),
    wavPath,
  ]);
}

/** The measurements ffmpeg's loudness normaliser prints after its first pass. */
interface LoudnessMeasurement {
  input_i: string;
  input_tp: string;
  input_lra: string;
  input_thresh: string;
  target_offset: string;
}

/** Runs the measuring pass and reads its report. */
function measureLoudness(masterPath: string, cleanup: string): LoudnessMeasurement {
  const output = runFfmpeg([
    '-i',
    masterPath,
    '-af',
    `${cleanup},loudnorm=I=${TARGET_LOUDNESS_LUFS}:TP=${TARGET_TRUE_PEAK_DECIBELS}` +
      `:LRA=${TARGET_LOUDNESS_RANGE}:print_format=json`,
    '-f',
    'null',
    '-',
  ]);

  // The report is printed to the log, so the JSON has to be found within it.
  const start = output.lastIndexOf('{');
  const end = output.lastIndexOf('}');
  if (start === -1 || end === -1) {
    throw new Error('ffmpeg printed no loudness measurement.');
  }

  return JSON.parse(output.slice(start, end + 1)) as LoudnessMeasurement;
}

/**
 * Runs ffmpeg and returns everything it printed on either stream.
 *
 * ffmpeg writes its reports to standard error even when nothing has gone wrong,
 * and the loudness measurement is one of those reports. Both streams are
 * returned together so the caller does not have to know which one it landed on.
 *
 * @throws If ffmpeg exits non-zero, quoting the last few lines it printed.
 */
function runFfmpeg(args: string[]): string {
  const result = spawnSync('ffmpeg', ['-hide_banner', '-nostdin', ...args], {
    encoding: 'utf8',
    maxBuffer: FFMPEG_OUTPUT_BUFFER_BYTES,
  });

  const output = `${result.stdout ?? ''}\n${result.stderr ?? ''}`;

  if (result.status !== 0) {
    const detail = output.trim().split('\n').slice(-3).join(' ');
    throw new Error(`ffmpeg failed: ${detail}`);
  }

  return output;
}
