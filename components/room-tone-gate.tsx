'use client';

import {useState} from 'react';

import {ActionButton} from '@/components/action-button';
import {LevelMeter} from '@/components/level-meter';
import {MicrophonePicker} from '@/components/microphone-picker';
import {Card, CardContent, CardDescription, CardHeader, CardTitle} from '@/components/ui/card';
import type {Recorder} from '@/hooks/use-recorder';
import {ROOM_TONE_DURATION_SECONDS} from '@/lib/audio-constants';

interface RoomToneGateProps {
  recorder: Recorder;
  /** Called once the capture has been stored, with the session it started. */
  onCaptured: (sessionId: string) => void;
}

/** What the gate is doing, and therefore what the button says. */
type GateStatus = 'waiting' | 'listening' | 'saving';

function wait(milliseconds: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

/**
 * Captures how the room sounds before any recording starts.
 *
 * The measured floor is what the denoiser is keyed to for the whole sitting.
 * Keying it to the actual room is gentler on consonants than inferring a floor
 * from each take's own quiet moments, and aspirated consonants are exactly what
 * the Read track teaches.
 *
 * The capture is a fixed length, so it counts itself down and stops itself
 * rather than asking for a second keypress to end three seconds of silence.
 */
export function RoomToneGate({recorder, onCaptured}: RoomToneGateProps) {
  const [status, setStatus] = useState<GateStatus>('waiting');
  const [secondsLeft, setSecondsLeft] = useState(ROOM_TONE_DURATION_SECONDS);
  const [error, setError] = useState<string | null>(null);

  async function captureRoom(): Promise<void> {
    setError(null);
    setStatus('listening');
    recorder.start();

    for (let remaining = ROOM_TONE_DURATION_SECONDS; remaining > 0; remaining -= 1) {
      setSecondsLeft(remaining);
      await wait(1000);
    }

    // No preview: this is three seconds of deliberate silence, there is nothing
    // to listen to, and denoising it against itself would mean nothing.
    const take = await recorder.stop({preview: false});
    if (!take) {
      setError('Nothing was captured. Check that the microphone is connected.');
      setStatus('waiting');
      return;
    }

    setStatus('saving');
    try {
      const response = await fetch('/api/room-tone', {
        method: 'POST',
        headers: {'content-type': 'application/octet-stream'},
        body: new Blob([take.wavBytes as BlobPart]),
      });
      const body = (await response.json()) as {sessionId?: string; error?: string};
      if (!response.ok || !body.sessionId) {
        throw new Error(body.error ?? 'The room tone could not be saved.');
      }

      recorder.discard();
      onCaptured(body.sessionId);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
      setStatus('waiting');
    }
  }

  const label = {
    waiting: 'Capture the room',
    listening: `Listening… ${secondsLeft}`,
    saving: 'Saving…',
  }[status];

  return (
    <Card className="mx-auto w-full max-w-lg">
      <CardHeader>
        <CardTitle>Capture the room first</CardTitle>
        <CardDescription>
          {ROOM_TONE_DURATION_SECONDS} seconds of silence. Sit still and say nothing. This is
          what every take in this sitting will be cleaned against.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        {/* The last moment before a sitting's worth of takes is committed to one
            input, and therefore the right place to confirm which one. */}
        <MicrophonePicker
          microphones={recorder.microphones}
          selectedDeviceId={recorder.selectedDeviceId}
          onSelect={recorder.selectMicrophone}
          activeLabel={recorder.diagnostics?.deviceLabel ?? null}
        />

        <LevelMeter peakDecibels={recorder.peakDecibels} meanDecibels={recorder.meanDecibels} />

        {error ? <p className="text-sm text-destructive">{error}</p> : null}

        <ActionButton
          className="w-full"
          disabled={status !== 'waiting' || recorder.status === 'connecting'}
          onClick={() => void captureRoom()}
        >
          {label}
        </ActionButton>
      </CardContent>
    </Card>
  );
}
