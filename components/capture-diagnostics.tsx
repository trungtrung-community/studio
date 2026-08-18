'use client';

/**
 * @fileoverview What the microphone reports about itself.
 *
 * Small, permanent, and worth the room. Every value here was invisible while the
 * recorder was quietly producing unusable audio: two capture graphs were live at
 * once, and nothing on screen said so — the fault only surfaced on playback,
 * after a session's worth of takes could already have been lost.
 *
 * The graph count is the one that matters. Anything but one is a fault, and it
 * says so rather than leaving the number to be interpreted.
 */

import {CAPTURE_SAMPLE_RATE_HERTZ} from '@/lib/audio-constants';
import type {CaptureDiagnostics as Diagnostics} from '@/hooks/use-recorder';
import {cn} from '@/lib/utils';

/** One reading, dimmed unless it is wrong. */
function Reading({label, value, isFault}: {label: string; value: string; isFault?: boolean}) {
  return (
    <span className={cn('flex items-baseline gap-1.5', isFault && 'text-crown-600')}>
      <span className="tracking-[var(--tracking-caps)] uppercase">{label}</span>
      <span className="font-mono tabular-nums">{value}</span>
    </span>
  );
}

/** The microphone's own account of the capture, under the meter. */
export function CaptureDiagnostics({diagnostics}: {diagnostics: Diagnostics | null}) {
  if (!diagnostics) {
    return null;
  }

  const {
    sampleRateHertz,
    channelCount,
    graphCount,
    inputLatencyMilliseconds,
    isInputLatencyReported,
  } = diagnostics;
  const rateIsUnexpected = sampleRateHertz !== CAPTURE_SAMPLE_RATE_HERTZ;
  const graphsAreWrong = graphCount !== 1;

  return (
    <div className="text-muted-foreground flex flex-wrap items-center justify-center gap-x-5 gap-y-1 text-[0.6875rem]">
      <Reading
        label="rate"
        value={`${(sampleRateHertz / 1000).toFixed(1)} kHz`}
        isFault={rateIsUnexpected}
      />
      <Reading label="in" value={channelCount === 1 ? 'mono' : `${channelCount} ch`} />
      <Reading
        label="graphs"
        value={graphsAreWrong ? `${graphCount} — fault` : '1'}
        isFault={graphsAreWrong}
      />
      {/* Compensated for at both ends of every take, so it is worth being able
          to see. "assumed" means the browser would not report a figure and this
          is the studio's stand-in, which is a different thing from a reading. */}
      <Reading
        label="latency"
        value={`${inputLatencyMilliseconds} ms${isInputLatencyReported ? '' : ' assumed'}`}
      />
    </div>
  );
}
