'use client';

/**
 * @fileoverview One sitting at the microphone.
 *
 * The keyboard is the interface. At a hundred and fifty takes a sitting the
 * interaction is the bottleneck, so every action has a key and the hands never
 * have to leave it. The buttons on screen are labels for those keys.
 */

import Link from 'next/link';
import {useCallback, useEffect, useMemo, useRef, useState} from 'react';
import {toast} from 'sonner';

import {ActionButton} from '@/components/action-button';
import {CaptureDiagnostics} from '@/components/capture-diagnostics';
import {DissentDialog} from '@/components/dissent-dialog';
import {ElapsedTimer, PlaybackTime} from '@/components/elapsed-timer';
import {ItemListDialog} from '@/components/item-list-dialog';
import {LevelMeter} from '@/components/level-meter';
import {MicrophonePicker} from '@/components/microphone-picker';
import {PreviewState} from '@/components/preview-state';
import {RecordCard} from '@/components/record-card';
import {RoomToneGate} from '@/components/room-tone-gate';
import {SetAsidePrompt} from '@/components/set-aside-prompt';
import {WaveformView} from '@/components/waveform-view';
import {Alert, AlertDescription, AlertTitle} from '@/components/ui/alert';
import {Progress} from '@/components/ui/progress';
import {useRecorder} from '@/hooks/use-recorder';
import type {RecordingGroup} from '@/lib/recording-plan';
import {
  pressSpace,
  releaseSpace,
  type SpaceAction,
  type SpacePress,
} from '@/lib/space-key';
import type {RecordedTake, SetAsideReason} from '@/lib/take-ledger';
import {cn} from '@/lib/utils';

interface RecordingSessionProps {
  group: RecordingGroup;
  /** Items with a take already standing when the page loaded. */
  recordedItemIds: string[];
  /** Items being passed over, already filtered to those still in doubt. */
  setAsideItemIds: string[];
  /** Whether the room has been captured recently enough to still apply. */
  hasFreshRoomTone: boolean;
  /** Item to open on, used when arriving from the dashboard's quality panel. */
  startAtItemId?: string;
}

/** Each key, and what it does, shown along the bottom of the screen. */
const KEY_HINTS = [
  {key: 'Space', action: 'record / stop'},
  {key: 'P', action: 'play as it will ship'},
  {key: '⇧P', action: 'play the raw take'},
  {key: 'Enter', action: 'keep and move on'},
  {key: 'R', action: 'redo'},
  {key: 'F', action: 'set aside'},
  {key: 'N', action: 'write a note'},
  {key: 'L', action: 'all cards'},
  {key: '← →', action: 'move'},
] as const;

export function RecordingSession({
  group,
  recordedItemIds,
  setAsideItemIds,
  hasFreshRoomTone,
  startAtItemId,
}: RecordingSessionProps) {
  const recorder = useRecorder();

  const [index, setIndex] = useState(() => {
    const requested = group.items.findIndex((item) => item.id === startAtItemId);
    if (requested !== -1) {
      return requested;
    }
    // Otherwise open on the first card that has been neither recorded nor passed
    // over, so resuming a group never lands on the doubtful card that stopped it
    // last time.
    const firstOutstanding = group.items.findIndex(
      (item) => !recordedItemIds.includes(item.id) && !setAsideItemIds.includes(item.id),
    );
    return firstOutstanding === -1 ? 0 : firstOutstanding;
  });

  const [recorded, setRecorded] = useState(() => new Set(recordedItemIds));
  const [setAside, setSetAside] = useState(() => new Set(setAsideItemIds));
  const [needsRoomTone, setNeedsRoomTone] = useState(!hasFreshRoomTone);
  const [isSaving, setIsSaving] = useState(false);
  const [isDissentOpen, setIsDissentOpen] = useState(false);
  const [isSetAsideOpen, setIsSetAsideOpen] = useState(false);
  const [isItemListOpen, setIsItemListOpen] = useState(false);

  /**
   * What the Space key currently being held has already done.
   *
   * A ref rather than state: it changes on every keystroke, nothing renders from
   * it, and a stale copy read from a closure is exactly the bug this replaced.
   */
  const spacePressRef = useRef<SpacePress>('idle');

  const item = group.items[index];
  const takesThisSitting = useMemo(
    () => recorded.size - recordedItemIds.length,
    [recorded, recordedItemIds.length],
  );

  // The microphone is opened by `useRecorder` itself. It used to be opened from
  // an effect here, whose dependency was a new object on every render, so it ran
  // again while the first call was still awaiting permission — and two capture
  // graphs ended up pushing into one buffer. Nothing on this screen should own
  // that lifecycle.

  const moveTo = useCallback(
    (nextIndex: number) => {
      if (nextIndex < 0 || nextIndex >= group.items.length) {
        return;
      }
      recorder.discard();
      setIndex(nextIndex);
    },
    [group.items.length, recorder],
  );

  const keepTake = useCallback(async () => {
    if (!recorder.take || isSaving) {
      return;
    }
    // The one warning that refuses the take rather than noting it. The others
    // describe a recording that is merely poor; this one says the samples are
    // not a record of what was said, so keeping it would put known-bad audio in
    // front of a learner.
    if (recorder.take.captureFault) {
      toast.error(recorder.take.captureFault.message);
      return;
    }
    setIsSaving(true);

    try {
      const response = await fetch(`/api/take/${encodeURIComponent(item.id)}`, {
        method: 'POST',
        headers: {'content-type': 'application/octet-stream'},
        body: new Blob([recorder.take.wavBytes as BlobPart]),
      });
      const body = (await response.json()) as RecordedTake & {error?: string};
      if (!response.ok) {
        throw new Error(body.error ?? 'The take could not be saved.');
      }

      for (const warning of body.warnings) {
        toast.warning(warning.message);
      }

      setRecorded((previous) => new Set(previous).add(item.id));
      // Recording a card is the strongest possible statement that it is no
      // longer being passed over, and the ledger says the same.
      setSetAside((previous) => {
        if (!previous.has(item.id)) {
          return previous;
        }
        const next = new Set(previous);
        next.delete(item.id);
        return next;
      });
      recorder.discard();
      // Advancing past the end stays on the last item, so finishing a group
      // does not leave the screen blank.
      setIndex((previous) => Math.min(previous + 1, group.items.length - 1));
    } catch (cause) {
      toast.error(cause instanceof Error ? cause.message : String(cause));
    } finally {
      setIsSaving(false);
    }
  }, [recorder, isSaving, item, group.items.length]);

  /**
   * Passes the current card over and moves on.
   *
   * The take in hand goes with it. Someone who has just said a card is wrong is
   * not keeping the recording of themselves saying it.
   */
  const setCardAside = useCallback(
    async (reason: SetAsideReason) => {
      setIsSetAsideOpen(false);

      try {
        const response = await fetch(`/api/set-aside/${encodeURIComponent(item.id)}`, {
          method: 'POST',
          headers: {'content-type': 'application/json'},
          body: JSON.stringify({reason}),
        });
        if (!response.ok) {
          const body = (await response.json()) as {error?: string};
          throw new Error(body.error ?? 'The card could not be set aside.');
        }

        setSetAside((previous) => new Set(previous).add(item.id));
        toast.success('Set aside');
        recorder.discard();
        setIndex((previous) => Math.min(previous + 1, group.items.length - 1));
      } catch (cause) {
        toast.error(cause instanceof Error ? cause.message : String(cause));
      }
    },
    [item, recorder, group.items.length],
  );

  useEffect(() => {
    /**
     * Whether this key event belongs to the screen at all.
     *
     * A dialog owns the keyboard while it is open, and a text field always does.
     * Modified keys belong to the browser.
     */
    function isOurs(event: KeyboardEvent): boolean {
      if (
        isDissentOpen ||
        isSetAsideOpen ||
        isItemListOpen ||
        event.metaKey ||
        event.ctrlKey ||
        event.altKey
      ) {
        return false;
      }
      const target = event.target as HTMLElement | null;
      return !(target && ['INPUT', 'TEXTAREA'].includes(target.tagName));
    }

    /**
     * Carries out what a Space press or release decided.
     *
     * The decision is {@link pressSpace} and {@link releaseSpace}; this only
     * acts on it. See `lib/space-key.ts` for why the press has to be remembered
     * rather than inferred from the recorder's status.
     */
    function applySpaceAction(action: SpaceAction): void {
      if (action === 'start') {
        recorder.start();
      } else if (action === 'stop') {
        // The take is stored by the recorder itself; nothing here needs to wait
        // for the flush that finishes it.
        void recorder.stop();
      }
    }

    function handleKeyUp(event: KeyboardEvent): void {
      if (!isOurs(event) || event.key !== ' ') {
        return;
      }
      event.preventDefault();
      const outcome = releaseSpace(spacePressRef.current);
      spacePressRef.current = outcome.press;
      applySpaceAction(outcome.action);
    }

    /**
     * Forgets a press whose release this screen will never see.
     *
     * Switching window with Space held would otherwise leave the press armed,
     * and the next release — whenever it came — would start a take nobody asked
     * for.
     */
    function handleBlur(): void {
      spacePressRef.current = 'idle';
    }

    function handleKeyDown(event: KeyboardEvent): void {
      if (!isOurs(event)) {
        return;
      }

      switch (event.key) {
        case ' ': {
          // Always prevented, so Space never scrolls the page or activates a
          // focused button, whether or not it does anything here.
          event.preventDefault();
          const outcome = pressSpace(
            spacePressRef.current,
            recorder.status === 'recording',
            event.repeat,
          );
          spacePressRef.current = outcome.press;
          applySpaceAction(outcome.action);
          break;
        }
        case 'Enter':
          event.preventDefault();
          void keepTake();
          break;
        // Lower case is the processed take, upper case the raw capture. The
        // shift is the whole difference, so the pair reads as one control rather
        // than as two keys that happen to be near each other.
        case 'p':
          event.preventDefault();
          if (recorder.previewMode !== 'mastered') {
            recorder.setPreviewMode('mastered');
          }
          recorder.play();
          break;
        case 'P':
          event.preventDefault();
          if (recorder.previewMode !== 'raw') {
            recorder.setPreviewMode('raw');
          }
          recorder.play();
          break;
        case 'r':
        case 'R':
          event.preventDefault();
          recorder.discard();
          break;
        case 'f':
        case 'F':
          event.preventDefault();
          setIsSetAsideOpen(true);
          break;
        case 'n':
        case 'N':
          event.preventDefault();
          setIsDissentOpen(true);
          break;
        case 'l':
        case 'L':
          event.preventDefault();
          setIsItemListOpen(true);
          break;
        case 'ArrowLeft':
          event.preventDefault();
          moveTo(index - 1);
          break;
        case 'ArrowRight':
          event.preventDefault();
          moveTo(index + 1);
          break;
        default:
          break;
      }
    }

    window.addEventListener('keydown', handleKeyDown);
    window.addEventListener('keyup', handleKeyUp);
    window.addEventListener('blur', handleBlur);
    return () => {
      window.removeEventListener('keydown', handleKeyDown);
      window.removeEventListener('keyup', handleKeyUp);
      window.removeEventListener('blur', handleBlur);
    };
  }, [recorder, keepTake, moveTo, index, isDissentOpen, isSetAsideOpen, isItemListOpen]);

  if (recorder.status === 'error') {
    return (
      <div className="mx-auto max-w-lg p-8 text-center">
        <p className="text-sm text-destructive">{recorder.error}</p>
        <p className="mt-2 text-sm text-muted-foreground">
          The studio needs permission to use the microphone. Allow it, then reload.
        </p>
      </div>
    );
  }

  if (needsRoomTone) {
    return (
      <div className="mx-auto max-w-5xl p-8">
        <RoomToneGate recorder={recorder} onCaptured={() => setNeedsRoomTone(false)} />
      </div>
    );
  }

  const isRecording = recorder.status === 'recording';

  return (
    <div className="mx-auto flex w-full max-w-2xl flex-col gap-6 p-8">
      <header className="flex items-end justify-between">
        <div className="space-y-1">
          <Link
            href="/"
            className="text-xs tracking-[var(--tracking-caps)] text-muted-foreground uppercase hover:text-fg-accent"
          >
            ← all groups
          </Link>
          <h1 className="font-heading text-2xl font-bold">{group.title}</h1>
        </div>
        <div className="text-right">
          <p className="font-heading text-2xl font-bold tabular-nums">
            {recorded.size}
            <span className="text-muted-foreground"> / {group.items.length}</span>
          </p>
          <p className="text-xs text-muted-foreground">
            {takesThisSitting} this sitting
            {setAside.size > 0 ? ` · ${setAside.size} set aside` : null}
          </p>
        </div>
      </header>

      <Progress value={(recorded.size / group.items.length) * 100} className="h-1.5" />

      <RecordCard
        item={item}
        position={index + 1}
        total={group.items.length}
        isRecorded={recorded.has(item.id)}
        isSetAside={setAside.has(item.id)}
      />

      {/* The take's shape, which answers most of what a playback would: whether
          it clipped, whether anything arrived, whether the end was cut off. */}
      <div className="space-y-2">
        <WaveformView
          liveTrace={recorder.liveTraceRef}
          isRecording={isRecording}
          samples={recorder.displayedSamples}
          getPlaybackPosition={recorder.getPlaybackPosition}
          durationSeconds={recorder.takeDurationSeconds}
          onSeek={recorder.seek}
        />
        <div className="text-muted-foreground flex items-center justify-between text-xs">
          {recorder.take ? (
            <PlaybackTime
              getPlaybackPosition={recorder.getPlaybackPosition}
              durationSeconds={recorder.takeDurationSeconds}
            />
          ) : (
            <ElapsedTimer
              elapsedMilliseconds={recorder.elapsedMillisecondsRef}
              isRunning={isRecording}
              className={cn(isRecording && 'text-crown-600 font-semibold')}
            />
          )}
          {recorder.take ? (
            <span className="font-mono tabular-nums">
              peak {recorder.take.analysis.peakDecibels} dBFS
            </span>
          ) : null}
        </div>
      </div>

      <LevelMeter peakDecibels={recorder.peakDecibels} meanDecibels={recorder.meanDecibels} />
      <CaptureDiagnostics diagnostics={recorder.diagnostics} />

      <MicrophonePicker
        microphones={recorder.microphones}
        selectedDeviceId={recorder.selectedDeviceId}
        onSelect={recorder.selectMicrophone}
        activeLabel={recorder.diagnostics?.deviceLabel ?? null}
      />

      {recorder.take?.captureFault ? (
        <Alert variant="destructive">
          <AlertTitle>This take was not captured correctly</AlertTitle>
          <AlertDescription>
            {recorder.take.captureFault.message}
          </AlertDescription>
        </Alert>
      ) : null}

      <SetAsidePrompt
        open={isSetAsideOpen}
        onChoose={(reason) => void setCardAside(reason)}
        onCancel={() => setIsSetAsideOpen(false)}
      />

      {/* Each control names its key rather than spelling it into the label, so
          the button and the footer hint read as the same object. */}
      <div className="flex flex-wrap items-center justify-center gap-2">
        <ActionButton
          className="h-11 gap-2.5 px-5 text-base"
          variant={isRecording ? 'destructive' : 'default'}
          onClick={() => (isRecording ? void recorder.stop() : recorder.start())}
        >
          {isRecording ? 'Stop' : 'Record'}
          <kbd className="keycap">Space</kbd>
        </ActionButton>

        <ActionButton
          className="h-11 gap-2.5 px-4"
          variant="secondary"
          disabled={!recorder.take}
          onClick={() => {
            recorder.setPreviewMode('mastered');
            recorder.play();
          }}
        >
          {recorder.isPlaying && recorder.previewMode === 'mastered' ? 'Pause' : 'Play'}
          <kbd className="keycap">P</kbd>
        </ActionButton>

        <ActionButton
          className="h-11 gap-2.5 px-4"
          variant="secondary"
          disabled={!recorder.take}
          onClick={() => recorder.discard()}
        >
          Redo
          <kbd className="keycap">R</kbd>
        </ActionButton>

        <ActionButton
          className="h-11 gap-2.5 px-5 text-base"
          disabled={!recorder.take || isSaving}
          onClick={() => void keepTake()}
        >
          {isSaving ? 'Saving…' : 'Keep'}
          {isSaving ? null : <kbd className="keycap">Enter</kbd>}
        </ActionButton>
      </div>

      {/* The measurements describe the raw capture, always. The processed take
          is normalised to a fixed loudness, so its peak is the same on every
          take and says nothing about whether this one clipped. */}
      {recorder.take ? (
        <div className="space-y-1.5 text-center">
          <p className="font-mono text-xs tabular-nums text-muted-foreground">
            {(recorder.take.analysis.durationMilliseconds / 1000).toFixed(2)} s · peak{' '}
            {recorder.take.analysis.peakDecibels} dBFS
          </p>
          <PreviewState
            mode={recorder.previewMode}
            status={recorder.take.masteringStatus}
            failure={recorder.take.masteringFailure}
            onCompare={() =>
              recorder.setPreviewMode(
                recorder.previewMode === 'mastered' ? 'raw' : 'mastered',
              )
            }
          />
        </div>
      ) : null}

      <footer className="flex flex-wrap items-center justify-center gap-x-5 gap-y-3 pt-4">
        {KEY_HINTS.map((hint) => (
          <span key={hint.key} className="flex items-center gap-2 text-xs text-muted-foreground">
            <kbd className="keycap">{hint.key}</kbd>
            {hint.action}
          </span>
        ))}
      </footer>

      <DissentDialog
        item={item}
        open={isDissentOpen}
        onOpenChange={setIsDissentOpen}
      />

      <ItemListDialog
        items={group.items}
        currentItemId={item.id}
        recordedItemIds={recorded}
        setAsideItemIds={setAside}
        open={isItemListOpen}
        onOpenChange={setIsItemListOpen}
        onJump={moveTo}
      />
    </div>
  );
}
