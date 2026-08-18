import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import {afterEach, beforeEach, describe, expect, it} from 'vitest';

import {exportBundle, findCorruptedFiles} from '@/lib/export-bundle';
import type {RecordingPlan} from '@/lib/recording-plan';
import type {StudioConfig} from '@/lib/studio-config';
import {appendLedgerEntry, type RecordedTake} from '@/lib/take-ledger';
import type {TakeAnalysis} from '@/lib/wav-codec';

const ANALYSIS: TakeAnalysis = {
  durationMilliseconds: 900,
  peakDecibels: -8,
  rootMeanSquareDecibels: -20,
  leadingSilenceMilliseconds: 40,
};

/** A plan with one item, standing in for the two thousand the real one holds. */
const PLAN: RecordingPlan = {
  generatedAt: '2026-08-17T09:00:00.000Z',
  totalTakes: 1,
  groups: [
    {
      id: 'read-letters',
      track: 'read',
      title: 'Letter names',
      description: 'one letter',
      items: [
        {
          id: 'letter.ka',
          tibetan: 'ཀ',
          romanization: 'ka',
          english: null,
          wylie: null,
          register: null,
          reviewQuestion: null,
          root: null,
          alsoReads: [],
          audioPath: 'audio/letters/ka.m4a',
        },
      ],
    },
  ],
};

let config: StudioConfig;

/** Records a take and puts a delivered file where mastering would have. */
function recordAndMaster(audioPath: string, contents: string): void {
  const take: RecordedTake = {
    kind: 'take',
    itemId: 'letter.ka',
    audioPath,
    sessionId: '2026-08-17-1',
    recordedAt: '2026-08-17T09:00:00.000Z',
    analysis: ANALYSIS,
    warnings: [],
  };
  appendLedgerEntry(config.dataPath, take);

  const deliveryPath = path.join(config.dataPath, 'delivery', audioPath);
  fs.mkdirSync(path.dirname(deliveryPath), {recursive: true});
  fs.writeFileSync(deliveryPath, contents);
}

beforeEach(() => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'studio-bundle-'));
  config = {designSystemPath: root, dataPath: root, backupPath: ''};
});

afterEach(() => {
  fs.rmSync(config.dataPath, {recursive: true, force: true});
});

describe('exportBundle', () => {
  it('copies a mastered take in with a checksum', () => {
    recordAndMaster('audio/letters/ka.m4a', 'pretend audio');

    const report = exportBundle(config, PLAN);

    expect(report.manifest.count).toBe(1);
    expect(report.manifest.plannedTakes).toBe(1);
    expect(report.manifest.takes[0].id).toBe('letter.ka');
    expect(report.manifest.takes[0].sha256).toHaveLength(64);
    expect(fs.existsSync(path.join(report.bundlePath, 'audio/letters/ka.m4a'))).toBe(true);
  });

  it('leaves out a take recorded against an id the content no longer has', () => {
    // Correcting an English handle or a spelling mints a new id. Shipping the
    // old take anyway would put audio in the bundle under a path the app never
    // requests, and make the corrected card look covered when it has never been
    // spoken.
    const orphan: RecordedTake = {
      kind: 'take',
      itemId: 'letter.gone',
      audioPath: 'audio/letters/gone.m4a',
      sessionId: '2026-08-17-1',
      recordedAt: '2026-08-17T09:00:00.000Z',
      analysis: ANALYSIS,
      warnings: [],
    };
    appendLedgerEntry(config.dataPath, orphan);
    const deliveryPath = path.join(config.dataPath, 'delivery', orphan.audioPath);
    fs.mkdirSync(path.dirname(deliveryPath), {recursive: true});
    fs.writeFileSync(deliveryPath, 'pretend audio');

    recordAndMaster('audio/letters/ka.m4a', 'pretend audio');
    const report = exportBundle(config, PLAN);

    expect(report.orphaned).toEqual(['letter.gone']);
    expect(report.manifest.count).toBe(1);
    expect(fs.existsSync(path.join(report.bundlePath, 'audio/letters/gone.m4a'))).toBe(false);
    // An orphan is not a missing master; the file is there, the card is not.
    expect(report.missingDelivery).toEqual([]);
  });

  it('reports no orphans when every take still has a card', () => {
    recordAndMaster('audio/letters/ka.m4a', 'pretend audio');

    expect(exportBundle(config, PLAN).orphaned).toEqual([]);
  });

  it('leaves out a take that has been recorded but not mastered', () => {
    appendLedgerEntry(config.dataPath, {
      kind: 'take',
      itemId: 'letter.ka',
      audioPath: 'audio/letters/ka.m4a',
      sessionId: '2026-08-17-1',
      recordedAt: '2026-08-17T09:00:00.000Z',
      analysis: ANALYSIS,
      warnings: [],
    });

    const report = exportBundle(config, PLAN);

    expect(report.manifest.count).toBe(0);
    expect(report.missingDelivery).toEqual(['audio/letters/ka.m4a']);
  });

  it('carries dissent notes across for the native reviewer', () => {
    recordAndMaster('audio/letters/ka.m4a', 'pretend audio');
    appendLedgerEntry(config.dataPath, {
      kind: 'dissent',
      itemId: 'letter.ka',
      note: 'the reading is wrong',
      recordedAt: '2026-08-17T09:05:00.000Z',
    });

    expect(exportBundle(config, PLAN).manifest.dissent).toEqual([
      {id: 'letter.ka', note: 'the reading is wrong', recordedAt: '2026-08-17T09:05:00.000Z'},
    ]);
  });

  it('replaces the previous bundle rather than merging into it', () => {
    recordAndMaster('audio/letters/ka.m4a', 'pretend audio');
    const {bundlePath} = exportBundle(config, PLAN);
    fs.writeFileSync(path.join(bundlePath, 'audio/letters/stale.m4a'), 'left over');

    exportBundle(config, PLAN);

    expect(fs.existsSync(path.join(bundlePath, 'audio/letters/stale.m4a'))).toBe(false);
  });
});

describe('findCorruptedFiles', () => {
  it('passes a bundle it has just written', () => {
    recordAndMaster('audio/letters/ka.m4a', 'pretend audio');
    const {bundlePath} = exportBundle(config, PLAN);

    expect(findCorruptedFiles(bundlePath)).toEqual([]);
  });

  it('catches a file whose contents changed after the manifest was written', () => {
    recordAndMaster('audio/letters/ka.m4a', 'pretend audio');
    const {bundlePath} = exportBundle(config, PLAN);
    fs.writeFileSync(path.join(bundlePath, 'audio/letters/ka.m4a'), 'truncated');

    expect(findCorruptedFiles(bundlePath)).toEqual(['audio/letters/ka.m4a']);
  });

  it('catches a file the manifest lists but the bundle does not contain', () => {
    recordAndMaster('audio/letters/ka.m4a', 'pretend audio');
    const {bundlePath} = exportBundle(config, PLAN);
    fs.rmSync(path.join(bundlePath, 'audio/letters/ka.m4a'));

    expect(findCorruptedFiles(bundlePath)).toEqual(['audio/letters/ka.m4a']);
  });
});
