import {describe, expect, it} from 'vitest';

import {SILENCE_DECIBELS} from '@/lib/audio-constants';
import {METER_DECAY_DECIBELS_PER_SECOND, smoothLevel} from '@/lib/level-smoothing';

describe('smoothLevel', () => {
  it('rises to a new peak immediately, so a loud moment is never missed', () => {
    expect(smoothLevel(-50, -12, 50)).toBe(-12);
  });

  it('falls at the decay rate rather than following the signal down', () => {
    // 50 ms at 40 dB/s is 2 dB. Following the signal instead is what made the
    // bar strobe: every 2.67 ms block has a wildly different peak.
    expect(smoothLevel(-20, -60, 50)).toBeCloseTo(-22, 5);
  });

  it('decays proportionally to the time that passed', () => {
    expect(smoothLevel(-20, SILENCE_DECIBELS, 1_000)).toBeCloseTo(
      -20 - METER_DECAY_DECIBELS_PER_SECOND,
      5,
    );
  });

  it('never falls below the peak it was given', () => {
    // A long tick must not decay straight past a level that is genuinely there.
    expect(smoothLevel(-20, -25, 10_000)).toBe(-25);
  });

  it('holds at the silence floor', () => {
    expect(smoothLevel(SILENCE_DECIBELS, SILENCE_DECIBELS, 1_000)).toBe(SILENCE_DECIBELS);
  });

  it('settles to silence from a peak in a readable time', () => {
    // Roughly three seconds from full scale to the floor: long enough to read
    // between syllables, short enough to have responded before the next word.
    let displayed = 0;
    let ticks = 0;
    while (displayed > SILENCE_DECIBELS && ticks < 1_000) {
      displayed = smoothLevel(displayed, SILENCE_DECIBELS, 50);
      ticks += 1;
    }
    expect((ticks * 50) / 1000).toBeCloseTo(3, 0);
  });
});
