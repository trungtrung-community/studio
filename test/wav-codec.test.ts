import {describe, expect, it} from 'vitest';

import {
  CAPTURE_SAMPLE_RATE_HERTZ,
  KEYPRESS_GUARD_MILLISECONDS,
  SILENCE_DECIBELS,
} from '@/lib/audio-constants';
import {
  analyseTake,
  decodeWav,
  encodeWav,
  findCaptureFault,
  findQualityWarnings,
  toDecibels,
  type DecodedAudio,
} from '@/lib/wav-codec';

/** A sine wave, which is the only signal with a peak this predictable. */
function makeTone(amplitude: number, milliseconds: number): DecodedAudio {
  const sampleCount = Math.round((CAPTURE_SAMPLE_RATE_HERTZ * milliseconds) / 1000);
  const samples = new Float32Array(sampleCount);
  for (let index = 0; index < sampleCount; index += 1) {
    samples[index] = amplitude * Math.sin((2 * Math.PI * 440 * index) / CAPTURE_SAMPLE_RATE_HERTZ);
  }
  return {samples, sampleRateHertz: CAPTURE_SAMPLE_RATE_HERTZ, channelCount: 1};
}

function makeSilence(milliseconds: number): DecodedAudio {
  const sampleCount = Math.round((CAPTURE_SAMPLE_RATE_HERTZ * milliseconds) / 1000);
  return {
    samples: new Float32Array(sampleCount),
    sampleRateHertz: CAPTURE_SAMPLE_RATE_HERTZ,
    channelCount: 1,
  };
}

function concatenate(first: DecodedAudio, second: DecodedAudio): DecodedAudio {
  const samples = new Float32Array(first.samples.length + second.samples.length);
  samples.set(first.samples, 0);
  samples.set(second.samples, first.samples.length);
  return {...first, samples};
}

describe('encodeWav and decodeWav', () => {
  it('round-trips a recording within 16-bit resolution', () => {
    const original = makeTone(0.5, 100);
    const decoded = decodeWav(encodeWav(original));

    expect(decoded.sampleRateHertz).toBe(CAPTURE_SAMPLE_RATE_HERTZ);
    expect(decoded.channelCount).toBe(1);
    expect(decoded.samples).toHaveLength(original.samples.length);
    for (let index = 0; index < original.samples.length; index += 1) {
      expect(decoded.samples[index]).toBeCloseTo(original.samples[index], 4);
    }
  });

  it('writes a file the expected size', () => {
    const encoded = encodeWav(makeTone(0.5, 100));
    const expectedSamples = Math.round((CAPTURE_SAMPLE_RATE_HERTZ * 100) / 1000);
    expect(encoded.byteLength).toBe(44 + expectedSamples * 2);
  });

  it('refuses bytes that are not a WAV file', () => {
    expect(() => decodeWav(new Uint8Array(64))).toThrow('Not a WAV file.');
  });
});

describe('toDecibels', () => {
  it('reports full scale as zero', () => {
    expect(toDecibels(1)).toBeCloseTo(0, 5);
  });

  it('reports half amplitude as about six decibels down', () => {
    expect(toDecibels(0.5)).toBeCloseTo(-6.02, 1);
  });

  it('gives silence a finite floor, because negative infinity does not survive JSON', () => {
    expect(toDecibels(0)).toBe(SILENCE_DECIBELS);
  });
});

describe('analyseTake', () => {
  it('measures peak, average and duration', () => {
    const analysis = analyseTake(makeTone(0.5, 1_000));

    expect(analysis.peakDecibels).toBeCloseTo(-6, 0);
    // A sine wave averages 1/√2 of its peak, which is three decibels lower.
    expect(analysis.rootMeanSquareDecibels).toBeCloseTo(-9, 0);
    expect(analysis.durationMilliseconds).toBe(1_000);
  });

  it('measures silence before the first sound', () => {
    const analysis = analyseTake(concatenate(makeSilence(500), makeTone(0.5, 500)));
    expect(analysis.leadingSilenceMilliseconds).toBeCloseTo(500, -1);
  });

  it('treats an entirely silent take as silent throughout', () => {
    const analysis = analyseTake(makeSilence(300));
    expect(analysis.peakDecibels).toBe(SILENCE_DECIBELS);
    expect(analysis.leadingSilenceMilliseconds).toBe(300);
  });
});

describe('findCaptureFault', () => {
  it('passes a take as long as the time it took to make', () => {
    expect(findCaptureFault(2_000, 2_000)).toBeNull();
  });

  it('catches a take twice as long as the time that passed', () => {
    // The real failure this exists for: two capture graphs pushing into one
    // buffer produced 3.90 s of interleaved audio from 2 s of speaking. Every
    // other measurement in this file read as healthy.
    const fault = findCaptureFault(3_900, 2_000);

    expect(fault?.kind).toBe('capture-fault');
    expect(fault?.message).toContain('3.9 s');
    expect(fault?.message).toContain('2.0 s');
  });

  it('catches a take shorter than the time that passed', () => {
    // Dropped blocks, or a context that was suspended for part of the take.
    expect(findCaptureFault(900, 2_000)?.kind).toBe('capture-fault');
  });

  it('tells a corrupt buffer from a take that arrived incomplete', () => {
    // Opposite faults with opposite remedies. Audio that was never spoken means
    // the buffer cannot be trusted at all; audio that never arrived means what is
    // there is real and the rest has to be said again. Saying "reload the page"
    // for the second is advice that fixes nothing.
    const doubled = findCaptureFault(3_900, 2_000)?.message ?? '';
    const short = findCaptureFault(1_000, 1_600)?.message ?? '';

    expect(doubled).toContain('never spoken');
    expect(doubled).toContain('reload');

    expect(short).toContain('never reached the page');
    expect(short).toContain('Record it again');
    expect(short).not.toContain('reload');
  });

  it('says how much of a short take is missing', () => {
    expect(findCaptureFault(1_000, 1_600)?.message).toContain('0.6 s');
  });

  it('tolerates the millisecond or two of thread latency', () => {
    expect(findCaptureFault(1_980, 2_000)).toBeNull();
  });

  it('does not fire on a short take, where a fixed lag is a large fraction', () => {
    // 40 ms of latency on a 300 ms letter is 13%, which a percentage-only
    // tolerance would flag on every single Read take.
    expect(findCaptureFault(300, 340)).toBeNull();
  });

  it('does not fire because of the keypress guard trimmed from every take', () => {
    // The guard shortens the take by 80 ms AFTER this check runs, but if the
    // order were ever reversed this is what would break — every take would
    // report itself as faulty.
    expect(findCaptureFault(2_000 - KEYPRESS_GUARD_MILLISECONDS, 2_000)).toBeNull();
  });

  it('still fires on a short take that is genuinely doubled', () => {
    expect(findCaptureFault(600, 300)?.kind).toBe('capture-fault');
  });
});

describe('findQualityWarnings', () => {
  const healthy = analyseTake(makeTone(0.5, 1_500));

  it('says nothing about a good take', () => {
    expect(findQualityWarnings(healthy)).toEqual([]);
  });

  it('catches clipping', () => {
    const warnings = findQualityWarnings(analyseTake(makeTone(1, 1_500)));
    expect(warnings.map((warning) => warning.kind)).toContain('clipped');
  });

  it('catches a take too quiet to master', () => {
    const warnings = findQualityWarnings(analyseTake(makeTone(0.02, 1_500)));
    expect(warnings.map((warning) => warning.kind)).toContain('too-quiet');
  });

  it('catches a keystroke misfire', () => {
    const warnings = findQualityWarnings(analyseTake(makeTone(0.5, 100)));
    expect(warnings.map((warning) => warning.kind)).toContain('too-short');
  });

  it('catches a recorder left running', () => {
    const warnings = findQualityWarnings(analyseTake(makeTone(0.5, 16_000)));
    expect(warnings.map((warning) => warning.kind)).toContain('too-long');
  });

  it('catches a slow start', () => {
    const analysis = analyseTake(concatenate(makeSilence(2_500), makeTone(0.5, 800)));
    expect(findQualityWarnings(analysis).map((warning) => warning.kind)).toContain('slow-start');
  });

  it('holds its thresholds exactly, so a borderline take is not flagged', () => {
    expect(findQualityWarnings({...healthy, durationMilliseconds: 250})).toEqual([]);
    expect(findQualityWarnings({...healthy, peakDecibels: -1})).toEqual([]);
    expect(findQualityWarnings({...healthy, peakDecibels: -30})).toEqual([]);
    expect(findQualityWarnings({...healthy, leadingSilenceMilliseconds: 2_000})).toEqual([]);
  });
});
