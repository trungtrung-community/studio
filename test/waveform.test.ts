import {describe, expect, it} from 'vitest';

import {LiveTrace, RollingEnvelope, toEnvelope} from '@/lib/waveform';

/** A burst of sound with silence either side — the shape of a spoken word. */
function makeWord(): Float32Array {
  const samples = new Float32Array(300);
  for (let index = 100; index < 200; index += 1) {
    samples[index] = 0.8;
  }
  return samples;
}

describe('toEnvelope', () => {
  it('returns exactly the number of bars asked for', () => {
    expect(toEnvelope(new Float32Array(1_000), 64)).toHaveLength(64);
    expect(toEnvelope(new Float32Array(7), 64)).toHaveLength(64);
  });

  it('shows a word as quiet, loud, quiet', () => {
    const [before, during, after] = toEnvelope(makeWord(), 3);
    expect(before).toBe(0);
    expect(during).toBeCloseTo(0.8, 5);
    expect(after).toBe(0);
  });

  it('draws silence as nothing at all', () => {
    expect([...toEnvelope(new Float32Array(500), 8)]).toEqual(Array(8).fill(0));
  });

  it('takes the peak of a slice, not its average', () => {
    // An average would hide clipping, which is the thing most worth seeing.
    const samples = new Float32Array(100);
    samples[50] = 1;
    expect(toEnvelope(samples, 1)[0]).toBe(1);
  });

  it('measures magnitude, so a negative swing counts', () => {
    expect(toEnvelope(new Float32Array([0, -0.9, 0]), 1)[0]).toBeCloseTo(0.9, 5);
  });

  it('returns an empty envelope for no samples or no bars', () => {
    expect(toEnvelope(new Float32Array(0), 8)).toHaveLength(8);
    expect(toEnvelope(new Float32Array(100), 0)).toHaveLength(0);
  });
});

describe('RollingEnvelope', () => {
  it('reads back oldest first', () => {
    const trace = new RollingEnvelope(4);
    trace.push(0.1);
    trace.push(0.2);
    expect([...trace.toArray()]).toEqual([
      expect.closeTo(0.1, 5),
      expect.closeTo(0.2, 5),
    ]);
  });

  it('is only as long as what has been pushed, so a new trace draws from the left', () => {
    const trace = new RollingEnvelope(100);
    trace.push(0.5);
    expect(trace.toArray()).toHaveLength(1);
  });

  it('drops the oldest once full, so the trace scrolls', () => {
    const trace = new RollingEnvelope(3);
    for (const value of [1, 2, 3, 4]) {
      trace.push(value);
    }
    expect([...trace.toArray()]).toEqual([2, 3, 4]);
  });

  it('empties on clear, so a new take does not inherit the last one', () => {
    const trace = new RollingEnvelope(3);
    trace.push(1);
    trace.clear();
    expect(trace.toArray()).toHaveLength(0);
  });
});

describe('LiveTrace', () => {
  const barMilliseconds = 40;

  function makeTrace(capacity = 8): LiveTrace {
    return new LiveTrace({barMilliseconds, capacity});
  }

  /** Feeds one reading every `everyMilliseconds`, starting at zero. */
  function feed(
    trace: LiveTrace,
    amplitudes: readonly number[],
    everyMilliseconds: number,
  ): void {
    amplitudes.forEach((amplitude, index) => {
      trace.observe(amplitude, index * everyMilliseconds);
    });
  }

  it('commits one bar per interval however fast readings arrive', () => {
    // The scroll speed has to be a property of the clock. Tied to the reading
    // rate it would differ between machines, and between one microphone and the
    // next on the same machine.
    const fast = makeTrace(64);
    const slow = makeTrace(64);
    feed(fast, Array(80).fill(0.5), 5);
    feed(slow, Array(20).fill(0.5), 20);

    expect(fast.toArray()).toHaveLength(9);
    expect(slow.toArray()).toHaveLength(9);
  });

  it('gives each bar the loudest reading in its interval', () => {
    const trace = makeTrace();
    trace.observe(0.2, 0);
    trace.observe(0.9, 10);
    trace.observe(0.3, 20);
    trace.observe(0, barMilliseconds);

    expect([...trace.toArray()]).toEqual([expect.closeTo(0.9, 5)]);
  });

  it('does not show a bar until its interval is over', () => {
    const trace = makeTrace();
    trace.observe(0.5, 0);
    trace.observe(0.5, barMilliseconds - 1);

    expect(trace.toArray()).toHaveLength(0);
  });

  it('writes silence across a gap rather than closing it up', () => {
    // Readings stop while the tab is in the background. Dropping the gap would
    // slide the audio before it forward and misplace the whole trace in time.
    const trace = makeTrace();
    trace.observe(0.8, 0);
    trace.observe(0.4, barMilliseconds * 5);

    expect([...trace.toArray()]).toEqual([expect.closeTo(0.8, 5), 0, 0, 0, 0]);
  });

  it('keeps only the most recent bars, so the trace scrolls', () => {
    const trace = makeTrace(3);
    feed(trace, [1, 2, 3, 4, 5, 6], barMilliseconds);

    expect(trace.toArray()).toHaveLength(3);
    expect([...trace.toArray()]).toEqual([4, 5, 6]);
  });

  it('starts its clock at the first reading, not at construction', () => {
    // A trace is built when the screen mounts and fed when recording starts,
    // which can be minutes apart. Counting from construction would fill the
    // whole trace with silence the moment the first reading arrived.
    const trace = makeTrace();
    trace.observe(0.5, 900_000);
    trace.observe(0.5, 900_000 + barMilliseconds);

    expect(trace.toArray()).toHaveLength(1);
  });

  it('forgets everything on clear, including where the bar began', () => {
    const trace = makeTrace();
    feed(trace, [0.5, 0.5, 0.5], barMilliseconds);
    trace.clear();

    expect(trace.toArray()).toHaveLength(0);

    trace.observe(0.5, 10_000);
    expect(trace.toArray()).toHaveLength(0);
  });
});
