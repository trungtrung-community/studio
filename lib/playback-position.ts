/**
 * @fileoverview Where playback has reached.
 *
 * An `AudioBufferSourceNode` does not report its own position, so the playhead
 * has to be derived: note the context's clock when playback started and how far
 * into the take it started from, and the rest is arithmetic.
 *
 * Kept here, and pure, because it is the only part of scrubbing that can be
 * tested without an audio context — and an off-by-one in it would put the line
 * somewhere other than the sound.
 */

/** A take being played, as far as the playhead is concerned. */
export interface PlaybackWindow {
  /** Offset into the take that playback last started from, in seconds. */
  startedFromSeconds: number;
  /** The audio context's clock at that moment, in seconds. */
  startedAtContextTime: number;
  /** The whole take, in seconds. */
  durationSeconds: number;
}

/**
 * The playhead position at a given moment on the context's clock.
 *
 * @param contextTime The audio context's `currentTime` now.
 * @returns Seconds into the take, never past its end or before its start.
 * @example
 * playbackPositionAt({startedFromSeconds: 0.5, startedAtContextTime: 10, durationSeconds: 2}, 11);
 * // => 1.5
 */
export function playbackPositionAt(
  window: PlaybackWindow,
  contextTime: number,
): number {
  const elapsed = contextTime - window.startedAtContextTime;
  const position = window.startedFromSeconds + elapsed;
  return Math.min(window.durationSeconds, Math.max(0, position));
}

/**
 * Where pressing play should start from.
 *
 * Resuming from the end would play nothing, so a playhead that has run out
 * returns to the beginning. Anywhere else resumes where it was left.
 *
 * @example
 * resumeFrom(1.99, 2);  // => 0    — at the end, so start again
 * resumeFrom(0.8, 2);   // => 0.8  — resume
 */
export function resumeFrom(position: number, durationSeconds: number): number {
  // A tenth of a second short of the end still counts as the end: there is
  // nothing useful left to hear, and floating point rarely lands exactly.
  const isAtEnd = position >= durationSeconds - 0.1;
  return isAtEnd ? 0 : Math.min(durationSeconds, Math.max(0, position));
}
