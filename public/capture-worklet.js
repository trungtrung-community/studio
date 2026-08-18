/**
 * @fileoverview Microphone samples and input level, from the audio thread.
 *
 * This file is served as a static asset rather than imported, because
 * `AudioWorklet.addModule` fetches a URL at runtime and runs it on the audio
 * thread. A bundled module would resolve to something the audio thread cannot
 * load, so it must stay in `public/` and must stay plain JavaScript.
 *
 * Two things are sent up, on different schedules and for different reasons.
 *
 * **Level** goes up about sixty times a second, as a single number. Scanning a
 * block for its peak is a few hundred operations and belongs here; shipping
 * every block to the page merely to measure it meant a copy and a message for
 * 2.67 ms of audio, three hundred and seventy-five times a second.
 *
 * **Sample blocks** go up only while recording. Between takes — which is most of
 * a sitting — nothing is sent at all.
 *
 * **Stopping is a handshake, and that is not decoration.** The page used to take
 * its buffer the instant it asked the audio thread to stop, which discarded
 * every block already posted but not yet delivered — real audio, recorded before
 * the speaker pressed the key. Here the stop request names a number of frames to
 * go on capturing, and the acknowledgement is posted *after* the last of them.
 * Port messages arrive in the order they were sent, so an acknowledgement cannot
 * overtake the audio it follows: when the page sees it, everything has arrived.
 *
 * Anything slow here becomes an audible dropout, so there is no allocation on
 * the level path and no work beyond one pass for the peak.
 */

/** How often the level is reported, in seconds. About sixty times a second. */
const LEVEL_INTERVAL_SECONDS = 1 / 60;

/**
 * Frames gathered before a block is sent up.
 *
 * A render quantum is 128 frames — 2.67 ms — so posting one message per quantum
 * is three hundred and seventy-five messages a second, each with its own copy
 * and its own trip through the port. Chromium absorbs that; Safari falls behind,
 * and a port running behind at the moment recording stops is a port still
 * holding the end of the take.
 *
 * Eight quanta is 21 ms, which cuts the traffic by the same factor while staying
 * far below anything a listener could notice.
 */
const FRAMES_PER_BLOCK = 1024;

/** Sends captured audio to the page, and the input level whether recording or not. */
class CaptureProcessor extends AudioWorkletProcessor {
  constructor() {
    super();
    this.recording = false;

    /**
     * Frames still to capture after the page asked to stop.
     *
     * Sound reaches this thread later than it reaches the microphone, so the
     * blocks that arrive after the request are of audio from before it. Counted
     * down here rather than timed on the page, because the audio clock is the
     * only one that measures audio.
     */
    this.flushFramesLeft = 0;

    this.peakSinceReport = 0;
    this.sumOfSquaresSinceReport = 0;
    this.framesSinceReport = 0;

    /** Captured frames not yet sent, and how many of it are filled. */
    this.pending = new Float32Array(FRAMES_PER_BLOCK);
    this.pendingFrames = 0;

    this.port.onmessage = (event) => {
      const message = event.data;
      if (!message) {
        return;
      }
      if (message.type === 'start') {
        this.recording = true;
        this.flushFramesLeft = 0;
        this.pendingFrames = 0;
      } else if (message.type === 'stop' && this.recording) {
        this.flushFramesLeft = Math.max(0, message.flushFrames | 0);
        if (this.flushFramesLeft === 0) {
          this.finishRecording();
        }
      }
    };
  }

  /** Sends whatever has been gathered but not yet posted. */
  sendPending() {
    if (this.pendingFrames === 0) {
      return;
    }
    this.port.postMessage({
      type: 'block',
      samples: this.pending.slice(0, this.pendingFrames),
    });
    this.pendingFrames = 0;
  }

  /**
   * Stops capturing and tells the page every block is now on its way to it.
   *
   * The part-filled block goes first. Messages arrive in the order they were
   * posted, so the acknowledgement following it is what proves the take is
   * complete — sending it while audio was still held here would prove nothing.
   */
  finishRecording() {
    this.sendPending();
    this.recording = false;
    this.flushFramesLeft = 0;
    this.port.postMessage({type: 'stopped'});
  }

  /**
   * @param {Float32Array[][]} inputs One array of channels per connected input.
   * @returns {boolean} Always true, so the node stays alive between takes.
   */
  process(inputs) {
    const channels = inputs[0];
    if (!channels || channels.length === 0) {
      return true;
    }

    const frameCount = channels[0].length;

    // Downmix rather than taking the first channel. A microphone that reports
    // itself as stereo would otherwise be recorded from its left side only,
    // silently, and a Yeti in stereo mode does exactly that.
    let mono;
    if (channels.length === 1) {
      mono = channels[0];
    } else {
      mono = new Float32Array(frameCount);
      for (let index = 0; index < frameCount; index += 1) {
        let sum = 0;
        for (let channel = 0; channel < channels.length; channel += 1) {
          sum += channels[channel][index];
        }
        mono[index] = sum / channels.length;
      }
    }

    // Both are measured, because they answer different questions. The peak says
    // whether anything clipped; the mean says how loud the voice actually is.
    // A meter driven by peak alone swings wildly on steady sound, because the
    // peak of noise is itself noisy — which reads as a broken meter rather than
    // as a quiet room.
    let peak = this.peakSinceReport;
    let sumOfSquares = this.sumOfSquaresSinceReport;
    for (let index = 0; index < frameCount; index += 1) {
      const sample = mono[index];
      const magnitude = sample < 0 ? -sample : sample;
      if (magnitude > peak) {
        peak = magnitude;
      }
      sumOfSquares += sample * sample;
    }
    this.peakSinceReport = peak;
    this.sumOfSquaresSinceReport = sumOfSquares;

    this.framesSinceReport += frameCount;
    if (this.framesSinceReport >= sampleRate * LEVEL_INTERVAL_SECONDS) {
      this.port.postMessage({
        type: 'level',
        peak: this.peakSinceReport,
        mean: Math.sqrt(this.sumOfSquaresSinceReport / this.framesSinceReport),
      });
      this.peakSinceReport = 0;
      this.sumOfSquaresSinceReport = 0;
      this.framesSinceReport = 0;
    }

    if (this.recording) {
      // Gathered rather than sent one quantum at a time. The runtime reuses its
      // buffer for the next quantum, so this copy has to happen either way.
      for (let index = 0; index < frameCount; index += 1) {
        this.pending[this.pendingFrames] = mono[index];
        this.pendingFrames += 1;
        if (this.pendingFrames === FRAMES_PER_BLOCK) {
          this.sendPending();
        }
      }

      if (this.flushFramesLeft > 0) {
        this.flushFramesLeft -= frameCount;
        if (this.flushFramesLeft <= 0) {
          this.finishRecording();
        }
      }
    }

    return true;
  }
}

registerProcessor('capture-processor', CaptureProcessor);
