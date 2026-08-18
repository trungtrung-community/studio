/**
 * @fileoverview Every fixed audio number the studio uses, named.
 *
 * These values are decisions, not incidental settings. A bare `80` inside an
 * ffmpeg filter string reads as a magic number and invites silent edits. Named
 * here, each one can be found, cited and changed in a single place.
 *
 * Recording runs across roughly thirteen sittings spread over weeks. Anything
 * that differs between two sittings shows up as an audible seam in the app, so
 * every constant below is chosen once and then left alone.
 */

/**
 * Capture sample rate.
 *
 * 48 kHz is what the Blue Yeti delivers natively over USB. Matching it avoids a
 * resample on the way in, and the delivery encoder is set to the same rate so
 * no resample happens on the way out either.
 */
export const CAPTURE_SAMPLE_RATE_HERTZ = 48_000;

/**
 * Mono capture.
 *
 * One voice, one microphone. A second channel would double every file to carry
 * a duplicate of the first.
 */
export const CAPTURE_CHANNEL_COUNT = 1;

/**
 * Seconds of silence captured at the start of a session to profile the room.
 *
 * The measured noise floor keys the denoiser for every take in that session.
 * Three seconds is long enough for a stable average and short enough that it
 * never feels like an obstacle before recording.
 */
export const ROOM_TONE_DURATION_SECONDS = 3;

/**
 * Audio discarded from the head of every take, in milliseconds.
 *
 * A take starts when the spacebar comes back up, by which time the sound of the
 * key being pressed is over. What remains is the quieter click of the key
 * releasing, and this covers it.
 *
 * Deliberately small. It only has to clear a key release, and the mastering pass
 * trims whatever silence follows, so there is no reason to spend more of the
 * take on it. Nobody starts speaking within 80 ms of letting go of a key.
 */
export const KEYPRESS_GUARD_MILLISECONDS = 80;

/**
 * Audio discarded from the end of every take, in milliseconds.
 *
 * The stopping press is a keypress like any other and it lands inside the take,
 * because recording deliberately runs on past the key for one input latency so
 * the last word is not cut off. When that latency is measured the two cancel and
 * the take ends where the speaker stopped. When it is guessed — Safari reports
 * no latency at all — the guess can overshoot, and what the overshoot catches is
 * the sound of the key going down.
 *
 * So this absorbs the error rather than trusting the estimate. Sixty
 * milliseconds is enough for the overshoot and the click together, and small
 * enough to be safe: nobody presses the key while still speaking, and the
 * mastering pass trims the silence that remains either way.
 *
 * If a final consonant ever sounds clipped, this is the number to lower.
 */
export const KEYPRESS_TAIL_GUARD_MILLISECONDS = 60;

/**
 * Audio each bar of the live trace covers, in milliseconds.
 *
 * This is the scroll speed. Twenty-five bars a second is fast enough that the
 * trace moves with the voice rather than after it, and slow enough that a
 * syllable occupies several bars instead of one.
 *
 * It has to be a fixed interval rather than one bar per level reading. Readings
 * arrive at whatever rate the hardware and the browser settle on between them,
 * so a trace drawn per reading scrolls at a speed nobody chose and stops
 * corresponding to elapsed time.
 */
export const LIVE_BAR_MILLISECONDS = 40;

/**
 * Amplitude treated as digital silence when reporting decibels.
 *
 * True silence is negative infinity decibels, which does not survive JSON and
 * does not sort. Anything at or below this is reported as {@link SILENCE_DECIBELS}.
 */
export const SILENCE_DECIBELS = -120;

/** Peak level above which a take is considered clipped, in dBFS. */
export const CLIPPING_PEAK_DECIBELS = -1;

/** Peak level below which a take is considered too quiet to master, in dBFS. */
export const TOO_QUIET_PEAK_DECIBELS = -30;

/**
 * Shortest plausible take, in milliseconds.
 *
 * A single Tibetan letter name still runs past a quarter of a second. Anything
 * briefer is a keystroke misfire rather than speech.
 */
export const MINIMUM_TAKE_DURATION_MILLISECONDS = 250;

/**
 * Longest plausible take, in milliseconds.
 *
 * The longest phrase in the roster is thirteen syllables. Fifteen seconds means
 * the recorder was left running.
 */
export const MAXIMUM_TAKE_DURATION_MILLISECONDS = 15_000;

/**
 * Leading silence beyond which a take is flagged, in milliseconds.
 *
 * The mastering pass trims this away, so a long lead-in costs nothing in the
 * final file. It is flagged because it means the speaker is starting late, and
 * over a session that is worth knowing about.
 */
export const MAXIMUM_LEADING_SILENCE_MILLISECONDS = 2_000;

/** Amplitude below which a sample counts as silence when measuring lead-in. */
export const SILENCE_THRESHOLD_AMPLITUDE = 0.005;

/**
 * High-pass cutoff applied during mastering, in hertz.
 *
 * Removes desk rumble, handling noise and the low-frequency half of a plosive.
 * Tibetan carries no speech information this low, so nothing of the reading is
 * lost.
 */
export const HIGH_PASS_CUTOFF_HERTZ = 80;

/** Silence left before the first sound after trimming, in milliseconds. */
export const LEAD_IN_PADDING_MILLISECONDS = 80;

/** Silence left after the last sound after trimming, in milliseconds. */
export const TAIL_PADDING_MILLISECONDS = 150;

/**
 * Threshold the trimmer treats as silence, in dBFS.
 *
 * Set well below any consonant but above a denoised room floor, so trimming
 * never clips the breathy start of an aspirated letter.
 */
export const TRIM_THRESHOLD_DECIBELS = -45;

/**
 * Target integrated loudness for every delivered take, in LUFS.
 *
 * −16 LUFS is the usual target for speech played on a phone speaker. Applying
 * it to every take is what makes the first and the two-thousandth recording sit
 * at the same loudness in the app.
 */
export const TARGET_LOUDNESS_LUFS = -16;

/** Ceiling the loudness normaliser must not exceed, in dBTP. */
export const TARGET_TRUE_PEAK_DECIBELS = -1.5;

/** Loudness range passed to the normaliser, in LU. */
export const TARGET_LOUDNESS_RANGE = 11;

/**
 * Bitrate of the delivered AAC file, in bits per second.
 *
 * Mono speech at 48 kbps is transparent for this material. The whole roster
 * lands near 70 MB, comfortably inside the app's offline budget.
 */
export const DELIVERY_BITRATE_BITS_PER_SECOND = 48_000;

/**
 * Playback rate the app uses for its slow control.
 *
 * There are no separate slow recordings. Slowing is a player concern, applied
 * with pitch correction at read time. Half speed smears vowels badly, so the
 * rate sits above it while still being clearly slower than natural speech.
 *
 * This constant is documentation for the app rather than something the studio
 * applies. It lives here so the two repositories cannot disagree about it.
 */
export const SLOW_PLAYBACK_RATE = 0.65;
