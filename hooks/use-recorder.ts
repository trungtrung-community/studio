'use client';

/**
 * @fileoverview The take currently in hand, and the microphone behind it.
 *
 * A take lives in the page until the speaker accepts it. Redoing discards it
 * without the server ever seeing it, so an abandoned take leaves no file to
 * clean up. The cost is that an interrupted page loses at most one recording,
 * which is three seconds of work.
 *
 * **The hook opens and closes the microphone itself.** It used to expose a
 * `connect()` for the screen to call from an effect, and that is how two capture
 * graphs came to exist at once: the effect's dependency was a fresh object every
 * render, so it re-ran, and the second call passed the guard while the first was
 * still awaiting permission. Owning the lifecycle here removes the opportunity.
 * `MicrophoneCapture` makes it safe even so.
 *
 * Two things deliberately never enter React state: the live level, which is
 * measured sixty times a second, and the playhead, which moves every frame. Both
 * are read through refs and functions instead, because a component re-rendering
 * at those rates is the fault this file exists to have removed.
 */

import {useCallback, useEffect, useRef, useState} from 'react';

import {
  KEYPRESS_GUARD_MILLISECONDS,
  KEYPRESS_TAIL_GUARD_MILLISECONDS,
  LIVE_BAR_MILLISECONDS,
  SILENCE_DECIBELS,
} from '@/lib/audio-constants';
import {smoothLevel} from '@/lib/level-smoothing';
import {
  MicrophoneCapture,
  liveGraphCount,
  trimLeadIn,
  trimTail,
} from '@/lib/microphone-capture';
import {
  playbackPositionAt,
  resumeFrom,
  type PlaybackWindow,
} from '@/lib/playback-position';
import {LiveTrace} from '@/lib/waveform';
import {
  analyseTake,
  encodeWav,
  findCaptureFault,
  toDecibels,
  type QualityWarning,
  type TakeAnalysis,
} from '@/lib/wav-codec';

/** What the recorder is doing, and therefore which keys do anything. */
export type RecorderStatus = 'connecting' | 'ready' | 'recording' | 'recorded' | 'error';

/** Which version of a take is being listened to. */
export type PreviewMode = 'mastered' | 'raw';

/** How far the mastered version of the held take has got. */
export type MasteringStatus = 'none' | 'pending' | 'ready' | 'failed';

/** Audio that can be played and drawn, whichever version it is. */
export interface PlayableAudio {
  samples: Float32Array<ArrayBuffer>;
  sampleRateHertz: number;
  durationSeconds: number;
  /**
   * Already decoded, for audio that arrived encoded.
   *
   * Null for the raw capture, which is samples to begin with and is turned into
   * a buffer at the moment it is played.
   */
  audioBuffer: AudioBuffer | null;
}

/** Options for ending a take. */
export interface StopOptions {
  /**
   * Whether to master the take so it can be heard as it will ship.
   *
   * False for the room tone, which is three seconds of deliberate silence: there
   * is nothing to listen to, and running it through a denoiser keyed to itself
   * would mean nothing.
   */
  preview?: boolean;
}

/** A finished recording, held in the page until it is accepted or discarded. */
export interface HeldTake {
  /**
   * The captured audio, with the keypress guard already removed.
   *
   * Pinned to a plain `ArrayBuffer` rather than the wider `ArrayBufferLike`,
   * because `AudioBuffer.copyToChannel` refuses a view that might be backed by
   * shared memory.
   */
  samples: Float32Array<ArrayBuffer>;
  wavBytes: Uint8Array;
  analysis: TakeAnalysis;
  /** The rate the graph actually ran at, which playback has to match. */
  sampleRateHertz: number;
  /**
   * A capture fault, when the recorded length disagrees with the time that
   * passed. Present means the audio is not a faithful record and the take has
   * to go, however good it measures.
   */
  captureFault: QualityWarning | null;
  /**
   * The take put through the same chain the batch pass runs — what will ship.
   *
   * Null until it has been rendered, and if it never is. It is shorter than the
   * raw capture, because the chain trims the silence at both ends.
   */
  mastered: PlayableAudio | null;
  masteringStatus: MasteringStatus;
  /** Why mastering failed, when it did. Shown rather than swallowed. */
  masteringFailure: string | null;
}

/** What the microphone reports about itself, shown on screen. */
export interface CaptureDiagnostics {
  sampleRateHertz: number;
  channelCount: number;
  /** Capture graphs live in this tab. Anything but one is a fault. */
  graphCount: number;
  /** The microphone actually in use, read back from the live track. */
  deviceLabel: string;
  /**
   * How far behind the microphone the page is running, in milliseconds.
   *
   * Shown because it is compensated for rather than merely tolerated, and a
   * compensation nobody can see is one nobody can check.
   */
  inputLatencyMilliseconds: number;
  /** False when the browser would not report a latency and one was assumed. */
  isInputLatencyReported: boolean;
}

/** A microphone the browser will let the studio record from. */
export interface MicrophoneOption {
  deviceId: string;
  label: string;
}

/** The recorder, as the recording screen uses it. */
export interface Recorder {
  status: RecorderStatus;
  /** Smoothed peak level in dBFS. Says whether anything clipped. */
  peakDecibels: number;
  /**
   * Smoothed mean level in dBFS. Says how loud the sound actually is.
   *
   * Steady where the peak of the same sound is not, because the peak of noise is
   * itself noisy. This is the number to set the microphone's gain by.
   */
  meanDecibels: number;
  take: HeldTake | null;
  error: string | null;
  diagnostics: CaptureDiagnostics | null;

  microphones: MicrophoneOption[];
  /** The chosen input. Undefined means whichever the system calls default. */
  selectedDeviceId: string | undefined;
  /** Switches microphone, which closes the current graph and opens another. */
  selectMicrophone: (deviceId: string) => void;

  /**
   * The trace of what the microphone is hearing, while a take is being recorded.
   *
   * Read during a `requestAnimationFrame` draw rather than rendered. Empty
   * between takes: a trace that scrolls when nothing is being recorded shows
   * motion where there is no recording, and the level meter already reports that
   * the microphone is live.
   */
  liveTraceRef: React.RefObject<LiveTrace>;
  /** Wall-clock milliseconds since recording began. Zero when not recording. */
  elapsedMillisecondsRef: React.RefObject<number>;

  start: () => void;
  /**
   * Ends the recording.
   *
   * Resolves rather than returns, because the capture goes on for one input
   * latency past the request and then waits for the audio thread to confirm that
   * every block has been sent. Cutting at the request instead would leave the
   * last word of the take out of the file.
   *
   * Yields the take as well as storing it, so a caller driving a fixed-length
   * capture can carry straight on with it rather than waiting for a render.
   */
  stop: (options?: StopOptions) => Promise<HeldTake | null>;
  /** Throws the held take away without sending it anywhere. */
  discard: () => void;

  isPlaying: boolean;
  /** Seconds into the held take, or zero. Call per frame; never rendered. */
  getPlaybackPosition: () => number;
  /** The length of whichever version is being listened to, for the playhead. */
  takeDurationSeconds: number;
  /** Starts playback from the playhead, or stops it where it is. */
  play: () => void;
  /** Moves the playhead, continuing from there if it was playing. */
  seek: (seconds: number) => void;

  previewMode: PreviewMode;
  /** Switches between the processed take and the raw capture. */
  setPreviewMode: (mode: PreviewMode) => void;
  /**
   * The samples to draw: the version being listened to.
   *
   * The two are different lengths, so the waveform has to follow the choice or
   * the playhead would run against the wrong picture.
   */
  displayedSamples: Float32Array<ArrayBuffer> | null;
}

/** How often the smoothed level is committed to React state. */
const METER_TICK_MILLISECONDS = 50;

/**
 * Bars kept in the live trace.
 *
 * The trace fills the left half of the waveform, so this is half the bars drawn
 * across it. At forty milliseconds a bar that is a little over three seconds of
 * history — the recent past, scrolling past a fixed line, rather than a whole
 * take squeezed into a fixed width.
 */
const LIVE_TRACE_BARS = 80;

/** Where the chosen microphone is remembered between sittings. */
const DEVICE_STORAGE_KEY = 'trungtrung-studio.microphone';

function readStoredDeviceId(): string | undefined {
  if (typeof window === 'undefined') {
    return undefined;
  }
  return window.localStorage.getItem(DEVICE_STORAGE_KEY) ?? undefined;
}

/**
 * Opens the microphone and records single takes from it.
 *
 * @example
 * const recorder = useRecorder();
 * recorder.start();
 * recorder.stop();
 * recorder.take?.analysis.peakDecibels; // => -8.3
 */
export function useRecorder(): Recorder {
  const [status, setStatus] = useState<RecorderStatus>('connecting');
  const [peakDecibels, setPeakDecibels] = useState(SILENCE_DECIBELS);
  const [meanDecibels, setMeanDecibels] = useState(SILENCE_DECIBELS);
  const [take, setTake] = useState<HeldTake | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [diagnostics, setDiagnostics] = useState<CaptureDiagnostics | null>(null);
  const [microphones, setMicrophones] = useState<MicrophoneOption[]>([]);
  const [selectedDeviceId, setSelectedDeviceId] = useState<string | undefined>(
    readStoredDeviceId,
  );
  const [isPlaying, setIsPlaying] = useState(false);
  const [previewMode, setPreviewModeState] = useState<PreviewMode>('mastered');

  const captureRef = useRef<MicrophoneCapture | null>(null);
  const measuredPeakRef = useRef(SILENCE_DECIBELS);
  const measuredMeanRef = useRef(SILENCE_DECIBELS);
  const liveTraceRef = useRef(
    new LiveTrace({barMilliseconds: LIVE_BAR_MILLISECONDS, capacity: LIVE_TRACE_BARS}),
  );
  const elapsedMillisecondsRef = useRef(0);
  const startedAtRef = useRef(0);

  const takeRef = useRef<HeldTake | null>(null);
  const playbackContextRef = useRef<AudioContext | null>(null);
  const sourceRef = useRef<AudioBufferSourceNode | null>(null);
  const playbackWindowRef = useRef<PlaybackWindow | null>(null);
  const pausedPositionRef = useRef(0);
  const isPlayingRef = useRef(false);
  // Read inside callbacks that must not be rebuilt when the mode changes.
  const previewModeRef = useRef<PreviewMode>('mastered');

  useEffect(() => {
    takeRef.current = take;
  }, [take]);

  // Which version is on screen and under the playhead. Mastered only once it has
  // arrived, so the picture never claims to be something that is not ready.
  const displayed =
    take && previewMode === 'mastered' && take.mastered
      ? take.mastered
      : take
        ? {samples: take.samples, durationSeconds: take.samples.length / take.sampleRateHertz}
        : null;
  const takeDurationSeconds = displayed?.durationSeconds ?? 0;

  // Created inside the effect, not during render. React remounts a component in
  // development to prove its cleanup works, and a capture built during render
  // would be disposed by that cleanup while the second effect found only the
  // emptied ref and opened nothing.
  //
  // Re-runs when the microphone changes: the old graph is closed and a new one
  // opened, which is the only correct way to swap an input.
  useEffect(() => {
    const capture = new MicrophoneCapture({deviceId: selectedDeviceId});
    captureRef.current = capture;

    const unsubscribe = capture.onLevel((level) => {
      // The meter reads whether or not a take is being recorded. The trace does
      // not: it draws the take, and there is no take between presses.
      measuredPeakRef.current = Math.max(measuredPeakRef.current, toDecibels(level.peak));
      measuredMeanRef.current = Math.max(measuredMeanRef.current, toDecibels(level.mean));
      if (!capture.isRecording) {
        return;
      }
      const now = performance.now();
      liveTraceRef.current.observe(level.peak, now);
      elapsedMillisecondsRef.current = now - startedAtRef.current;
    });

    capture
      .open()
      .then(async () => {
        if (!capture.openGraph) {
          return;
        }
        setStatus('ready');
        // Labels are only revealed once permission has been granted, so the list
        // is worth nothing until the microphone is already open.
        const devices = await navigator.mediaDevices.enumerateDevices();
        setMicrophones(
          devices
            .filter((device) => device.kind === 'audioinput')
            .map((device) => ({
              deviceId: device.deviceId,
              label: device.label || 'Unnamed microphone',
            })),
        );
      })
      .catch((cause: unknown) => {
        setError(cause instanceof Error ? cause.message : String(cause));
        setStatus('error');
      });

    return () => {
      unsubscribe();
      captureRef.current = null;
      void capture.dispose();
    };
  }, [selectedDeviceId]);

  // Plugging the Yeti in mid-session should make it selectable without a reload.
  useEffect(() => {
    const refresh = () => {
      void navigator.mediaDevices.enumerateDevices().then((devices) => {
        setMicrophones(
          devices
            .filter((device) => device.kind === 'audioinput')
            .map((device) => ({
              deviceId: device.deviceId,
              label: device.label || 'Unnamed microphone',
            })),
        );
      });
    };
    navigator.mediaDevices.addEventListener('devicechange', refresh);
    return () => navigator.mediaDevices.removeEventListener('devicechange', refresh);
  }, []);

  // The meter runs on its own clock. Measurement happens sixty times a second on
  // the audio thread; only the smoothed result reaches React, twenty times a
  // second, which is the difference between an instrument and a strobe.
  useEffect(() => {
    const timer = setInterval(() => {
      setPeakDecibels((displayed) => {
        const next = smoothLevel(displayed, measuredPeakRef.current, METER_TICK_MILLISECONDS);
        measuredPeakRef.current = SILENCE_DECIBELS;
        return next;
      });
      setMeanDecibels((displayed) => {
        const next = smoothLevel(displayed, measuredMeanRef.current, METER_TICK_MILLISECONDS);
        measuredMeanRef.current = SILENCE_DECIBELS;
        return next;
      });

      // Re-read rather than latch at open. A remount closes one graph and opens
      // another, so the count is briefly two before it settles — a latched
      // reading would report that moment as a permanent fault.
      const graph = captureRef.current?.openGraph;
      setDiagnostics((previous) => {
        if (!graph) {
          return null;
        }
        const next: CaptureDiagnostics = {
          sampleRateHertz: graph.sampleRate,
          channelCount: graph.channelCount,
          graphCount: liveGraphCount(),
          deviceLabel: graph.deviceLabel,
          inputLatencyMilliseconds: Math.round(graph.inputLatency.seconds * 1000),
          isInputLatencyReported: graph.inputLatency.isReported,
        };
        const unchanged =
          previous !== null &&
          previous.sampleRateHertz === next.sampleRateHertz &&
          previous.channelCount === next.channelCount &&
          previous.graphCount === next.graphCount &&
          previous.deviceLabel === next.deviceLabel &&
          previous.inputLatencyMilliseconds === next.inputLatencyMilliseconds &&
          previous.isInputLatencyReported === next.isInputLatencyReported;
        return unchanged ? previous : next;
      });
    }, METER_TICK_MILLISECONDS);
    return () => clearInterval(timer);
  }, []);

  const stopPlayback = useCallback((): void => {
    const source = sourceRef.current;
    if (source) {
      // Detached first. `onended` fires both when a take finishes and when the
      // node is stopped to seek, and a seek must not read as the end.
      source.onended = null;
      source.stop();
    }
    sourceRef.current = null;
    playbackWindowRef.current = null;
    isPlayingRef.current = false;
    setIsPlaying(false);
  }, []);

  const getPlaybackPosition = useCallback((): number => {
    const window = playbackWindowRef.current;
    const context = playbackContextRef.current;
    if (!window || !context) {
      return pausedPositionRef.current;
    }
    return playbackPositionAt(window, context.currentTime);
  }, []);

  /**
   * The audio a press of play would sound, and its shape on screen.
   *
   * Mastered when that is what is being listened to and it has finished
   * rendering, raw otherwise. Falling back rather than refusing means a preview
   * that failed, or has not arrived yet, costs a comparison rather than the
   * ability to listen at all.
   */
  const activeAudio = useCallback((): PlayableAudio | null => {
    const held = takeRef.current;
    if (!held) {
      return null;
    }
    if (previewModeRef.current === 'mastered' && held.mastered) {
      return held.mastered;
    }
    return {
      samples: held.samples,
      sampleRateHertz: held.sampleRateHertz,
      durationSeconds: held.samples.length / held.sampleRateHertz,
      audioBuffer: null,
    };
  }, []);

  const startPlaybackAt = useCallback(
    (seconds: number): void => {
      const audio = activeAudio();
      if (!audio) {
        return;
      }
      stopPlayback();

      // One context for the component's lifetime. Building one per press would
      // mean a context per frame while scrubbing.
      playbackContextRef.current ??= new AudioContext();
      const context = playbackContextRef.current;
      void context.resume();

      // A mastered take arrives already decoded, because it came back from the
      // server as an encoded file rather than as samples.
      let buffer = audio.audioBuffer;
      if (!buffer) {
        buffer = context.createBuffer(1, audio.samples.length, audio.sampleRateHertz);
        buffer.copyToChannel(audio.samples, 0);
      }

      const source = context.createBufferSource();
      source.buffer = buffer;
      source.connect(context.destination);
      source.onended = () => {
        playbackWindowRef.current = null;
        pausedPositionRef.current = audio.durationSeconds;
        isPlayingRef.current = false;
        setIsPlaying(false);
      };
      source.start(0, seconds);

      sourceRef.current = source;
      playbackWindowRef.current = {
        startedFromSeconds: seconds,
        startedAtContextTime: context.currentTime,
        durationSeconds: audio.durationSeconds,
      };
      pausedPositionRef.current = seconds;
      isPlayingRef.current = true;
      setIsPlaying(true);
    },
    [activeAudio, stopPlayback],
  );

  const play = useCallback((): void => {
    const audio = activeAudio();
    if (!audio) {
      return;
    }
    if (isPlayingRef.current) {
      pausedPositionRef.current = getPlaybackPosition();
      stopPlayback();
      return;
    }
    startPlaybackAt(resumeFrom(pausedPositionRef.current, audio.durationSeconds));
  }, [activeAudio, getPlaybackPosition, startPlaybackAt, stopPlayback]);

  const seek = useCallback(
    (seconds: number): void => {
      const audio = activeAudio();
      if (!audio) {
        return;
      }
      const target = Math.min(audio.durationSeconds, Math.max(0, seconds));

      if (isPlayingRef.current) {
        startPlaybackAt(target);
        return;
      }
      pausedPositionRef.current = target;
    },
    [activeAudio, startPlaybackAt],
  );

  const start = useCallback((): void => {
    const capture = captureRef.current;
    if (!capture?.openGraph) {
      return;
    }
    stopPlayback();
    pausedPositionRef.current = 0;

    liveTraceRef.current.clear();
    elapsedMillisecondsRef.current = 0;
    startedAtRef.current = performance.now();
    setTake(null);
    setStatus('recording');
    void capture.startRecording();
  }, [stopPlayback]);

  /**
   * Sends a take to be mastered and holds the result against it.
   *
   * Failure is reported rather than thrown. Nothing here is required to keep
   * recording — a preview that could not be produced costs the comparison, not
   * the sitting — so the take stays exactly as usable as it was before.
   */
  const renderPreview = useCallback(async (recorded: HeldTake): Promise<void> => {
    try {
      const response = await fetch('/api/preview', {
        method: 'POST',
        headers: {'content-type': 'application/octet-stream'},
        body: new Blob([recorded.wavBytes as BlobPart]),
      });
      if (!response.ok) {
        const body = (await response.json().catch(() => ({}))) as {error?: string};
        throw new Error(body.error ?? `The studio answered ${response.status}.`);
      }

      const encoded = await response.arrayBuffer();
      playbackContextRef.current ??= new AudioContext();
      const audioBuffer = await playbackContextRef.current.decodeAudioData(encoded);

      // Redone or moved on from while this was rendering. Attaching it now would
      // put one take's audio against another's card.
      if (takeRef.current !== recorded) {
        return;
      }

      setTake((previous) =>
        previous === recorded
          ? {
              ...previous,
              masteringStatus: 'ready',
              mastered: {
                // Channel zero: the chain encodes mono, so there is only one.
                samples: audioBuffer.getChannelData(0) as Float32Array<ArrayBuffer>,
                sampleRateHertz: audioBuffer.sampleRate,
                durationSeconds: audioBuffer.duration,
                audioBuffer,
              },
            }
          : previous,
      );
    } catch (cause) {
      if (takeRef.current !== recorded) {
        return;
      }
      // The cause is kept and shown. Discarding it here cost two rounds of
      // guessing at a failure the browser had already named.
      setTake((previous) =>
        previous === recorded
          ? {
              ...previous,
              masteringStatus: 'failed',
              masteringFailure: cause instanceof Error ? cause.message : String(cause),
            }
          : previous,
      );
    }
  }, []);

  const stop = useCallback(async (options?: StopOptions): Promise<HeldTake | null> => {
    const captured = await captureRef.current?.stopRecording();
    if (!captured) {
      // Stopping before the microphone finished starting, which two fast presses
      // of Space can do. Nothing was captured, so go back to ready rather than
      // leaving the screen believing it is still recording.
      setStatus(captureRef.current?.openGraph ? 'ready' : 'connecting');
      return null;
    }

    // The fault check measures what the microphone delivered, before the guard
    // is removed. Measuring the trimmed take would report the guard as a fault.
    const recordedMilliseconds =
      (captured.samples.length / captured.sampleRateHertz) * 1000;
    const captureFault = findCaptureFault(recordedMilliseconds, captured.elapsedMilliseconds);

    // Both keypresses are inside the raw take and both come off. At the head,
    // the lead-in is audio from before the take was asked for — sound reaches
    // the page later than it reaches the microphone — and the guard on top of it
    // covers the click of the key that started the take. At the end, the take
    // runs on past the stopping key by one latency so the last word survives,
    // and the tail guard absorbs the overshoot when that latency was a guess.
    const samples = trimTail(
      trimLeadIn(
        captured.samples,
        captured.sampleRateHertz,
        captured.leadInMilliseconds + KEYPRESS_GUARD_MILLISECONDS,
      ),
      captured.sampleRateHertz,
      KEYPRESS_TAIL_GUARD_MILLISECONDS,
    );
    const audio = {samples, sampleRateHertz: captured.sampleRateHertz, channelCount: 1};

    const wavBytes = encodeWav(audio);
    const recorded: HeldTake = {
      samples,
      wavBytes,
      analysis: analyseTake(audio),
      sampleRateHertz: captured.sampleRateHertz,
      captureFault,
      mastered: null,
      masteringStatus: options?.preview === false ? 'none' : 'pending',
      masteringFailure: null,
    };

    elapsedMillisecondsRef.current = captured.elapsedMilliseconds;
    pausedPositionRef.current = 0;
    setTake(recorded);
    setStatus('recorded');

    if (options?.preview !== false) {
      // Not awaited. The whole point is that it is already there by the time
      // anyone reaches for the play key, so nothing should wait on it.
      void renderPreview(recorded);
    }
    return recorded;
  }, [renderPreview]);

  const discard = useCallback((): void => {
    stopPlayback();
    pausedPositionRef.current = 0;
    liveTraceRef.current.clear();
    elapsedMillisecondsRef.current = 0;
    setTake(null);
    setStatus(captureRef.current?.openGraph ? 'ready' : 'connecting');
  }, [stopPlayback]);

  /**
   * Switches between hearing the processed take and hearing the raw capture.
   *
   * The comparison is the diagnosis. A consonant missing from both was said
   * that way and the take needs recording again; one missing only from the
   * processed version was taken by the denoiser or the trim, and the answer is a
   * constant in `lib/audio-constants.ts` rather than another take.
   */
  const setPreviewMode = useCallback(
    (mode: PreviewMode): void => {
      previewModeRef.current = mode;
      setPreviewModeState(mode);
      // The two differ in length, so a position carried across would land
      // somewhere else in the take.
      stopPlayback();
      pausedPositionRef.current = 0;
    },
    [stopPlayback],
  );

  const selectMicrophone = useCallback((deviceId: string): void => {
    window.localStorage.setItem(DEVICE_STORAGE_KEY, deviceId);
    // Reset here rather than in the effect that reopens. Switching input is a
    // user action, and the screen should say "connecting" from the moment it is
    // asked to, not one render later.
    setStatus('connecting');
    setError(null);
    setSelectedDeviceId(deviceId);
  }, []);

  useEffect(
    () => () => {
      void playbackContextRef.current?.close();
      playbackContextRef.current = null;
    },
    [],
  );

  return {
    status,
    peakDecibels,
    meanDecibels,
    take,
    error,
    diagnostics,
    microphones,
    selectedDeviceId,
    selectMicrophone,
    liveTraceRef,
    elapsedMillisecondsRef,
    start,
    stop,
    discard,
    isPlaying,
    getPlaybackPosition,
    takeDurationSeconds,
    play,
    seek,
    previewMode,
    setPreviewMode,
    displayedSamples: displayed?.samples ?? null,
  };
}
