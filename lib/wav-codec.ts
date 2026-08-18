/**
 * @fileoverview Lossless capture format, and the measurements taken from it.
 *
 * Takes are captured as uncompressed WAV rather than through `MediaRecorder`,
 * which offers no lossless container. The master is the only artefact that
 * cannot be produced again without speaking into a microphone, so it keeps
 * every bit the microphone sent.
 *
 * This module runs in both the browser and the server. The browser encodes what
 * it captured. The server decodes it to measure the take before storing it.
 * Sharing one implementation is what stops the two from disagreeing about what
 * a sample is.
 */

import {
  CLIPPING_PEAK_DECIBELS,
  MAXIMUM_LEADING_SILENCE_MILLISECONDS,
  MAXIMUM_TAKE_DURATION_MILLISECONDS,
  MINIMUM_TAKE_DURATION_MILLISECONDS,
  SILENCE_DECIBELS,
  SILENCE_THRESHOLD_AMPLITUDE,
  TOO_QUIET_PEAK_DECIBELS,
} from './audio-constants';

/** Uncompressed audio, decoded from a WAV file or on its way into one. */
export interface DecodedAudio {
  /** Interleaved is never needed here; the studio records one channel. */
  samples: Float32Array;
  sampleRateHertz: number;
  channelCount: number;
}

/** What the studio measures about a take, stored alongside it forever. */
export interface TakeAnalysis {
  durationMilliseconds: number;
  /** Loudest sample, in dBFS. Zero is full scale. */
  peakDecibels: number;
  /** Average level, in dBFS. Roughly how loud the take feels. */
  rootMeanSquareDecibels: number;
  /** Silence before the first sound. Trimmed during mastering. */
  leadingSilenceMilliseconds: number;
}

/**
 * Something worth the speaker's attention about a take.
 *
 * Never a reason to reject one, with a single exception: `capture-fault` says
 * the recording does not describe what was said, and that take has to go.
 */
export interface QualityWarning {
  kind:
    | 'clipped'
    | 'too-quiet'
    | 'too-short'
    | 'too-long'
    | 'slow-start'
    | 'capture-fault';
  message: string;
}

const WAV_HEADER_BYTES = 44;
const BITS_PER_SAMPLE = 16;
const BYTES_PER_SAMPLE = BITS_PER_SAMPLE / 8;
const PCM_FORMAT_TAG = 1;

/** Largest magnitude a signed 16-bit sample can hold. */
const SIGNED_16_BIT_SCALE = 0x7fff;

/**
 * Writes samples into a 16-bit PCM WAV file.
 *
 * Sixteen bits is chosen over twenty-four deliberately. With sensible gain
 * staging it puts the quantisation floor far below any room, it halves the size
 * of every master, and the delivered file is a 48 kbps AAC regardless.
 *
 * @param audio Samples in the range −1 to 1. Values outside it are clamped.
 * @returns A complete WAV file, ready to write to disk or POST.
 */
export function encodeWav(audio: DecodedAudio): Uint8Array {
  const {samples, sampleRateHertz, channelCount} = audio;
  const dataBytes = samples.length * BYTES_PER_SAMPLE;
  const buffer = new ArrayBuffer(WAV_HEADER_BYTES + dataBytes);
  const view = new DataView(buffer);

  const writeAscii = (offset: number, text: string): void => {
    for (let index = 0; index < text.length; index += 1) {
      view.setUint8(offset + index, text.charCodeAt(index));
    }
  };

  const byteRate = sampleRateHertz * channelCount * BYTES_PER_SAMPLE;

  writeAscii(0, 'RIFF');
  view.setUint32(4, WAV_HEADER_BYTES - 8 + dataBytes, true);
  writeAscii(8, 'WAVE');
  writeAscii(12, 'fmt ');
  view.setUint32(16, 16, true);
  view.setUint16(20, PCM_FORMAT_TAG, true);
  view.setUint16(22, channelCount, true);
  view.setUint32(24, sampleRateHertz, true);
  view.setUint32(28, byteRate, true);
  view.setUint16(32, channelCount * BYTES_PER_SAMPLE, true);
  view.setUint16(34, BITS_PER_SAMPLE, true);
  writeAscii(36, 'data');
  view.setUint32(40, dataBytes, true);

  for (let index = 0; index < samples.length; index += 1) {
    const clamped = Math.max(-1, Math.min(1, samples[index]));
    view.setInt16(WAV_HEADER_BYTES + index * BYTES_PER_SAMPLE, clamped * SIGNED_16_BIT_SCALE, true);
  }

  return new Uint8Array(buffer);
}

/**
 * Reads a 16-bit PCM WAV file back into samples.
 *
 * Only the format this studio writes is supported. Anything else is a sign that
 * a file arrived from somewhere unexpected, which is worth failing on rather
 * than interpreting.
 *
 * @throws If the bytes are not a 16-bit PCM WAV file.
 */
export function decodeWav(bytes: Uint8Array): DecodedAudio {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);

  const readAscii = (offset: number, length: number): string => {
    let text = '';
    for (let index = 0; index < length; index += 1) {
      text += String.fromCharCode(view.getUint8(offset + index));
    }
    return text;
  };

  if (bytes.byteLength < WAV_HEADER_BYTES || readAscii(0, 4) !== 'RIFF' || readAscii(8, 4) !== 'WAVE') {
    throw new Error('Not a WAV file.');
  }

  const formatTag = view.getUint16(20, true);
  const bitsPerSample = view.getUint16(34, true);
  if (formatTag !== PCM_FORMAT_TAG || bitsPerSample !== BITS_PER_SAMPLE) {
    throw new Error(`Expected 16-bit PCM, found format ${formatTag} at ${bitsPerSample} bits.`);
  }

  const channelCount = view.getUint16(22, true);
  const sampleRateHertz = view.getUint32(24, true);
  const dataBytes = view.getUint32(40, true);
  const sampleCount = Math.min(dataBytes, bytes.byteLength - WAV_HEADER_BYTES) / BYTES_PER_SAMPLE;

  const samples = new Float32Array(sampleCount);
  for (let index = 0; index < sampleCount; index += 1) {
    samples[index] = view.getInt16(WAV_HEADER_BYTES + index * BYTES_PER_SAMPLE, true) / SIGNED_16_BIT_SCALE;
  }

  return {samples, sampleRateHertz, channelCount};
}

/**
 * Converts an amplitude to decibels relative to full scale.
 *
 * Digital silence is negative infinity, which neither survives JSON nor sorts.
 * It is reported as a finite floor instead.
 */
export function toDecibels(amplitude: number): number {
  if (amplitude <= 0) {
    return SILENCE_DECIBELS;
  }
  return Math.max(SILENCE_DECIBELS, 20 * Math.log10(amplitude));
}

/**
 * Measures a take.
 *
 * The measurements are stored with the take and never recomputed, so a take
 * recorded in the first session can still be compared against one from the
 * last.
 */
export function analyseTake(audio: DecodedAudio): TakeAnalysis {
  const {samples, sampleRateHertz} = audio;

  let peak = 0;
  let sumOfSquares = 0;
  for (let index = 0; index < samples.length; index += 1) {
    const magnitude = Math.abs(samples[index]);
    if (magnitude > peak) {
      peak = magnitude;
    }
    sumOfSquares += samples[index] * samples[index];
  }

  const rootMeanSquare = samples.length ? Math.sqrt(sumOfSquares / samples.length) : 0;
  const samplesPerMillisecond = sampleRateHertz / 1000;

  let firstSound = samples.length;
  for (let index = 0; index < samples.length; index += 1) {
    if (Math.abs(samples[index]) >= SILENCE_THRESHOLD_AMPLITUDE) {
      firstSound = index;
      break;
    }
  }

  return {
    durationMilliseconds: Math.round(samples.length / samplesPerMillisecond),
    peakDecibels: Number(toDecibels(peak).toFixed(1)),
    rootMeanSquareDecibels: Number(toDecibels(rootMeanSquare).toFixed(1)),
    leadingSilenceMilliseconds: Math.round(firstSound / samplesPerMillisecond),
  };
}

/**
 * How far the recorded length may differ from the time that actually passed.
 *
 * The absolute floor covers the millisecond or two of latency between the main
 * thread starting its clock and the audio thread starting to send blocks, which
 * would otherwise trip the check on a very short take.
 */
const DURATION_TOLERANCE_FRACTION = 0.05;
const DURATION_TOLERANCE_FLOOR_MILLISECONDS = 60;

/**
 * Checks that the recording is as long as the time it took to make it.
 *
 * Two independent clocks measure one take: the number of samples captured, and
 * the wall clock. They must agree. When they do not, the samples are not a
 * faithful record of what was said and the take is worthless however good it
 * measures — peak and level are still correct readings of a corrupt buffer.
 *
 * This exists because that failure has happened. Two capture graphs once pushed
 * into one buffer, and a two-second take reported 3.90 s of doubled, interleaved
 * audio that sounded like an engine. Nothing else in this file could have caught
 * it. The same check also catches dropped blocks and a sample rate that is not
 * the one being assumed.
 *
 * The two directions are different faults and are reported as such. **More**
 * audio than time is the corruption signature: samples that were never spoken
 * are in the buffer, and nothing about the take can be trusted. **Less** audio
 * than time means some of it never arrived — the take is a faithful record of
 * part of what was said, and what is missing is at the end.
 *
 * Saying the same thing about both was a mistake worth not repeating: a
 * shortfall was told to reload the page, which fixes nothing, and described as
 * unfaithful, which overstates it.
 *
 * @param recordedMilliseconds Length of the audio **as captured**, before any
 *     guard is trimmed from it. Measuring the trimmed take would report the
 *     guard as a fault.
 * @param elapsedMilliseconds Wall-clock time the samples should cover.
 * @returns Null when the two agree.
 * @example
 * findCaptureFault(3900, 2000); // doubled audio — the buffer is corrupt
 * findCaptureFault(1000, 1600); // audio missing — the end was not delivered
 */
export function findCaptureFault(
  recordedMilliseconds: number,
  elapsedMilliseconds: number,
): QualityWarning | null {
  const tolerance = Math.max(
    DURATION_TOLERANCE_FLOOR_MILLISECONDS,
    elapsedMilliseconds * DURATION_TOLERANCE_FRACTION,
  );
  const drift = recordedMilliseconds - elapsedMilliseconds;
  if (Math.abs(drift) <= tolerance) {
    return null;
  }

  const recorded = (recordedMilliseconds / 1000).toFixed(1);
  const elapsed = (elapsedMilliseconds / 1000).toFixed(1);
  const missing = (Math.abs(drift) / 1000).toFixed(1);

  return {
    kind: 'capture-fault',
    message:
      drift > 0
        ? `${recorded} s of audio recorded in ${elapsed} s of real time. There are samples ` +
          'in this take that were never spoken — the capture is not a faithful record. ' +
          'Discard it and reload before recording more.'
        : `${missing} s of this take never reached the page: ${recorded} s of audio for ` +
          `${elapsed} s of recording. What is here is real, but the end is missing. ` +
          'Record it again.',
  };
}

/**
 * Lists what is worth knowing about a take.
 *
 * Warnings never block a take from being kept. The speaker heard the recording
 * and is the authority on whether it is good. These catch the failures an ear
 * misses at the end of a long session, so they can be revisited from the
 * dashboard rather than discovered after the last one is done.
 *
 * @returns Empty when nothing is unusual.
 * @example
 * findQualityWarnings({durationMilliseconds: 90, ...});
 * // => [{kind: 'too-short', message: 'Only 90 ms — probably a misfire.'}]
 */
export function findQualityWarnings(analysis: TakeAnalysis): QualityWarning[] {
  const warnings: QualityWarning[] = [];

  if (analysis.peakDecibels > CLIPPING_PEAK_DECIBELS) {
    warnings.push({
      kind: 'clipped',
      message: `Peaks at ${analysis.peakDecibels} dBFS — lower the gain and record it again.`,
    });
  }

  if (analysis.peakDecibels < TOO_QUIET_PEAK_DECIBELS) {
    warnings.push({
      kind: 'too-quiet',
      message: `Peaks at only ${analysis.peakDecibels} dBFS — too quiet to master cleanly.`,
    });
  }

  if (analysis.durationMilliseconds < MINIMUM_TAKE_DURATION_MILLISECONDS) {
    warnings.push({
      kind: 'too-short',
      message: `Only ${analysis.durationMilliseconds} ms — probably a misfire.`,
    });
  }

  if (analysis.durationMilliseconds > MAXIMUM_TAKE_DURATION_MILLISECONDS) {
    warnings.push({
      kind: 'too-long',
      message: `${Math.round(analysis.durationMilliseconds / 1000)} s — the recorder was left running.`,
    });
  }

  if (analysis.leadingSilenceMilliseconds > MAXIMUM_LEADING_SILENCE_MILLISECONDS) {
    warnings.push({
      kind: 'slow-start',
      message: `${analysis.leadingSilenceMilliseconds} ms of silence before the first sound.`,
    });
  }

  return warnings;
}
