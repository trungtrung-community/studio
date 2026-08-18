/**
 * @fileoverview What the spacebar does, decided on the press and acted on later.
 *
 * A take starts when Space comes back **up**, because a key makes its loudest
 * sound as it bottoms out — milliseconds after `keydown` fires — and a take that
 * begins on `keydown` therefore contains the press that began it. By the time
 * the key is released that clack is over.
 *
 * That alone is not enough, and the first version of it was wrong. Reading the
 * recorder's status on the release cannot distinguish "this key just stopped a
 * take" from "nothing is being recorded", because they look identical: in both,
 * the recorder is not recording. So a press that stopped a take was followed by
 * a release that immediately started a new one, and Space appeared to restart
 * rather than stop.
 *
 * The fix is to remember the press. A press decides what the pair of events will
 * do; the release only carries out what the press decided.
 */

/**
 * How far the current Space press has got.
 *
 * `armed` means the press did nothing, so its release should start a take.
 * `consumed` means the press already stopped one, so its release must not.
 */
export type SpacePress = 'idle' | 'armed' | 'consumed';

/** What the recorder should be told to do. Null means do nothing at all. */
export type SpaceAction = 'start' | 'stop' | null;

/** The press to remember, and what to do about the event that produced it. */
export interface SpaceOutcome {
  press: SpacePress;
  action: SpaceAction;
}

/**
 * Handles Space going down.
 *
 * @param isRecording Whether a take is being recorded at this moment.
 * @param isRepeat Whether the operating system generated this from a held key.
 *     Holding Space would otherwise stop and restart continuously.
 * @example
 * pressSpace('idle', false, false); // => {press: 'armed', action: null}
 * pressSpace('idle', true, false);  // => {press: 'consumed', action: 'stop'}
 */
export function pressSpace(
  press: SpacePress,
  isRecording: boolean,
  isRepeat: boolean,
): SpaceOutcome {
  if (isRepeat) {
    return {press, action: null};
  }
  if (isRecording) {
    return {press: 'consumed', action: 'stop'};
  }
  return {press: 'armed', action: null};
}

/**
 * Handles Space coming back up.
 *
 * Starts a take only for a press that did nothing. A release with no press
 * behind it — the tab was focused mid-keystroke, or a dialog owned the press —
 * does nothing, which is why the state is consulted rather than the recorder.
 *
 * @example
 * releaseSpace('armed');    // => {press: 'idle', action: 'start'}
 * releaseSpace('consumed'); // => {press: 'idle', action: null}
 */
export function releaseSpace(press: SpacePress): SpaceOutcome {
  return {press: 'idle', action: press === 'armed' ? 'start' : null};
}
