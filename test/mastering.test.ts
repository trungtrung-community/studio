import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import {afterEach, beforeEach, describe, expect, it} from 'vitest';

import {
  findSessionNoiseFloor,
  isFfmpegAvailable,
  renderDeliveryFile,
} from '@/lib/mastering';
import type {StudioConfig} from '@/lib/studio-config';
import {appendLedgerEntry, type RoomToneCapture} from '@/lib/take-ledger';
import {encodeWav} from '@/lib/wav-codec';

let config: StudioConfig;

/** A second of a tone, which survives the chain where silence would not. */
function makeSpokenTake(seconds = 1): Uint8Array {
  const sampleRateHertz = 48_000;
  const samples = new Float32Array(sampleRateHertz * seconds);
  for (let index = 0; index < samples.length; index += 1) {
    samples[index] = Math.sin((2 * Math.PI * 220 * index) / sampleRateHertz) * 0.4;
  }
  return encodeWav({samples, sampleRateHertz, channelCount: 1});
}

/**
 * The top-level boxes of an MP4 file, in the order they appear.
 *
 * Each is a four-byte big-endian length followed by a four-character name, so
 * walking them needs no library.
 */
function readAtomOrder(filePath: string): string[] {
  const bytes = fs.readFileSync(filePath);
  const names: string[] = [];
  let offset = 0;

  while (offset + 8 <= bytes.length) {
    const size = bytes.readUInt32BE(offset);
    names.push(bytes.subarray(offset + 4, offset + 8).toString('latin1'));
    if (size <= 0) {
      break;
    }
    offset += size;
  }

  return names;
}

function roomTone(sessionId: string, rootMeanSquareDecibels: number): RoomToneCapture {
  return {
    kind: 'room-tone',
    sessionId,
    recordedAt: '2026-08-17T09:00:00.000Z',
    analysis: {
      durationMilliseconds: 3_000,
      peakDecibels: -20,
      rootMeanSquareDecibels,
      leadingSilenceMilliseconds: 0,
    },
  };
}

beforeEach(() => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'studio-mastering-'));
  config = {designSystemPath: root, dataPath: root, backupPath: ''};
});

afterEach(() => {
  fs.rmSync(config.dataPath, {recursive: true, force: true});
});

describe('findSessionNoiseFloor', () => {
  it('uses the floor that session measured', () => {
    appendLedgerEntry(config.dataPath, roomTone('2026-08-17-1', -41.2));

    expect(findSessionNoiseFloor(config, '2026-08-17-1')).toBeCloseTo(-41.2, 5);
  });

  it('keeps each session to its own room', () => {
    appendLedgerEntry(config.dataPath, roomTone('2026-08-17-1', -41.2));
    appendLedgerEntry(config.dataPath, roomTone('2026-08-18-1', -55));

    expect(findSessionNoiseFloor(config, '2026-08-18-1')).toBeCloseTo(-55, 5);
  });

  it('falls back when no room tone has been captured', () => {
    // The preview runs before the first sitting has a room tone in some orders,
    // and a missing floor must not stop a take being heard.
    expect(findSessionNoiseFloor(config, '')).toBe(-50);
  });

  it('refuses an implausible floor rather than denoising against it', () => {
    // A floor this high means something was making noise during the capture.
    // Trusting it would have the denoiser eat the speech as well.
    appendLedgerEntry(config.dataPath, roomTone('2026-08-17-1', -12));

    expect(findSessionNoiseFloor(config, '2026-08-17-1')).toBe(-50);
  });

  it('refuses a floor that says the microphone was muted', () => {
    appendLedgerEntry(config.dataPath, roomTone('2026-08-17-1', -95));

    expect(findSessionNoiseFloor(config, '2026-08-17-1')).toBe(-50);
  });
});

// The chain itself needs ffmpeg. Skipped rather than failed where it is absent,
// so a checkout without it still runs everything else.
describe.skipIf(!isFfmpegAvailable())('renderDeliveryFile', () => {
  it('produces the delivered file from a recording', () => {
    const sourcePath = path.join(config.dataPath, 'take.wav');
    const deliveryPath = path.join(config.dataPath, 'nested', 'take.m4a');
    fs.writeFileSync(sourcePath, makeSpokenTake());

    renderDeliveryFile(sourcePath, deliveryPath, -50);

    expect(fs.existsSync(deliveryPath)).toBe(true);
    expect(fs.statSync(deliveryPath).size).toBeGreaterThan(0);
  });

  it('puts the index at the front of the file', () => {
    // ffmpeg writes `moov` last by default, which means a player must hold the
    // whole file before it can start. On a phone opening one of two thousand
    // takes that is the wrong layout, and it was enough to make Safari refuse to
    // decode the preview at all — which then fell back to the raw capture and
    // made the processing look as though it were doing nothing.
    const sourcePath = path.join(config.dataPath, 'take.wav');
    const deliveryPath = path.join(config.dataPath, 'take.m4a');
    fs.writeFileSync(sourcePath, makeSpokenTake());

    renderDeliveryFile(sourcePath, deliveryPath, -50);

    expect(readAtomOrder(deliveryPath).indexOf('moov')).toBeLessThan(
      readAtomOrder(deliveryPath).indexOf('mdat'),
    );
  });

  it('leaves the recording it read untouched', () => {
    // Everything downstream depends on this: a master that the chain edited
    // could not be re-mastered after a constant changed.
    const sourcePath = path.join(config.dataPath, 'take.wav');
    const bytes = makeSpokenTake();
    fs.writeFileSync(sourcePath, bytes);

    renderDeliveryFile(sourcePath, path.join(config.dataPath, 'take.m4a'), -50);

    expect(fs.readFileSync(sourcePath).byteLength).toBe(bytes.byteLength);
  });

  it('trims the silence off both ends', () => {
    // What the speaker hears in the preview is shorter than what they recorded,
    // and this is why. The waveform changes length when they compare the two, so
    // a trim that had silently stopped working would look like a capture fault.
    //
    // Two files of the same length, one silent either side of a second of sound
    // and one sounding throughout. At a fixed bitrate the delivered size tracks
    // the duration, so the trimmed one has to come out markedly smaller.
    const sampleRateHertz = 48_000;
    const seconds = 3;

    const write = (name: string, samples: Float32Array): string => {
      const filePath = path.join(config.dataPath, name);
      fs.writeFileSync(filePath, encodeWav({samples, sampleRateHertz, channelCount: 1}));
      return filePath;
    };

    const tone = (length: number): Float32Array => {
      const samples = new Float32Array(length);
      for (let index = 0; index < length; index += 1) {
        samples[index] = Math.sin((2 * Math.PI * 220 * index) / sampleRateHertz) * 0.4;
      }
      return samples;
    };

    const padded = new Float32Array(sampleRateHertz * seconds);
    padded.set(tone(sampleRateHertz), sampleRateHertz);

    const paddedDelivery = path.join(config.dataPath, 'padded.m4a');
    const wholeDelivery = path.join(config.dataPath, 'whole.m4a');
    renderDeliveryFile(write('padded.wav', padded), paddedDelivery, -50);
    renderDeliveryFile(
      write('whole.wav', tone(sampleRateHertz * seconds)),
      wholeDelivery,
      -50,
    );

    expect(fs.statSync(paddedDelivery).size).toBeLessThan(
      fs.statSync(wholeDelivery).size / 2,
    );
  });
});
