'use client';

import {
  CLIPPING_PEAK_DECIBELS,
  SILENCE_DECIBELS,
  TOO_QUIET_PEAK_DECIBELS,
} from '@/lib/audio-constants';
import {cn} from '@/lib/utils';

/**
 * Quietest level the meter draws.
 *
 * Below this everything is room noise, and showing it would leave the bar
 * permanently lit at a level that means nothing.
 */
const METER_FLOOR_DECIBELS = -60;

/** Where the healthy band starts, as a share of the meter's width. */
function toFraction(decibels: number): number {
  const clamped = Math.max(METER_FLOOR_DECIBELS, Math.min(0, decibels));
  return (clamped - METER_FLOOR_DECIBELS) / -METER_FLOOR_DECIBELS;
}

interface LevelMeterProps {
  /** Loudest recent sample, for the marker and the clipping warning. */
  peakDecibels: number;
  /** Mean recent level, for the bar. */
  meanDecibels: number;
}

/**
 * Live input level: a bar for how loud it is, a marker for how loud it peaked.
 *
 * Gain staging is the one thing that has to stay the same across every sitting,
 * and it is invisible without a meter.
 *
 * **The bar follows the mean, not the peak, and that is the point.** A bar driven
 * by peak alone swings fifteen decibels on a steady room, because the peak of
 * noise is itself noisy: every stray tick resets it to the top and it falls away
 * again before the next one. That reads as a broken meter, and it is useless for
 * setting a gain — the one job it has. The mean of the same sound barely moves.
 *
 * The peak still matters, for the one question the mean cannot answer: did
 * anything clip. So it stays, as a line above the bar rather than as the bar.
 */
export function LevelMeter({peakDecibels, meanDecibels}: LevelMeterProps) {
  const isSilent = peakDecibels <= SILENCE_DECIBELS;
  const isClipping = peakDecibels > CLIPPING_PEAK_DECIBELS;
  const isQuiet = peakDecibels < TOO_QUIET_PEAK_DECIBELS;

  return (
    <div className="space-y-1.5">
      <div className="relative h-2.5 w-full overflow-hidden rounded-pill bg-muted">
        {/* The three states use the design system's semantic signal colours:
            crown is what the product uses for a fault, beak for a caution,
            grass for correct. */}
        <div
          className={cn(
            'h-full transition-[width] duration-75',
            isClipping ? 'bg-crown-600' : isQuiet ? 'bg-beak-600' : 'bg-grass-600',
          )}
          style={{width: `${toFraction(meanDecibels) * 100}%`}}
        />

        {/* Where the loudest recent sample landed. */}
        {isSilent ? null : (
          <div
            className="absolute inset-y-0 w-0.5 bg-foreground/70"
            style={{left: `${toFraction(peakDecibels) * 100}%`}}
          />
        )}

        {/* Where clipping begins, so the target is visible rather than remembered. */}
        <div
          className="absolute inset-y-0 w-px bg-foreground/40"
          style={{left: `${toFraction(CLIPPING_PEAK_DECIBELS) * 100}%`}}
        />
      </div>

      <p className="flex items-center gap-3 font-mono text-xs tabular-nums text-muted-foreground">
        <span>{isSilent ? '—' : `${meanDecibels.toFixed(1)} dBFS`}</span>
        <span className="opacity-70">
          {isSilent ? '' : `peak ${peakDecibels.toFixed(1)}`}
        </span>
        {isClipping ? <span className="text-crown-600">too loud</span> : null}
      </p>
    </div>
  );
}
