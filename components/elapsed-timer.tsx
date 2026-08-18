'use client';

/**
 * @fileoverview How long the current take has been running.
 *
 * Driven by the wall clock, deliberately. The take's reported length is counted
 * from samples, and the two are independent measurements of the same thing — so
 * a glance at both is a check on the capture. A recording that reads 3.90 s
 * beside a timer that counted 2 s is a fault, and that is precisely the state
 * this tool was in before `findCaptureFault` existed.
 *
 * Written straight to the DOM from a `requestAnimationFrame` loop rather than
 * through React state, for the same reason the waveform is: sixty re-renders a
 * second to move four digits is what the rest of this change removes.
 */

import {useEffect, useRef} from 'react';

import {cn} from '@/lib/utils';

interface ElapsedTimerProps {
  elapsedMilliseconds: React.RefObject<number>;
  /** Whether to keep following the clock. A held take shows its final time. */
  isRunning: boolean;
  className?: string;
}

/** Seconds to two places, which is the resolution a two-second take needs. */
function format(milliseconds: number): string {
  return `${(milliseconds / 1000).toFixed(2)} s`;
}

/**
 * How far playback has reached, against the take's length.
 *
 * Driven the same way and for the same reason: the playhead moves every frame,
 * and a number that re-rendered the screen sixty times a second to keep up would
 * undo the work that made this screen quiet.
 */
export function PlaybackTime({
  getPlaybackPosition,
  durationSeconds,
  className,
}: {
  getPlaybackPosition: () => number;
  durationSeconds: number;
  className?: string;
}) {
  const outputRef = useRef<HTMLSpanElement>(null);

  useEffect(() => {
    const output = outputRef.current;
    if (!output) {
      return;
    }
    let frame = 0;
    const tick = () => {
      output.textContent = `${getPlaybackPosition().toFixed(2)} / ${durationSeconds.toFixed(2)} s`;
      frame = requestAnimationFrame(tick);
    };
    frame = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(frame);
  }, [getPlaybackPosition, durationSeconds]);

  return (
    <span ref={outputRef} className={cn('font-mono tabular-nums', className)} aria-hidden>
      0.00 / {durationSeconds.toFixed(2)} s
    </span>
  );
}

/** The running length of the take, from the clock rather than from the samples. */
export function ElapsedTimer({
  elapsedMilliseconds,
  isRunning,
  className,
}: ElapsedTimerProps) {
  const outputRef = useRef<HTMLSpanElement>(null);

  useEffect(() => {
    const output = outputRef.current;
    if (!output) {
      return;
    }

    if (!isRunning) {
      output.textContent = format(elapsedMilliseconds.current);
      return;
    }

    let frame = 0;
    const tick = () => {
      output.textContent = format(elapsedMilliseconds.current);
      frame = requestAnimationFrame(tick);
    };
    frame = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(frame);
  }, [isRunning, elapsedMilliseconds]);

  return (
    <span
      ref={outputRef}
      className={cn('font-mono tabular-nums', className)}
      // Announcing every frame would flood a screen reader; the final duration
      // is reported once the take is held.
      aria-hidden
    >
      0.00 s
    </span>
  );
}
