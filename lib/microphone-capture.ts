/**
 * @fileoverview The microphone, owned outside React.
 *
 * A capture graph outlives any single render and must exist exactly once. React
 * effects are the wrong owner for that: an effect whose dependency is not
 * referentially stable re-runs freely, and an `async` guard that checks a flag
 * before its first `await` lets a second caller straight through. Both happened
 * here, and the result was two live graphs pushing into one buffer — takes came
 * out at twice their true length, interleaved into noise.
 *
 * So the lifecycle lives here, in a plain object with three rules:
 *
 *   * `open()` memoises the **in-flight promise**, not just the finished graph,
 *     so concurrent callers share one microphone.
 *   * `dispose()` works even while `open()` is still running — a graph that
 *     arrives after disposal tears itself down instead of leaking.
 *   * The browser audio APIs are injected, so all of the above is testable in
 *     Node against fakes rather than by recording and listening.
 */

import {CAPTURE_SAMPLE_RATE_HERTZ} from './audio-constants';

/**
 * One reading of the input level.
 *
 * Two numbers because they answer different questions. `peak` is the loudest
 * single sample and says whether anything clipped. `mean` is the root mean
 * square and says how loud the sound actually is — steady where the peak of the
 * same sound is not, which is what makes a meter readable.
 */
export interface LevelReading {
  peak: number;
  mean: number;
}

/** What the worklet sends up from the audio thread. */
export type WorkletMessage =
  | ({type: 'level'} & LevelReading)
  | {type: 'block'; samples: Float32Array}
  | {type: 'stopped'};

/**
 * How long sound takes to reach the page after it reaches the microphone.
 *
 * The number matters at both ends of a take, and it is the same number at both:
 * the samples handed over at any moment are of sound from one latency ago, so a
 * take anchored to when the page notices begins one latency early and ends one
 * latency early. That is audible as a word clipped off the end.
 */
export interface InputLatency {
  seconds: number;
  /**
   * Whether the browser measured this or the studio assumed it.
   *
   * Shown on screen, because a compensation built on a guess should say that it
   * is one rather than presenting itself as a measurement.
   */
  isReported: boolean;
}

/** A live graph, as the capture drives it. */
export interface OpenGraph {
  /** The rate the context actually runs at, which may not be the one requested. */
  sampleRate: number;
  /** Channels the microphone delivered, before the downmix to mono. */
  channelCount: number;
  /**
   * The microphone actually being recorded, read back from the live track.
   *
   * Read back rather than remembered, because what was asked for and what the
   * browser gave are only ever different when it matters — and recording a
   * session on the laptop's built-in microphone while believing it is the Yeti
   * is not discoverable until playback.
   */
  deviceId: string;
  deviceLabel: string;
  inputLatency: InputLatency;
  /** Tells the worklet to start sending sample blocks. */
  startRecording(): void;
  /**
   * Asks the worklet to send `flushFrames` more blocks and then acknowledge.
   *
   * The acknowledgement is what makes the stop safe. Taking the buffer straight
   * away discards every block already posted but not yet delivered, which is
   * audio recorded before the speaker asked to stop.
   */
  stopRecording(flushFrames: number): void;
  /** Starts the context if autoplay policy left it suspended. */
  resume(): Promise<void>;
  close(): Promise<void>;
}

/**
 * The browser audio APIs, narrowed to what a capture needs.
 *
 * Everything that touches a Web Audio global lives behind this, which is what
 * lets the lifecycle above be tested without a browser.
 */
export interface CaptureBackend {
  open(
    sampleRateHertz: number,
    onMessage: (message: WorkletMessage) => void,
    deviceId?: string,
  ): Promise<OpenGraph>;
}

/** A finished recording, straight off the microphone. */
export interface CapturedTake {
  samples: Float32Array<ArrayBuffer>;
  /** The rate the graph actually ran at, not the one that was asked for. */
  sampleRateHertz: number;
  /**
   * Wall-clock milliseconds the samples are expected to cover.
   *
   * The span between start and stop, plus the flush that follows the stop.
   * Kept beside the samples so the two can be compared. They must agree; see
   * `findCaptureFault`.
   */
  elapsedMilliseconds: number;
  /**
   * Audio at the head that was recorded before the take was asked for.
   *
   * One input latency's worth, which is what has to come off for the take to
   * begin where the speaker meant it to.
   */
  leadInMilliseconds: number;
}

const WORKLET_URL = '/capture-worklet.js';
const PROCESSOR_NAME = 'capture-processor';

/** Frames in one render quantum, fixed by the Web Audio specification. */
const RENDER_QUANTUM_FRAMES = 128;

/**
 * Input latency used when the browser will not report it, in seconds.
 *
 * Chrome reports a figure for most inputs and Safari reports none. Thirty
 * milliseconds is a middling value for a USB microphone, chosen so an
 * unreporting browser is compensated approximately rather than not at all —
 * being roughly right at both ends of a take beats being exactly wrong.
 *
 * The screen says when this is what is in use, so a guess is never mistaken for
 * a measurement.
 */
const ASSUMED_INPUT_LATENCY_SECONDS = 0.03;

/**
 * How long to wait for the worklet's acknowledgement before giving up on it.
 *
 * A backstop for a graph that has died, and deliberately far longer than any
 * healthy stop needs. It was a quarter of a second, which turned out to be a
 * deadline rather than a backstop: a port running behind still holds the end of
 * the take, and cutting it off there discarded exactly the audio the
 * acknowledgement exists to wait for.
 *
 * Nobody waits this long in practice. The acknowledgement is posted behind the
 * last block, so it arrives as soon as the queue drains.
 */
const STOP_ACKNOWLEDGEMENT_TIMEOUT_MILLISECONDS = 2_000;

/**
 * Works out how far behind the microphone the page is running.
 *
 * @param reportedSeconds What the media track says, where the browser says
 *     anything. Undefined in browsers that do not implement it.
 * @param sampleRate Needed for the worklet's own render quantum, which is part
 *     of the delay whatever the device does.
 */
export function measureInputLatency(
  reportedSeconds: number | undefined,
  sampleRate: number,
): InputLatency {
  const isReported = typeof reportedSeconds === 'number' && reportedSeconds > 0;
  const deviceSeconds = isReported ? reportedSeconds : ASSUMED_INPUT_LATENCY_SECONDS;
  return {
    seconds: deviceSeconds + RENDER_QUANTUM_FRAMES / sampleRate,
    isReported,
  };
}

/**
 * How many capture graphs are live in this tab.
 *
 * Module-level because the number that matters is the total, not the count per
 * instance — two instances each holding one graph is the same failure as one
 * instance holding two. The recording screen displays it, so the fault this
 * module exists to prevent is visible rather than inferred from bad audio.
 */
let liveGraphs = 0;

/** How many capture graphs are currently open. Exactly one during a session. */
export function liveGraphCount(): number {
  return liveGraphs;
}

/**
 * Removes the first stretch of a take.
 *
 * A take begins when the spacebar is released, and the sound of that release is
 * the first thing the microphone hears. This drops it.
 *
 * @param milliseconds How much to remove from the head.
 * @returns Empty when the take is shorter than the guard, rather than negative.
 * @example
 * trimLeadIn(samples, 48_000, 80); // drops the first 3,840 samples
 */
export function trimLeadIn(
  samples: Float32Array<ArrayBuffer>,
  sampleRateHertz: number,
  milliseconds: number,
): Float32Array<ArrayBuffer> {
  const guard = Math.round((sampleRateHertz * milliseconds) / 1000);
  if (guard <= 0) {
    return samples;
  }
  if (guard >= samples.length) {
    return new Float32Array(0);
  }
  return samples.slice(guard);
}

/**
 * Removes the last stretch of a take.
 *
 * A take runs on past the stopping keypress by one input latency, so that the
 * last word is not cut off. Where that latency is a guess rather than a
 * measurement the run-on can overshoot, and what it catches is the key going
 * down. This drops it.
 *
 * @param milliseconds How much to remove from the end.
 * @returns Empty when the take is shorter than the guard, rather than negative.
 * @example
 * trimTail(samples, 48_000, 60); // drops the last 2,880 samples
 */
export function trimTail(
  samples: Float32Array<ArrayBuffer>,
  sampleRateHertz: number,
  milliseconds: number,
): Float32Array<ArrayBuffer> {
  const guard = Math.round((sampleRateHertz * milliseconds) / 1000);
  if (guard <= 0) {
    return samples;
  }
  if (guard >= samples.length) {
    return new Float32Array(0);
  }
  return samples.slice(0, samples.length - guard);
}

/** Joins captured blocks into one buffer, in the order they arrived. */
export function concatenateBlocks(blocks: readonly Float32Array[]): Float32Array<ArrayBuffer> {
  const total = blocks.reduce((count, block) => count + block.length, 0);
  const samples = new Float32Array(total);
  let offset = 0;
  for (const block of blocks) {
    samples.set(block, offset);
    offset += block.length;
  }
  return samples;
}

/**
 * Records single takes from one microphone.
 *
 * @example
 * const capture = new MicrophoneCapture();
 * await capture.open();
 * capture.onLevel(level => meter.set(level.peak, level.mean));
 * await capture.startRecording();
 * const take = capture.stopRecording();
 */
export class MicrophoneCapture {
  private readonly backend: CaptureBackend;
  private readonly now: () => number;

  private opening: Promise<void> | null = null;
  private graph: OpenGraph | null = null;
  private disposed = false;

  private recording = false;
  private recordingStartedAt = 0;
  private blocks: Float32Array[] = [];

  /** Resolves when the worklet acknowledges that the last block has been sent. */
  private stopAcknowledged: (() => void) | null = null;

  private readonly levelListeners = new Set<(level: LevelReading) => void>();
  private readonly blockListeners = new Set<(block: Float32Array) => void>();

  private readonly deviceId?: string;

  constructor(
    options: {backend?: CaptureBackend; now?: () => number; deviceId?: string} = {},
  ) {
    this.backend = options.backend ?? new WebAudioCaptureBackend();
    this.now = options.now ?? (() => performance.now());
    this.deviceId = options.deviceId;
  }

  /**
   * Opens the microphone, once.
   *
   * Safe to call any number of times and from any number of places at once —
   * every caller receives the same promise and the same graph.
   *
   * @throws If permission is refused or the worklet cannot load. The failure is
   *     not cached, so a later call retries.
   */
  open(): Promise<void> {
    if (this.disposed) {
      return Promise.reject(new Error('This microphone capture has been disposed.'));
    }
    this.opening ??= this.build().catch((cause: unknown) => {
      this.opening = null;
      throw cause;
    });
    return this.opening;
  }

  /** The live graph, or null before `open()` resolves. */
  get openGraph(): OpenGraph | null {
    return this.graph;
  }

  /** Whether a take is being recorded right now. */
  get isRecording(): boolean {
    return this.recording;
  }

  /** Subscribes to the input level. Returns an unsubscribe function. */
  onLevel(listener: (level: LevelReading) => void): () => void {
    this.levelListeners.add(listener);
    return () => this.levelListeners.delete(listener);
  }

  /** Subscribes to sample blocks while recording. Returns an unsubscribe function. */
  onBlock(listener: (block: Float32Array) => void): () => void {
    this.blockListeners.add(listener);
    return () => this.blockListeners.delete(listener);
  }

  /**
   * Begins a take.
   *
   * Resumes the context first. Autoplay policy can leave a context suspended,
   * and a suspended context records silence rather than failing.
   */
  async startRecording(): Promise<void> {
    const graph = this.graph;
    if (!graph || this.recording) {
      return;
    }
    await graph.resume();

    this.blocks = [];
    this.recording = true;
    this.recordingStartedAt = this.now();
    graph.startRecording();
  }

  /**
   * Ends the take and returns it.
   *
   * Recording continues for one input latency past this call, and the samples
   * are not read until the worklet says it has sent them all. Both are needed
   * and for the same reason: sound reaches this thread later than it reaches the
   * microphone, so at the moment a speaker asks to stop, the last word they said
   * is still in flight. Cutting here would leave it out of the file, and nothing
   * downstream can put it back.
   *
   * @returns Null when nothing was being recorded.
   */
  async stopRecording(): Promise<CapturedTake | null> {
    const graph = this.graph;
    if (!this.recording || !graph) {
      this.recording = false;
      return null;
    }

    const flushMilliseconds = graph.inputLatency.seconds * 1000;
    const elapsedMilliseconds =
      this.now() - this.recordingStartedAt + flushMilliseconds;

    graph.stopRecording(Math.round(graph.inputLatency.seconds * graph.sampleRate));
    await this.waitForStop();

    this.recording = false;
    const samples = concatenateBlocks(this.blocks);
    this.blocks = [];

    return {
      samples,
      sampleRateHertz: graph.sampleRate,
      elapsedMilliseconds,
      leadInMilliseconds: flushMilliseconds,
    };
  }

  /**
   * Waits for the worklet to confirm that every block has been sent.
   *
   * Port messages arrive in the order they were posted, so the acknowledgement
   * cannot overtake the audio ahead of it: once it lands, the blocks are all
   * here. The timeout covers a graph that has died, where waiting on an
   * acknowledgement that will never come would lose the take as well.
   */
  private waitForStop(): Promise<void> {
    return new Promise<void>((resolve) => {
      let settled = false;
      const finish = (): void => {
        if (settled) {
          return;
        }
        settled = true;
        this.stopAcknowledged = null;
        clearTimeout(timer);
        resolve();
      };

      const timer = setTimeout(finish, STOP_ACKNOWLEDGEMENT_TIMEOUT_MILLISECONDS);
      this.stopAcknowledged = finish;
    });
  }

  /**
   * Closes the microphone for good.
   *
   * Safe to call while `open()` is still in flight: the graph that arrives
   * afterwards is closed on arrival rather than left running with nothing
   * holding a reference to it.
   */
  async dispose(): Promise<void> {
    this.disposed = true;
    this.recording = false;
    this.blocks = [];
    // A stop waiting on a graph that is being torn down will never be
    // acknowledged. Releasing it now spares the caller the timeout.
    this.stopAcknowledged?.();
    this.levelListeners.clear();
    this.blockListeners.clear();

    const graph = this.graph;
    this.graph = null;
    if (graph) {
      await closeGraph(graph);
    }
  }

  /** Builds the graph and adopts it, unless disposal happened while it was building. */
  private async build(): Promise<void> {
    const graph = await this.backend.open(
      CAPTURE_SAMPLE_RATE_HERTZ,
      (message) => this.receive(message),
      this.deviceId,
    );
    liveGraphs += 1;

    // Disposal can land at any await above. Adopting the graph now would leave
    // it running with no owner — which is exactly the leak this class exists to
    // prevent, just from the other direction.
    if (this.disposed) {
      await closeGraph(graph);
      return;
    }
    this.graph = graph;
  }

  private receive(message: WorkletMessage): void {
    if (message.type === 'level') {
      for (const listener of this.levelListeners) {
        listener({peak: message.peak, mean: message.mean});
      }
      return;
    }

    if (message.type === 'stopped') {
      this.stopAcknowledged?.();
      return;
    }

    if (!this.recording) {
      return;
    }
    this.blocks.push(message.samples);
    for (const listener of this.blockListeners) {
      listener(message.samples);
    }
  }
}

async function closeGraph(graph: OpenGraph): Promise<void> {
  liveGraphs = Math.max(0, liveGraphs - 1);
  await graph.close();
}

/**
 * What an audio track reports about itself, including one field the DOM omits.
 *
 * `latency` is part of the Media Capture specification for audio tracks and
 * Chrome implements it, but TypeScript's DOM library does not declare it.
 * Narrowing it here confines the widening to one property in one place, rather
 * than casting the settings object wholesale at the point of use.
 */
interface AudioTrackSettings extends MediaTrackSettings {
  /** Device latency in seconds. Absent in browsers that do not report one. */
  latency?: number;
}

/**
 * The real Web Audio implementation.
 *
 * Every browser global is touched inside `open()` rather than at module scope,
 * so this file can be imported in Node without a DOM.
 */
export class WebAudioCaptureBackend implements CaptureBackend {
  async open(
    sampleRateHertz: number,
    onMessage: (message: WorkletMessage) => void,
    deviceId?: string,
  ): Promise<OpenGraph> {
    const stream = await navigator.mediaDevices.getUserMedia({
      audio: {
        // `exact`, never `ideal`. An ideal constraint falls back silently to the
        // default input when the chosen microphone is unplugged, which is how a
        // session ends up recorded on a laptop's built-in microphone without
        // anyone noticing. This throws instead, and the screen says so.
        ...(deviceId ? {deviceId: {exact: deviceId}} : {}),
        channelCount: 1,
        sampleRate: sampleRateHertz,
        // The browser's own cleanup is switched off deliberately. Automatic gain
        // would ride the level between takes, noise suppression eats the breath
        // off an aspirated consonant, and echo cancellation is built for a
        // conversation rather than a microphone in a quiet room. The mastering
        // pass does this work later, once, against a known floor.
        echoCancellation: false,
        noiseSuppression: false,
        autoGainControl: false,
      },
    });

    const context = new AudioContext({sampleRate: sampleRateHertz});

    try {
      await context.audioWorklet.addModule(WORKLET_URL);

      const source = context.createMediaStreamSource(stream);
      const worklet = new AudioWorkletNode(context, PROCESSOR_NAME);
      worklet.port.onmessage = (event: MessageEvent<WorkletMessage>) => onMessage(event.data);

      // A worklet is only pulled when its output reaches the destination. The
      // silent gain keeps the graph running without playing the microphone back
      // into the room, which would feed back through the speakers.
      const silence = context.createGain();
      silence.gain.value = 0;
      source.connect(worklet).connect(silence).connect(context.destination);

      const track = stream.getAudioTracks()[0];
      const settings: AudioTrackSettings | undefined = track?.getSettings();

      return {
        sampleRate: context.sampleRate,
        channelCount: settings?.channelCount ?? 1,
        deviceId: settings?.deviceId ?? '',
        deviceLabel: track?.label || 'Unnamed microphone',
        // `latency` is optional in the specification and absent in some
        // browsers, which is why the measurement says whether it is a
        // measurement.
        inputLatency: measureInputLatency(settings?.latency, context.sampleRate),
        startRecording: () => worklet.port.postMessage({type: 'start'}),
        stopRecording: (flushFrames) =>
          worklet.port.postMessage({type: 'stop', flushFrames}),
        resume: async () => {
          if (context.state === 'suspended') {
            await context.resume();
          }
        },
        close: async () => {
          worklet.port.onmessage = null;
          source.disconnect();
          worklet.disconnect();
          silence.disconnect();
          for (const track of stream.getTracks()) {
            track.stop();
          }
          await context.close();
        },
      };
    } catch (cause) {
      for (const track of stream.getTracks()) {
        track.stop();
      }
      await context.close();
      throw cause;
    }
  }
}
