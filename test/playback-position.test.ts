import {describe, expect, it} from 'vitest';

import {playbackPositionAt, resumeFrom, type PlaybackWindow} from '@/lib/playback-position';

/** Playback of a two-second take, begun from the start at context time 10. */
const fromStart: PlaybackWindow = {
  startedFromSeconds: 0,
  startedAtContextTime: 10,
  durationSeconds: 2,
};

describe('playbackPositionAt', () => {
  it('sits at the beginning the moment playback starts', () => {
    expect(playbackPositionAt(fromStart, 10)).toBe(0);
  });

  it('advances with the context clock', () => {
    expect(playbackPositionAt(fromStart, 10.75)).toBeCloseTo(0.75, 5);
  });

  it('counts from where a seek started it, not from the beginning', () => {
    const afterSeek: PlaybackWindow = {
      startedFromSeconds: 1.2,
      startedAtContextTime: 40,
      durationSeconds: 2,
    };
    expect(playbackPositionAt(afterSeek, 40.5)).toBeCloseTo(1.7, 5);
  });

  it('stops at the end of the take rather than running past it', () => {
    // The node stops itself, but `onended` is not instantaneous — the playhead
    // must not slide off the right-hand edge in the frames between.
    expect(playbackPositionAt(fromStart, 99)).toBe(2);
  });

  it('never reports a position before the take begins', () => {
    expect(playbackPositionAt(fromStart, 9)).toBe(0);
  });
});

describe('resumeFrom', () => {
  it('resumes where it was paused', () => {
    expect(resumeFrom(0.8, 2)).toBeCloseTo(0.8, 5);
  });

  it('starts again from the beginning once it has reached the end', () => {
    // Pressing play at the end should replay, not sit there playing nothing.
    expect(resumeFrom(2, 2)).toBe(0);
    expect(resumeFrom(1.95, 2)).toBe(0);
  });

  it('treats a position just short of the end as the end', () => {
    expect(resumeFrom(1.91, 2)).toBe(0);
    expect(resumeFrom(1.5, 2)).toBeCloseTo(1.5, 5);
  });

  it('clamps a position outside the take', () => {
    expect(resumeFrom(-5, 2)).toBe(0);
    expect(resumeFrom(99, 2)).toBe(0);
  });
});
