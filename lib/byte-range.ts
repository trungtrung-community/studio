/**
 * @fileoverview Serving part of a file, because Safari will not take the whole.
 *
 * A media element does not fetch a sound the way `fetch` does. It probes with a
 * range request first — Safari asks for `bytes=0-1` — and decides from the answer
 * whether the resource can be played at all. Answering `200 OK` with the entire
 * file tells it the server does not do ranges, and Safari refuses the resource
 * outright: `play()` rejects with `NotSupportedError` and the element reports
 * `MEDIA_ERR_SRC_NOT_SUPPORTED`.
 *
 * Chromium is happy either way, which is what makes this worth a file of its own
 * rather than a guess: the same endpoint, the same bytes, and a valid WAV, but
 * playable in one browser and not the other.
 *
 * Range parsing is here rather than in the route so it can be tested against the
 * awkward cases without a server, a browser or a file.
 */

/** What a request asked for, once its `Range` header has been read. */
export type ByteRangeRequest =
  | {kind: 'whole'}
  | {kind: 'partial'; start: number; end: number}
  | {kind: 'unsatisfiable'};

/** `bytes=` followed by one range. Anything else is served whole. */
const SINGLE_BYTE_RANGE = /^bytes=(\d*)-(\d*)$/;

/**
 * Works out which bytes of a file to send.
 *
 * @param header The request's `Range`, or null when it had none.
 * @param size The file's length in bytes.
 * @returns `whole` for a request with no range, and for any range this does not
 *     handle — a server may always answer with the entire representation.
 *     `unsatisfiable` when the range lies outside the file, which is a 416.
 * @example
 * resolveByteRange('bytes=0-1', 500);  // => {kind: 'partial', start: 0, end: 1}
 * resolveByteRange('bytes=100-', 500); // => {kind: 'partial', start: 100, end: 499}
 * resolveByteRange('bytes=-64', 500);  // => {kind: 'partial', start: 436, end: 499}
 */
export function resolveByteRange(header: string | null, size: number): ByteRangeRequest {
  if (!header) {
    return {kind: 'whole'};
  }

  const matched = SINGLE_BYTE_RANGE.exec(header.trim());
  if (!matched) {
    // Several ranges at once, or a unit other than bytes. Both are rare from a
    // media element and both are answered correctly by sending everything.
    return {kind: 'whole'};
  }

  const [, firstText, lastText] = matched;
  if (firstText === '' && lastText === '') {
    return {kind: 'whole'};
  }

  if (size === 0) {
    return {kind: 'unsatisfiable'};
  }

  // `bytes=-64` means the last 64 bytes, not "up to byte 64".
  if (firstText === '') {
    const suffixLength = Number(lastText);
    if (suffixLength === 0) {
      return {kind: 'unsatisfiable'};
    }
    return {kind: 'partial', start: Math.max(0, size - suffixLength), end: size - 1};
  }

  const start = Number(firstText);
  if (start >= size) {
    return {kind: 'unsatisfiable'};
  }

  // An open-ended range runs to the end of the file, and one that overshoots is
  // clamped rather than refused — the client asked for more than exists, and
  // what exists is the correct answer.
  const end = lastText === '' ? size - 1 : Math.min(Number(lastText), size - 1);
  if (end < start) {
    return {kind: 'unsatisfiable'};
  }

  return {kind: 'partial', start, end};
}

/** The `Content-Range` value for a response that carries part of a file. */
export function toContentRange(range: {start: number; end: number}, size: number): string {
  return `bytes ${range.start}-${range.end}/${size}`;
}

/** The `Content-Range` value for a 416, which names the size and nothing else. */
export function toUnsatisfiableContentRange(size: number): string {
  return `bytes */${size}`;
}
