'use client';

/**
 * @fileoverview Which version of the take is on screen and in your ears.
 *
 * The waveform and the playhead follow the choice, because the two versions are
 * different lengths — the chain trims the silence off both ends — and a playhead
 * running against the wrong picture would be worse than no playhead.
 *
 * So the screen has to say which one it is showing. Without that line, a take
 * that suddenly looks shorter reads as a recording fault rather than as the trim
 * doing its job.
 */

import type {MasteringStatus, PreviewMode} from '@/hooks/use-recorder';
import {cn} from '@/lib/utils';

interface PreviewStateProps {
  mode: PreviewMode;
  status: MasteringStatus;
  /** What went wrong, when something did. Shown, not swallowed. */
  failure: string | null;
  onCompare: () => void;
}

export function PreviewState({mode, status, failure, onCompare}: PreviewStateProps) {
  if (status === 'none') {
    return null;
  }

  if (status === 'pending' && mode === 'mastered') {
    return <p className="text-xs text-muted-foreground">Mastering…</p>;
  }

  // Loud, because the failure is silent otherwise: playback falls back to the
  // raw capture, and a raw take that is believed to be the processed one is the
  // exact surprise this screen exists to prevent.
  if (status === 'failed') {
    return (
      <div className="space-y-0.5">
        <p className="text-xs font-medium text-destructive">
          Not mastered — you are hearing the raw capture, not what will ship. The take can
          still be kept; mastering runs over everything again after the session.
        </p>
        {failure ? (
          <p className="font-mono text-[0.6875rem] text-muted-foreground">{failure}</p>
        ) : null}
      </div>
    );
  }

  const isMastered = mode === 'mastered';

  return (
    <p className="flex items-center justify-center gap-2 text-xs text-muted-foreground">
      <span className={cn(isMastered && 'text-fg-accent')}>
        {isMastered ? 'As it will ship' : 'Raw capture, nothing removed'}
      </span>
      <button
        type="button"
        onClick={onCompare}
        className="hover:bg-accent rounded-md px-2 py-0.5 underline underline-offset-2 transition-colors"
      >
        hear the {isMastered ? 'raw take' : 'shipped version'}
      </button>
    </p>
  );
}
