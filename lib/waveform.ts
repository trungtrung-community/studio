/**
 * @fileoverview Reducing a take to something the eye can judge.
 *
 * At a hundred and fifty takes a sitting, looking is faster than listening. A
 * waveform answers the questions that otherwise cost a playback each: did it
 * clip, did anything arrive at all, did I start late, did I cut the end off.
 *
 * It is also a diagnostic. Speech has a shape — quiet, a burst, quiet. A capture
 * that comes out as a uniform dense block is not speech, and that is visible in
 * a glance where it is inaudible in a level reading.
 */

/** One bar of a drawn waveform: the loudest sample in the slice it covers. */
export type Envelope = Float32Array;

/**
 * Reduces samples to one peak per bar.
 *
 * Peak rather than average, because the point is to show the extremes: an
 * average hides clipping, which is the single most important thing to see.
 *
 * @param barCount How many bars to draw. Slices are as even as the length allows.
 * @returns Amplitudes from 0 to 1, one per bar. All zero for silence.
 * @example
 * toEnvelope(samples, 3); // => Float32Array [0.02, 0.81, 0.04]
 */
export function toEnvelope(samples: Float32Array, barCount: number): Envelope {
  const envelope = new Float32Array(Math.max(0, barCount));
  if (samples.length === 0 || barCount <= 0) {
    return envelope;
  }

  for (let bar = 0; bar < barCount; bar += 1) {
    const start = Math.floor((bar * samples.length) / barCount);
    const end = Math.max(start + 1, Math.floor(((bar + 1) * samples.length) / barCount));

    let peak = 0;
    for (let index = start; index < end && index < samples.length; index += 1) {
      const magnitude = Math.abs(samples[index]);
      if (magnitude > peak) {
        peak = magnitude;
      }
    }
    envelope[bar] = peak;
  }

  return envelope;
}

/**
 * A fixed-length window of the most recent levels.
 *
 * Holds amplitudes rather than decibels because it is drawn, not read. Oldest
 * values fall off the end, so the trace scrolls without anything being copied
 * per frame.
 *
 * This is the buffer. {@link LiveTrace} is what decides when to write to it.
 */
export class RollingEnvelope {
  private readonly values: Float32Array;
  private writeIndex = 0;
  private filled = 0;

  constructor(readonly capacity: number) {
    this.values = new Float32Array(capacity);
  }

  push(amplitude: number): void {
    this.values[this.writeIndex] = amplitude;
    this.writeIndex = (this.writeIndex + 1) % this.capacity;
    this.filled = Math.min(this.capacity, this.filled + 1);
  }

  clear(): void {
    this.values.fill(0);
    this.writeIndex = 0;
    this.filled = 0;
  }

  /**
   * The window, oldest first.
   *
   * Shorter than `capacity` until enough has been pushed, so a trace that has
   * just started draws from the left rather than pretending to be full of
   * silence.
   */
  toArray(): Envelope {
    const out = new Float32Array(this.filled);
    for (let index = 0; index < this.filled; index += 1) {
      const source = (this.writeIndex - this.filled + index + this.capacity) % this.capacity;
      out[index] = this.values[source];
    }
    return out;
  }
}

/** How a live trace is scaled: one bar per interval, so many bars kept. */
export interface LiveTraceOptions {
  /** Milliseconds of audio each bar covers. This sets the scroll speed. */
  barMilliseconds: number;
  /** Bars kept, which is how much of the recent past stays on screen. */
  capacity: number;
}

/**
 * The trace drawn while recording, quantised to a clock.
 *
 * A bar is committed once per interval rather than once per reading, and the
 * distinction matters. Levels arrive from the audio thread at whatever rate the
 * hardware and the browser produce between them, so one bar per reading makes
 * the trace scroll at a speed nobody chose and the picture stops corresponding
 * to elapsed time. On a clock, a bar is always worth the same amount of audio.
 *
 * Each bar carries the loudest reading in its interval, for the same reason
 * {@link toEnvelope} takes a peak: an average hides clipping.
 *
 * @example
 * const trace = new LiveTrace({barMilliseconds: 40, capacity: 80});
 * trace.observe(0.4, performance.now());
 * trace.toArray(); // oldest first, newest last
 */
export class LiveTrace {
  private readonly buffer: RollingEnvelope;
  private readonly barMilliseconds: number;

  /** Loudest reading since the current bar opened. */
  private peak = 0;
  /** When the current bar closes. Null until the first reading arrives. */
  private closesAt: number | null = null;

  constructor(options: LiveTraceOptions) {
    this.buffer = new RollingEnvelope(options.capacity);
    this.barMilliseconds = options.barMilliseconds;
  }

  /**
   * Takes one level reading.
   *
   * @param amplitude Peak amplitude of the audio this reading describes, 0 to 1.
   * @param atMilliseconds When it was measured, on any monotonic clock.
   */
  observe(amplitude: number, atMilliseconds: number): void {
    if (this.closesAt === null) {
      this.closesAt = atMilliseconds + this.barMilliseconds;
    }

    this.peak = Math.max(this.peak, amplitude);
    if (atMilliseconds < this.closesAt) {
      return;
    }

    this.buffer.push(this.peak);
    this.peak = 0;
    this.closesAt += this.barMilliseconds;

    // A gap longer than one bar means readings stopped arriving — the audio
    // thread stalled, or the tab was in the background. Those bars are silence
    // and are written as such, because dropping them would slide older audio
    // forward and misplace the whole trace in time.
    while (atMilliseconds >= this.closesAt) {
      this.buffer.push(0);
      this.closesAt += this.barMilliseconds;
    }
  }

  /** Empties the trace and forgets where the current bar began. */
  clear(): void {
    this.buffer.clear();
    this.peak = 0;
    this.closesAt = null;
  }

  /**
   * The committed bars, oldest first.
   *
   * The bar still being filled is not included. It would flicker as its peak
   * rose within a single interval, and at forty milliseconds it is not worth
   * seeing early.
   */
  toArray(): Envelope {
    return this.buffer.toArray();
  }
}
