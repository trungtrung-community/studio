import {describe, expect, it} from 'vitest';

import {
  resolveByteRange,
  toContentRange,
  toUnsatisfiableContentRange,
} from '@/lib/byte-range';

/** A take's worth of bytes, near enough. */
const SIZE = 500;

describe('resolveByteRange', () => {
  it('sends the whole file when nothing was asked for', () => {
    expect(resolveByteRange(null, SIZE)).toEqual({kind: 'whole'});
  });

  it('answers the probe a media element opens with', () => {
    // Safari asks for exactly this before it will play anything, and refuses the
    // resource outright if the answer is the whole file with a 200.
    expect(resolveByteRange('bytes=0-1', SIZE)).toEqual({kind: 'partial', start: 0, end: 1});
  });

  it('runs an open-ended range to the end of the file', () => {
    expect(resolveByteRange('bytes=100-', SIZE)).toEqual({
      kind: 'partial',
      start: 100,
      end: 499,
    });
  });

  it('reads a suffix range as the last bytes, not the first', () => {
    expect(resolveByteRange('bytes=-64', SIZE)).toEqual({
      kind: 'partial',
      start: 436,
      end: 499,
    });
  });

  it('clamps a suffix longer than the file', () => {
    expect(resolveByteRange('bytes=-9000', SIZE)).toEqual({
      kind: 'partial',
      start: 0,
      end: 499,
    });
  });

  it('clamps an end past the last byte rather than refusing', () => {
    // The client asked for more than exists. What exists is the right answer.
    expect(resolveByteRange('bytes=400-9000', SIZE)).toEqual({
      kind: 'partial',
      start: 400,
      end: 499,
    });
  });

  it('serves the whole file for a range it does not handle', () => {
    // Several ranges at once, and units other than bytes. A server may always
    // answer with the entire representation.
    expect(resolveByteRange('bytes=0-1,10-20', SIZE)).toEqual({kind: 'whole'});
    expect(resolveByteRange('items=0-1', SIZE)).toEqual({kind: 'whole'});
    expect(resolveByteRange('bytes=-', SIZE)).toEqual({kind: 'whole'});
  });

  it('refuses a range that starts past the end', () => {
    expect(resolveByteRange('bytes=500-', SIZE)).toEqual({kind: 'unsatisfiable'});
    expect(resolveByteRange('bytes=900-1000', SIZE)).toEqual({kind: 'unsatisfiable'});
  });

  it('refuses a zero-length suffix', () => {
    expect(resolveByteRange('bytes=-0', SIZE)).toEqual({kind: 'unsatisfiable'});
  });

  it('refuses any range into an empty file', () => {
    expect(resolveByteRange('bytes=0-1', 0)).toEqual({kind: 'unsatisfiable'});
  });

  it('refuses a range that ends before it starts', () => {
    expect(resolveByteRange('bytes=300-200', SIZE)).toEqual({kind: 'unsatisfiable'});
  });

  it('reads a range with surrounding space', () => {
    expect(resolveByteRange('  bytes=0-1  ', SIZE)).toEqual({
      kind: 'partial',
      start: 0,
      end: 1,
    });
  });

  it('covers the whole file when asked for all of it', () => {
    expect(resolveByteRange('bytes=0-', SIZE)).toEqual({kind: 'partial', start: 0, end: 499});
  });
});

describe('content range headers', () => {
  it('names the bytes sent and the size of the whole', () => {
    expect(toContentRange({start: 0, end: 1}, SIZE)).toBe('bytes 0-1/500');
  });

  it('names only the size when the range could not be met', () => {
    expect(toUnsatisfiableContentRange(SIZE)).toBe('bytes */500');
  });
});
