/**
 * @fileoverview Saying what actually went wrong when a take will not play.
 *
 * This exists because the first version guessed, and guessed wrong. It said the
 * master "may have been moved" for every failure, so a browser refusing the
 * response — the file present, the bytes correct, the WAV valid — sent someone
 * looking for a missing file that was never missing.
 *
 * A message that names a cause it has not established is worse than one that
 * admits it does not know.
 */

/**
 * Turns a rejected `play()` into something worth reading.
 *
 * The names come from the DOM: `play()` rejects with a `DOMException` whose
 * `name` says which of a few quite different things happened.
 *
 * @example
 * describePlaybackFailure(new DOMException('', 'NotAllowedError'));
 * // => 'The browser would not start playback…'
 */
export function describePlaybackFailure(cause: unknown): string {
  const name = cause instanceof DOMException ? cause.name : '';

  switch (name) {
    case 'NotSupportedError':
      return 'This browser refused the recording. It is on disk and intact — the studio could not serve it in a form the browser would take.';
    case 'NotAllowedError':
      return 'The browser would not start playback without a click. Press play again.';
    case 'AbortError':
      // Ordinary: something else started playing before this one got going.
      return 'Playback was interrupted.';
    default:
      return cause instanceof Error && cause.message
        ? `That take could not be played: ${cause.message}`
        : 'That take could not be played.';
  }
}
