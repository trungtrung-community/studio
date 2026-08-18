import {afterEach, describe, expect, it} from 'vitest';

import {
  MicrophoneCapture,
  concatenateBlocks,
  liveGraphCount,
  measureInputLatency,
  trimLeadIn,
  trimTail,
  type CaptureBackend,
  type OpenGraph,
  type WorkletMessage,
} from '@/lib/microphone-capture';

/**
 * A capture graph that never touches Web Audio.
 *
 * `deliver` is how a test plays the part of the audio thread, so the lifecycle
 * can be driven precisely rather than waited on.
 */
class FakeBackend implements CaptureBackend {
  openCalls = 0;
  closedGraphs = 0;
  recordingStates: boolean[] = [];
  resumeCalls = 0;
  /** Frames the capture asked to go on recording after each stop. */
  flushRequests: number[] = [];
  private send: ((message: WorkletMessage) => void) | null = null;

  /** Resolves the pending open, so a test can dispose while one is in flight. */
  private release: (() => void) | null = null;

  constructor(
    private readonly options: {
      sampleRate?: number;
      channelCount?: number;
      hold?: boolean;
      latencySeconds?: number;
      /** Leaves the stop unacknowledged, standing in for a graph that has died. */
      neverAcknowledge?: boolean;
    } = {},
  ) {}

  async open(
    _sampleRateHertz: number,
    onMessage: (message: WorkletMessage) => void,
  ): Promise<OpenGraph> {
    this.openCalls += 1;
    this.send = onMessage;

    if (this.options.hold) {
      await new Promise<void>((resolve) => {
        this.release = resolve;
      });
    }

    return {
      sampleRate: this.options.sampleRate ?? 48_000,
      channelCount: this.options.channelCount ?? 1,
      deviceId: 'fake-device',
      deviceLabel: 'Fake microphone',
      inputLatency: {seconds: this.options.latencySeconds ?? 0.02, isReported: true},
      startRecording: () => this.recordingStates.push(true),
      stopRecording: (flushFrames) => {
        this.recordingStates.push(false);
        this.flushRequests.push(flushFrames);
      },
      resume: async () => {
        this.resumeCalls += 1;
      },
      close: async () => {
        this.closedGraphs += 1;
      },
    };
  }

  finishOpening(): void {
    this.release?.();
    this.release = null;
  }

  /** Plays the audio thread: hands a block of `frames` samples to the capture. */
  deliverBlock(frames: number, amplitude = 0.5): void {
    this.send?.({type: 'block', samples: new Float32Array(frames).fill(amplitude)});
  }

  deliverLevel(peak: number, mean = peak / 2): void {
    this.send?.({type: 'level', peak, mean});
  }

  /** The worklet's acknowledgement that every block has now been sent. */
  acknowledgeStop(): void {
    if (!this.options.neverAcknowledge) {
      this.send?.({type: 'stopped'});
    }
  }
}

/**
 * Stops a take, playing the audio thread's part of the handshake.
 *
 * `deliverDuringFlush` is the audio that was still in flight when the speaker
 * asked to stop — the audio the old synchronous stop threw away.
 */
async function stopWithFlush(
  capture: MicrophoneCapture,
  backend: FakeBackend,
  deliverDuringFlush: () => void = () => {},
): Promise<Awaited<ReturnType<MicrophoneCapture['stopRecording']>>> {
  const stopping = capture.stopRecording();
  deliverDuringFlush();
  backend.acknowledgeStop();
  return stopping;
}

const openCaptures: MicrophoneCapture[] = [];

function makeCapture(backend: CaptureBackend, now?: () => number): MicrophoneCapture {
  const capture = new MicrophoneCapture({backend, now});
  openCaptures.push(capture);
  return capture;
}

afterEach(async () => {
  await Promise.all(openCaptures.splice(0).map((capture) => capture.dispose()));
  expect(liveGraphCount(), 'a test leaked a capture graph').toBe(0);
});

describe('opening the microphone', () => {
  it('builds one graph however many callers ask at once', async () => {
    // The regression. The screen called open from an effect whose dependency was
    // a new object every render, so it ran twice while the first was still
    // awaiting permission, and both graphs then pushed into one buffer.
    const backend = new FakeBackend();
    const capture = makeCapture(backend);

    await Promise.all([capture.open(), capture.open(), capture.open()]);

    expect(backend.openCalls).toBe(1);
    expect(liveGraphCount()).toBe(1);
  });

  it('builds one graph when asked again after it is already open', async () => {
    const backend = new FakeBackend();
    const capture = makeCapture(backend);

    await capture.open();
    await capture.open();

    expect(backend.openCalls).toBe(1);
    expect(liveGraphCount()).toBe(1);
  });

  it('reports the rate the context actually runs at, not the one requested', async () => {
    const capture = makeCapture(new FakeBackend({sampleRate: 44_100, channelCount: 2}));
    await capture.open();

    expect(capture.openGraph?.sampleRate).toBe(44_100);
    expect(capture.openGraph?.channelCount).toBe(2);
  });

  it('lets a refused microphone be retried', async () => {
    let attempts = 0;
    const backend: CaptureBackend = {
      async open(sampleRateHertz, onMessage) {
        attempts += 1;
        if (attempts === 1) {
          throw new Error('Permission denied');
        }
        return new FakeBackend().open(sampleRateHertz, onMessage);
      },
    };
    const capture = makeCapture(backend);

    await expect(capture.open()).rejects.toThrow('Permission denied');
    await expect(capture.open()).resolves.toBeUndefined();
    expect(attempts).toBe(2);
  });
});

describe('disposing', () => {
  it('closes a graph that arrives after disposal', async () => {
    // The other half of the leak: tearing down before the microphone opens must
    // not leave a graph running with nothing holding a reference to it.
    const backend = new FakeBackend({hold: true});
    const capture = new MicrophoneCapture({backend});

    const opening = capture.open();
    await capture.dispose();
    backend.finishOpening();
    await opening;

    expect(backend.closedGraphs).toBe(1);
    expect(capture.openGraph).toBeNull();
    expect(liveGraphCount()).toBe(0);
  });

  it('closes the graph and stops counting it', async () => {
    const backend = new FakeBackend();
    const capture = new MicrophoneCapture({backend});

    await capture.open();
    expect(liveGraphCount()).toBe(1);

    await capture.dispose();

    expect(backend.closedGraphs).toBe(1);
    expect(liveGraphCount()).toBe(0);
  });

  it('refuses to reopen once disposed', async () => {
    const capture = new MicrophoneCapture({backend: new FakeBackend()});
    await capture.dispose();

    await expect(capture.open()).rejects.toThrow(/disposed/);
  });
});

describe('recording a take', () => {
  it('returns exactly the samples that arrived, in order', async () => {
    const backend = new FakeBackend();
    const capture = makeCapture(backend);
    await capture.open();

    await capture.startRecording();
    backend.deliverBlock(128, 0.25);
    backend.deliverBlock(128, 0.75);
    const take = await stopWithFlush(capture, backend);

    expect(take?.samples).toHaveLength(256);
    expect(take?.samples[0]).toBeCloseTo(0.25, 5);
    expect(take?.samples[200]).toBeCloseTo(0.75, 5);
  });

  it('reports the true length of what it captured', async () => {
    // 100 blocks of 128 frames at 48 kHz is 266.7 ms. The bug reported 533 —
    // two graphs pushing into one buffer, so every take came out doubled.
    const backend = new FakeBackend();
    const capture = makeCapture(backend);
    await capture.open();

    await capture.startRecording();
    for (let block = 0; block < 100; block += 1) {
      backend.deliverBlock(128);
    }
    const take = await stopWithFlush(capture, backend);

    expect(take?.samples).toHaveLength(12_800);
    expect((take!.samples.length / take!.sampleRateHertz) * 1000).toBeCloseTo(266.7, 1);
  });

  it('keeps nothing that arrives before recording starts', async () => {
    const backend = new FakeBackend();
    const capture = makeCapture(backend);
    await capture.open();

    backend.deliverBlock(128);
    await capture.startRecording();
    backend.deliverBlock(128);
    const take = await stopWithFlush(capture, backend);

    expect(take?.samples).toHaveLength(128);
  });

  it('keeps nothing that arrives after the worklet has acknowledged the stop', async () => {
    const backend = new FakeBackend();
    const capture = makeCapture(backend);
    await capture.open();

    await capture.startRecording();
    backend.deliverBlock(128);
    const take = await stopWithFlush(capture, backend);
    backend.deliverBlock(128);

    expect(take?.samples).toHaveLength(128);
  });

  it('never lets one capture write into another', async () => {
    // Two instances is the same failure as one instance opening twice, which is
    // what a double-mounted component would produce.
    const firstBackend = new FakeBackend();
    const secondBackend = new FakeBackend();
    const first = makeCapture(firstBackend);
    const second = makeCapture(secondBackend);
    await Promise.all([first.open(), second.open()]);

    await first.startRecording();
    firstBackend.deliverBlock(128);
    secondBackend.deliverBlock(128);

    const take = await stopWithFlush(first, firstBackend);
    expect(take?.samples).toHaveLength(128);
    expect(liveGraphCount()).toBe(2);
  });

  it('measures the wall clock across the take, and the flush that follows it', async () => {
    let clock = 1_000;
    const backend = new FakeBackend({latencySeconds: 0.02});
    const capture = makeCapture(backend, () => clock);
    await capture.open();

    await capture.startRecording();
    clock = 3_000;
    const take = await stopWithFlush(capture, backend);

    // Two seconds of pressing, plus the twenty milliseconds the capture goes on
    // running afterwards. Anything else would read as a capture fault.
    expect(take?.elapsedMilliseconds).toBe(2_020);
  });

  it('tells the worklet when to send blocks and when to stop', async () => {
    const backend = new FakeBackend();
    const capture = makeCapture(backend);
    await capture.open();

    await capture.startRecording();
    await stopWithFlush(capture, backend);

    expect(backend.recordingStates).toEqual([true, false]);
  });

  it('resumes a suspended context before recording, so it cannot record silence', async () => {
    const backend = new FakeBackend();
    const capture = makeCapture(backend);
    await capture.open();

    await capture.startRecording();

    expect(backend.resumeCalls).toBe(1);
  });

  it('returns nothing when it was not recording', async () => {
    const capture = makeCapture(new FakeBackend());
    await capture.open();

    await expect(capture.stopRecording()).resolves.toBeNull();
  });

  it('drops the previous take when a new one starts', async () => {
    const backend = new FakeBackend();
    const capture = makeCapture(backend);
    await capture.open();

    await capture.startRecording();
    backend.deliverBlock(128);
    await stopWithFlush(capture, backend);

    await capture.startRecording();
    backend.deliverBlock(64);

    const take = await stopWithFlush(capture, backend);
    expect(take?.samples).toHaveLength(64);
  });
});

describe('the end of a take', () => {
  it('keeps audio that was still in flight when the stop was asked for', async () => {
    // The reported defect. Sound reaches the page later than it reaches the
    // microphone, so at the moment the speaker presses stop, the last word they
    // said is still crossing from the audio thread. The old stop read its buffer
    // on the spot and left that word out of the file, where nothing downstream
    // could put it back.
    const backend = new FakeBackend();
    const capture = makeCapture(backend);
    await capture.open();

    await capture.startRecording();
    backend.deliverBlock(128);

    const take = await stopWithFlush(capture, backend, () => {
      backend.deliverBlock(128);
      backend.deliverBlock(128);
    });

    expect(take?.samples).toHaveLength(384);
  });

  it('asks the worklet to go on recording for one input latency', async () => {
    // 20 ms at 48 kHz is 960 frames. Without this the take ends one latency
    // before the speaker meant it to, however promptly the buffer is read.
    const backend = new FakeBackend({latencySeconds: 0.02});
    const capture = makeCapture(backend);
    await capture.open();

    await capture.startRecording();
    await stopWithFlush(capture, backend);

    expect(backend.flushRequests).toEqual([960]);
  });

  it('reports the lead-in that has to come off the head', async () => {
    // The same latency at the other end: the take begins one latency before it
    // was asked for, because those samples are of sound from before the press.
    const backend = new FakeBackend({latencySeconds: 0.035});
    const capture = makeCapture(backend);
    await capture.open();

    await capture.startRecording();
    const take = await stopWithFlush(capture, backend);

    expect(take?.leadInMilliseconds).toBeCloseTo(35, 5);
  });

  it('gives up on an acknowledgement that never comes, keeping what arrived', async () => {
    // Only a graph that has already died can miss it, and waiting forever would
    // lose the take as well as the flush. The backstop is deliberately long —
    // see the constant — so this test has to outwait it.
    const backend = new FakeBackend({neverAcknowledge: true});
    const capture = makeCapture(backend);
    await capture.open();

    await capture.startRecording();
    backend.deliverBlock(128);
    const take = await capture.stopRecording();

    expect(take?.samples).toHaveLength(128);
  }, 5_000);
});

describe('measureInputLatency', () => {
  it('adds the render quantum to what the browser reports', () => {
    // 128 frames at 48 kHz is 2.67 ms, and the worklet's own buffering is part
    // of the delay whatever the device does.
    const latency = measureInputLatency(0.02, 48_000);

    expect(latency.seconds).toBeCloseTo(0.02267, 5);
    expect(latency.isReported).toBe(true);
  });

  it('says so when it had to assume', () => {
    // Safari reports nothing. Compensating approximately beats not at all, but
    // the screen has to be able to tell a guess from a reading.
    const latency = measureInputLatency(undefined, 48_000);

    expect(latency.isReported).toBe(false);
    expect(latency.seconds).toBeGreaterThan(0);
  });

  it('treats a reported zero as nothing reported', () => {
    // A device that claims no latency at all is not measuring, and taking it at
    // its word would compensate neither end.
    expect(measureInputLatency(0, 48_000).isReported).toBe(false);
  });

  it('scales the quantum with the rate the context actually runs at', () => {
    expect(measureInputLatency(0, 44_100).seconds).toBeGreaterThan(
      measureInputLatency(0, 48_000).seconds,
    );
  });
});

describe('subscriptions', () => {
  it('reports the level whether or not a take is being recorded', async () => {
    const backend = new FakeBackend();
    const capture = makeCapture(backend);
    await capture.open();

    const levels: number[] = [];
    capture.onLevel((level) => levels.push(level.peak));

    backend.deliverLevel(0.1);
    await capture.startRecording();
    backend.deliverLevel(0.9);

    expect(levels).toEqual([0.1, 0.9]);
  });

  it('carries the mean beside the peak', () => {
    // The meter is driven by the mean and marked by the peak. One number cannot
    // do both: the peak of a steady room swings by fifteen decibels, which reads
    // as a broken meter rather than as a quiet room.
    const backend = new FakeBackend();
    const capture = makeCapture(backend);

    return capture.open().then(() => {
      const readings: Array<{peak: number; mean: number}> = [];
      capture.onLevel((level) => readings.push(level));

      backend.deliverLevel(0.8, 0.1);

      expect(readings).toEqual([{peak: 0.8, mean: 0.1}]);
    });
  });

  it('stops delivering once unsubscribed', async () => {
    const backend = new FakeBackend();
    const capture = makeCapture(backend);
    await capture.open();

    const levels: number[] = [];
    const unsubscribe = capture.onLevel((level) => levels.push(level.peak));
    backend.deliverLevel(0.1);
    unsubscribe();
    backend.deliverLevel(0.9);

    expect(levels).toEqual([0.1]);
  });
});

describe('trimLeadIn', () => {
  const sampleRate = 48_000;

  it('removes exactly the guard from the head', () => {
    // 80 ms at 48 kHz is 3,840 samples — the sound of the spacebar coming back
    // up, which is otherwise the first thing on every take.
    const samples = new Float32Array(48_000);
    expect(trimLeadIn(samples, sampleRate, 80)).toHaveLength(48_000 - 3_840);
  });

  it('leaves the tail alone', () => {
    const samples = new Float32Array(1_000);
    samples[999] = 0.7;
    const trimmed = trimLeadIn(samples, sampleRate, 10);
    expect(trimmed[trimmed.length - 1]).toBeCloseTo(0.7, 5);
  });

  it('keeps what follows the guard, in order', () => {
    const samples = new Float32Array([1, 2, 3, 4, 5, 6, 7, 8, 9, 10]);
    // 10 samples at 1 kHz is 10 ms; trimming 3 ms drops three.
    expect([...trimLeadIn(samples, 1_000, 3)]).toEqual([4, 5, 6, 7, 8, 9, 10]);
  });

  it('returns nothing rather than a negative length for a take shorter than the guard', () => {
    const samples = new Float32Array(100);
    expect(trimLeadIn(samples, sampleRate, 80)).toHaveLength(0);
  });

  it('returns the take untouched when there is no guard to apply', () => {
    const samples = new Float32Array([1, 2, 3]);
    expect(trimLeadIn(samples, sampleRate, 0)).toBe(samples);
  });
});

describe('trimTail', () => {
  const sampleRate = 48_000;

  it('removes exactly the guard from the end', () => {
    // 60 ms at 48 kHz is 2,880 samples — the overshoot of a guessed latency plus
    // the sound of the key that stopped the take.
    const samples = new Float32Array(48_000);
    expect(trimTail(samples, sampleRate, 60)).toHaveLength(48_000 - 2_880);
  });

  it('leaves the head alone', () => {
    const samples = new Float32Array(48_000);
    samples[0] = 0.7;
    expect(trimTail(samples, sampleRate, 60)[0]).toBeCloseTo(0.7, 5);
  });

  it('keeps what precedes the guard, in order', () => {
    const samples = new Float32Array([1, 2, 3, 4, 5, 6, 7, 8, 9, 10]);
    // 10 samples at 1 kHz is 10 ms; trimming 3 ms drops the last three.
    expect([...trimTail(samples, 1_000, 3)]).toEqual([1, 2, 3, 4, 5, 6, 7]);
  });

  it('returns nothing rather than a negative length for a take shorter than the guard', () => {
    expect(trimTail(new Float32Array(100), sampleRate, 60)).toHaveLength(0);
  });

  it('returns the take untouched when there is no guard to apply', () => {
    const samples = new Float32Array([1, 2, 3]);
    expect(trimTail(samples, sampleRate, 0)).toBe(samples);
  });

  it('takes off both ends when composed with trimLeadIn', () => {
    // How the recorder uses them: the head guard covers the key that started the
    // take, the tail guard the key that stopped it.
    const samples = new Float32Array(1_000);
    const trimmed = trimTail(trimLeadIn(samples, 1_000, 100), 1_000, 100);
    expect(trimmed).toHaveLength(1_000 - 100 - 100);
  });
});

describe('concatenateBlocks', () => {
  it('joins blocks end to end', () => {
    const joined = concatenateBlocks([
      new Float32Array([1, 2]),
      new Float32Array([3]),
      new Float32Array([4, 5]),
    ]);
    expect([...joined]).toEqual([1, 2, 3, 4, 5]);
  });

  it('returns nothing for no blocks', () => {
    expect(concatenateBlocks([])).toHaveLength(0);
  });
});
