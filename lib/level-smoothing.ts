/**
 * @fileoverview Ballistics for the input meter.
 *
 * A meter driven straight off the raw signal is unreadable. Audio arrives in
 * 128-sample blocks — 2.67 ms at 48 kHz — and the peak of any one of those
 * swings tens of decibels between neighbours, so the bar strobes and tells the
 * speaker nothing about their gain.
 *
 * Real meters solve this with asymmetric ballistics: rise instantly so a peak is
 * never missed, fall slowly so the eye can read the level. That is all this is,
 * kept pure so it can be tested without a microphone.
 */

import {SILENCE_DECIBELS} from './audio-constants';

/**
 * How fast the bar falls, in decibels per second.
 *
 * Slow enough to read between syllables, fast enough that the meter has clearly
 * responded to the last word before the next one starts.
 */
export const METER_DECAY_DECIBELS_PER_SECOND = 40;

/**
 * Advances the displayed level by one tick.
 *
 * Rises immediately to any new peak and otherwise decays towards silence, so the
 * bar follows the loudest recent sound rather than the current 2.67 ms of it.
 *
 * @param displayed Where the bar is now, in dBFS.
 * @param peak The loudest level measured since the last tick, in dBFS.
 * @param elapsedMilliseconds Time since the last tick.
 * @returns The level to draw, never below the silence floor.
 * @example
 * smoothLevel(-20, -50, 50); // => -22   (falling 40 dB/s)
 * smoothLevel(-50, -20, 50); // => -20   (instant attack)
 */
export function smoothLevel(
  displayed: number,
  peak: number,
  elapsedMilliseconds: number,
): number {
  if (peak >= displayed) {
    return peak;
  }
  const decayed =
    displayed - (METER_DECAY_DECIBELS_PER_SECOND * elapsedMilliseconds) / 1000;
  return Math.max(SILENCE_DECIBELS, peak, decayed);
}
