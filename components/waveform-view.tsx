'use client';

/**
 * @fileoverview The shape of what is being said, and where playback has reached.
 *
 * At a hundred and fifty takes a sitting, looking is faster than listening. This
 * answers in a glance what otherwise costs a playback each: did it clip, did
 * anything arrive, did I start late, did I cut the end off.
 *
 * It is a diagnostic as much as a comfort. Speech has a shape — quiet, a burst,
 * quiet. A capture that draws as a uniform dense block is not speech, which is
 * exactly how a doubled, interleaved recording once looked while every level
 * reading about it stayed healthy.
 *
 * It draws in three states and they are genuinely different pictures:
 *
 *   * **recording** — a fixed line at the centre with audio scrolling past it,
 *     newest beside the line. There is no end to run into and no scale to guess,
 *     because the take's length is not known until it stops.
 *   * **a take in hand** — the whole take across the full width, with a playhead
 *     that can be dragged. Here the length *is* known, so the take is what sets
 *     the scale.
 *   * **idle** — still and empty. Motion with no recording behind it reads as a
 *     recording; the level meter is what reports that the microphone is live.
 *
 * **Nothing here goes through React state.** The trace and the playhead are both
 * read inside a `requestAnimationFrame` draw — one from a ref, one from a
 * function — because they change sixty times a second and a component
 * re-rendering at that rate is the fault this whole screen was rebuilt to
 * remove.
 */

import {useCallback, useEffect, useMemo, useRef} from 'react';

import {CLIPPING_PEAK_DECIBELS} from '@/lib/audio-constants';
import {cn} from '@/lib/utils';
import {LiveTrace, toEnvelope, type Envelope} from '@/lib/waveform';

interface WaveformViewProps {
  /** The trace of the take being recorded. Drawn only while `isRecording`. */
  liveTrace: React.RefObject<LiveTrace>;
  /** Whether a take is being recorded right now. */
  isRecording: boolean;
  /** A finished take. Present means draw this instead of the trace. */
  samples?: Float32Array | null;
  /** Seconds into the take. Called once per frame, never rendered. */
  getPlaybackPosition?: () => number;
  /** The take's length, which gives the playhead its scale. */
  durationSeconds?: number;
  /** Called when the playhead is dragged or the waveform clicked. */
  onSeek?: (seconds: number) => void;
  className?: string;
}

/** Bars drawn across the full width. Enough to resolve a syllable at this size. */
const BAR_COUNT = 160;
const BAR_GAP_FRACTION = 0.35;

/** Amplitude at which a bar is drawn as clipped, from the same threshold QC uses. */
const CLIPPING_AMPLITUDE = 10 ** (CLIPPING_PEAK_DECIBELS / 20);

/**
 * The smallest bar drawn, as a fraction of half the height.
 *
 * Silence still shows a hairline rather than a gap, so an empty take reads as
 * "nothing was said" rather than as a broken component.
 */
const MINIMUM_BAR_FRACTION = 0.012;

const PLAYHEAD_WIDTH = 2;

/** Drawn when nothing is being recorded and no take is in hand. */
const EMPTY_ENVELOPE: Envelope = new Float32Array(0);

/** The canvas, with its size and colours resolved for one draw. */
interface Surface {
  context: CanvasRenderingContext2D;
  width: number;
  height: number;
  barWidth: number;
  /** Bar width less the gap, so bars read as bars rather than as a block. */
  drawnWidth: number;
}

/**
 * Reads a colour from the theme.
 *
 * A canvas cannot take a class, and the studio forbids raw colour values, so the
 * resolved custom properties are the only correct source. Reading them per draw
 * is also what makes the waveform follow the light and dark themes for free.
 */
function readColour(canvas: HTMLCanvasElement, token: string): string {
  return getComputedStyle(canvas).getPropertyValue(token).trim();
}

/**
 * Clears the canvas and returns what the draw needs.
 *
 * @returns Null when the canvas has no area, which happens for one frame before
 *     layout settles and during a tab switch.
 */
function prepare(canvas: HTMLCanvasElement): Surface | null {
  const context = canvas.getContext('2d');
  const {width, height} = canvas.getBoundingClientRect();
  if (!context || width === 0 || height === 0) {
    return null;
  }

  const ratio = window.devicePixelRatio || 1;
  if (canvas.width !== Math.round(width * ratio)) {
    canvas.width = Math.round(width * ratio);
    canvas.height = Math.round(height * ratio);
  }
  context.setTransform(ratio, 0, 0, ratio, 0, 0);
  context.clearRect(0, 0, width, height);

  const barWidth = width / BAR_COUNT;
  return {context, width, height, barWidth, drawnWidth: barWidth * (1 - BAR_GAP_FRACTION)};
}

/** Draws one bar centred on the middle of the canvas. */
function drawBar(surface: Surface, left: number, amplitude: number, colour: string): void {
  const middle = surface.height / 2;
  const half = Math.max(MINIMUM_BAR_FRACTION, Math.min(1, amplitude)) * middle;
  surface.context.fillStyle = colour;
  surface.context.fillRect(left, middle - half, surface.drawnWidth, half * 2);
}

/**
 * Draws a finished take across the full width, with its playhead.
 *
 * @param playedFraction How far playback has reached, 0 to 1, or null when
 *     nothing is playing and the playhead should be hidden.
 */
function drawTake(
  canvas: HTMLCanvasElement,
  envelope: Envelope,
  playedFraction: number | null,
): void {
  const surface = prepare(canvas);
  if (!surface) {
    return;
  }

  const normal = readColour(canvas, '--primary');
  const clipped = readColour(canvas, '--destructive');
  const spent = readColour(canvas, '--muted-foreground');
  const playedBars = playedFraction === null ? -1 : playedFraction * BAR_COUNT;

  for (let bar = 0; bar < BAR_COUNT; bar += 1) {
    const amplitude = bar < envelope.length ? envelope[bar] : 0;
    // Already-played bars are dimmed, which shows progress across the whole
    // waveform rather than only at the line.
    const colour =
      amplitude >= CLIPPING_AMPLITUDE ? clipped : bar < playedBars ? spent : normal;
    drawBar(surface, bar * surface.barWidth, amplitude, colour);
  }

  if (playedFraction !== null) {
    surface.context.fillStyle = readColour(canvas, '--foreground');
    surface.context.fillRect(
      playedFraction * surface.width - PLAYHEAD_WIDTH / 2,
      0,
      PLAYHEAD_WIDTH,
      surface.height,
    );
  }
}

/**
 * Draws the take being recorded, scrolling right to left past a fixed line.
 *
 * The line is at the centre and the audio arrives beside it, so the newest sound
 * is always in the same place and the trace has nowhere to run out to. The right
 * half is empty because it is the part that has not been said yet.
 *
 * @param showNeedle False when nothing is being recorded, which clears the
 *     surface and leaves it still.
 */
function drawLive(
  canvas: HTMLCanvasElement,
  envelope: Envelope,
  showNeedle: boolean,
): void {
  const surface = prepare(canvas);
  if (!surface) {
    return;
  }

  const normal = readColour(canvas, '--primary');
  const clipped = readColour(canvas, '--destructive');
  const needle = surface.width / 2;

  // Laid out from the line backwards: the last bar of the envelope is the newest
  // audio and belongs against the line, whatever the trace's length.
  for (let fromNewest = 0; fromNewest < envelope.length; fromNewest += 1) {
    const left = needle - (fromNewest + 1) * surface.barWidth;
    if (left + surface.drawnWidth < 0) {
      break;
    }
    const amplitude = envelope[envelope.length - 1 - fromNewest];
    drawBar(surface, left, amplitude, amplitude >= CLIPPING_AMPLITUDE ? clipped : normal);
  }

  if (showNeedle) {
    surface.context.fillStyle = readColour(canvas, '--destructive');
    surface.context.fillRect(needle - PLAYHEAD_WIDTH / 2, 0, PLAYHEAD_WIDTH, surface.height);
  }
}

/** Draws the take in hand, the take being recorded, or nothing at all. */
export function WaveformView({
  liveTrace,
  isRecording,
  samples,
  getPlaybackPosition,
  durationSeconds = 0,
  onSeek,
  className,
}: WaveformViewProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);

  // A finished take never changes, so its envelope is computed once rather than
  // per frame — a second of audio is 48,000 samples to scan.
  const heldEnvelope = useMemo(
    () => (samples ? toEnvelope(samples, BAR_COUNT) : null),
    [samples],
  );

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) {
      return;
    }

    let frame = 0;
    const tick = () => {
      frame = requestAnimationFrame(tick);

      if (heldEnvelope) {
        const position = getPlaybackPosition ? getPlaybackPosition() : null;
        drawTake(
          canvas,
          heldEnvelope,
          position !== null && durationSeconds > 0
            ? Math.min(1, position / durationSeconds)
            : null,
        );
        return;
      }

      // Idle still redraws, because the surface has to be cleared when a take is
      // discarded and because the theme can change under it. It draws nothing.
      drawLive(canvas, isRecording ? liveTrace.current.toArray() : EMPTY_ENVELOPE, isRecording);
    };
    frame = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(frame);
  }, [heldEnvelope, liveTrace, isRecording, getPlaybackPosition, durationSeconds]);

  const isScrubbable = Boolean(samples && onSeek && durationSeconds > 0);

  const seekToPointer = useCallback(
    (clientX: number): void => {
      const canvas = canvasRef.current;
      if (!canvas || !onSeek) {
        return;
      }
      const {left, width} = canvas.getBoundingClientRect();
      const fraction = Math.min(1, Math.max(0, (clientX - left) / width));
      onSeek(fraction * durationSeconds);
    },
    [onSeek, durationSeconds],
  );

  return (
    <canvas
      ref={canvasRef}
      aria-hidden
      className={cn(
        'bg-muted/40 rounded-control h-24 w-full touch-none',
        isScrubbable && 'cursor-pointer',
        className,
      )}
      onPointerDown={
        isScrubbable
          ? (event) => {
              // Capturing means a drag that leaves the canvas keeps scrubbing,
              // which is how every other scrubber behaves.
              event.currentTarget.setPointerCapture(event.pointerId);
              seekToPointer(event.clientX);
            }
          : undefined
      }
      onPointerMove={
        isScrubbable
          ? (event) => {
              if (event.currentTarget.hasPointerCapture(event.pointerId)) {
                seekToPointer(event.clientX);
              }
            }
          : undefined
      }
      onPointerUp={
        isScrubbable
          ? (event) => event.currentTarget.releasePointerCapture(event.pointerId)
          : undefined
      }
    />
  );
}
