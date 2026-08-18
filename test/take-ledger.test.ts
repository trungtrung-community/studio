import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import {afterEach, beforeEach, describe, expect, it} from 'vitest';

import {
  appendLedgerEntry,
  deriveLedgerState,
  isRoomToneFresh,
  nextSessionId,
  readLedger,
  toLedgerPath,
  type LedgerEntry,
  type RecordedTake,
  type RoomToneCapture,
  type SetAsideItem,
} from '@/lib/take-ledger';
import type {TakeAnalysis} from '@/lib/wav-codec';

const ANALYSIS: TakeAnalysis = {
  durationMilliseconds: 1_200,
  peakDecibels: -8,
  rootMeanSquareDecibels: -20,
  leadingSilenceMilliseconds: 60,
};

function makeTake(itemId: string, overrides: Partial<RecordedTake> = {}): RecordedTake {
  return {
    kind: 'take',
    itemId,
    audioPath: `audio/vocab/${itemId}.m4a`,
    sessionId: '2026-08-17-1',
    recordedAt: '2026-08-17T09:00:00.000Z',
    analysis: ANALYSIS,
    warnings: [],
    ...overrides,
  };
}

let dataPath: string;

beforeEach(() => {
  dataPath = fs.mkdtempSync(path.join(os.tmpdir(), 'studio-ledger-'));
});

afterEach(() => {
  fs.rmSync(dataPath, {recursive: true, force: true});
});

describe('appendLedgerEntry and readLedger', () => {
  it('reads back nothing before anything is recorded', () => {
    expect(readLedger(dataPath)).toEqual([]);
  });

  it('keeps entries in the order they were written', () => {
    appendLedgerEntry(dataPath, makeTake('vocab.core.one'));
    appendLedgerEntry(dataPath, makeTake('vocab.core.two'));

    expect(readLedger(dataPath).map((entry) => (entry as RecordedTake).itemId)).toEqual([
      'vocab.core.one',
      'vocab.core.two',
    ]);
  });

  it('creates the data directory on first write', () => {
    const nested = path.join(dataPath, 'does', 'not', 'exist');
    appendLedgerEntry(nested, makeTake('vocab.core.one'));
    expect(readLedger(nested)).toHaveLength(1);
  });

  it('drops a final line damaged by a crash mid-append', () => {
    appendLedgerEntry(dataPath, makeTake('vocab.core.one'));
    fs.appendFileSync(toLedgerPath(dataPath), '{"kind":"take","itemId":"vocab.co');

    expect(readLedger(dataPath)).toHaveLength(1);
  });

  it('refuses a ledger damaged anywhere but the end', () => {
    fs.writeFileSync(toLedgerPath(dataPath), 'not json\n{"kind":"dissent"}\n');
    expect(() => readLedger(dataPath)).toThrow(/damaged at line 1/);
  });
});

describe('deriveLedgerState', () => {
  it('lets a re-recorded take supersede its predecessor', () => {
    const entries: LedgerEntry[] = [
      makeTake('vocab.core.one', {recordedAt: '2026-08-17T09:00:00.000Z'}),
      makeTake('vocab.core.one', {recordedAt: '2026-08-18T09:00:00.000Z'}),
    ];

    const state = deriveLedgerState(entries);
    expect(state.takesByItemId.size).toBe(1);
    expect(state.takesByItemId.get('vocab.core.one')?.recordedAt).toBe(
      '2026-08-18T09:00:00.000Z',
    );
  });

  it('removes a discarded take while leaving the history intact', () => {
    const entries: LedgerEntry[] = [
      makeTake('vocab.core.one'),
      {kind: 'discard', itemId: 'vocab.core.one', recordedAt: '2026-08-18T09:00:00.000Z'},
    ];

    expect(deriveLedgerState(entries).takesByItemId.has('vocab.core.one')).toBe(false);
    expect(entries).toHaveLength(2);
  });

  it('lets a take recorded after a discard stand again', () => {
    const entries: LedgerEntry[] = [
      makeTake('vocab.core.one'),
      {kind: 'discard', itemId: 'vocab.core.one', recordedAt: '2026-08-18T09:00:00.000Z'},
      makeTake('vocab.core.one', {recordedAt: '2026-08-19T09:00:00.000Z'}),
    ];

    expect(deriveLedgerState(entries).takesByItemId.has('vocab.core.one')).toBe(true);
  });

  it('collects every objection raised about one item', () => {
    const entries: LedgerEntry[] = [
      {
        kind: 'dissent',
        itemId: 'vocab.core.one',
        note: 'honorific here, not plain',
        recordedAt: '2026-08-17T09:00:00.000Z',
      },
      {
        kind: 'dissent',
        itemId: 'vocab.core.one',
        note: 'and the citation form is wrong',
        recordedAt: '2026-08-17T09:05:00.000Z',
      },
    ];

    expect(deriveLedgerState(entries).dissentByItemId.get('vocab.core.one')).toHaveLength(2);
  });

  it('keeps the room tone the next take will be denoised against', () => {
    const entries: LedgerEntry[] = [
      {
        kind: 'room-tone',
        sessionId: '2026-08-17-1',
        recordedAt: '2026-08-17T09:00:00.000Z',
        analysis: ANALYSIS,
      },
      makeTake('vocab.core.one'),
      {
        kind: 'room-tone',
        sessionId: '2026-08-18-1',
        recordedAt: '2026-08-18T09:00:00.000Z',
        analysis: ANALYSIS,
      },
    ];

    expect(deriveLedgerState(entries).currentRoomTone?.sessionId).toBe('2026-08-18-1');
  });

  it('reports no session before the room has been captured', () => {
    expect(deriveLedgerState([]).currentRoomTone).toBeNull();
  });

  it('ignores an entry kind it does not recognise', () => {
    const fromANewerStudio = {kind: 'something-later', itemId: 'x'} as unknown as LedgerEntry;
    expect(() => deriveLedgerState([fromANewerStudio, makeTake('vocab.core.one')])).not.toThrow();
    expect(deriveLedgerState([fromANewerStudio]).takesByItemId.size).toBe(0);
  });
});

describe('setting a card aside', () => {
  function makeSetAside(
    itemId: string,
    overrides: Partial<SetAsideItem> = {},
  ): SetAsideItem {
    return {
      kind: 'set-aside',
      itemId,
      reason: 'tibetan',
      contentFingerprint: 'a1b2c3d4e5f60718',
      recordedAt: '2026-08-17T10:00:00.000Z',
      ...overrides,
    };
  }

  it('holds the reason and what the card said at the time', () => {
    const state = deriveLedgerState([makeSetAside('vocab.core.one')]);
    const entry = state.setAsideByItemId.get('vocab.core.one');

    expect(entry?.reason).toBe('tibetan');
    expect(entry?.contentFingerprint).toBe('a1b2c3d4e5f60718');
  });

  it('keeps the most recent reason when a card is set aside twice', () => {
    const state = deriveLedgerState([
      makeSetAside('vocab.core.one'),
      makeSetAside('vocab.core.one', {
        reason: 'unsure',
        recordedAt: '2026-08-17T11:00:00.000Z',
      }),
    ]);

    expect(state.setAsideByItemId.get('vocab.core.one')?.reason).toBe('unsure');
  });

  it('clears on a put-back', () => {
    const state = deriveLedgerState([
      makeSetAside('vocab.core.one'),
      {kind: 'restore', itemId: 'vocab.core.one', recordedAt: '2026-08-17T11:00:00.000Z'},
    ]);

    expect(state.setAsideByItemId.size).toBe(0);
  });

  it('clears when the card is recorded, without a put-back', () => {
    // Recording a card is the strongest possible statement that it is no longer
    // in doubt, and having to say so twice is a way to leave the two disagreeing.
    const state = deriveLedgerState([makeSetAside('vocab.core.one'), makeTake('vocab.core.one')]);

    expect(state.setAsideByItemId.size).toBe(0);
    expect(state.takesByItemId.has('vocab.core.one')).toBe(true);
  });

  it('can be set aside again after being recorded', () => {
    const state = deriveLedgerState([
      makeTake('vocab.core.one'),
      makeSetAside('vocab.core.one', {recordedAt: '2026-08-17T12:00:00.000Z'}),
    ]);

    expect(state.setAsideByItemId.has('vocab.core.one')).toBe(true);
    // The take stands. Doubting a card does not delete the recording of it.
    expect(state.takesByItemId.has('vocab.core.one')).toBe(true);
  });

  it('leaves other cards alone', () => {
    const state = deriveLedgerState([
      makeSetAside('vocab.core.one'),
      makeSetAside('vocab.core.two'),
      {kind: 'restore', itemId: 'vocab.core.one', recordedAt: '2026-08-17T11:00:00.000Z'},
    ]);

    expect([...state.setAsideByItemId.keys()]).toEqual(['vocab.core.two']);
  });
});

describe('isRoomToneFresh', () => {
  const capture = (recordedAt: string): RoomToneCapture => ({
    kind: 'room-tone',
    sessionId: '2026-08-17-1',
    recordedAt,
    analysis: ANALYSIS,
  });

  it('treats a sitting resumed after lunch as the same room', () => {
    const captured = capture('2026-08-17T09:00:00.000Z');
    expect(isRoomToneFresh(captured, new Date('2026-08-17T13:00:00.000Z'))).toBe(true);
  });

  it('treats the next morning as a new room', () => {
    const captured = capture('2026-08-17T09:00:00.000Z');
    expect(isRoomToneFresh(captured, new Date('2026-08-18T09:00:00.000Z'))).toBe(false);
  });

  it('asks for a capture when the room has never been recorded', () => {
    expect(isRoomToneFresh(null, new Date('2026-08-17T09:00:00.000Z'))).toBe(false);
  });
});

describe('nextSessionId', () => {
  it('numbers the first sitting of a day one', () => {
    expect(nextSessionId([], new Date('2026-08-17T09:00:00.000Z'))).toBe('2026-08-17-1');
  });

  it('numbers a second sitting on the same day two', () => {
    const entries: LedgerEntry[] = [
      {
        kind: 'room-tone',
        sessionId: '2026-08-17-1',
        recordedAt: '2026-08-17T09:00:00.000Z',
        analysis: ANALYSIS,
      },
    ];
    expect(nextSessionId(entries, new Date('2026-08-17T14:00:00.000Z'))).toBe('2026-08-17-2');
  });

  it('starts a new day at one again', () => {
    const entries: LedgerEntry[] = [
      {
        kind: 'room-tone',
        sessionId: '2026-08-17-1',
        recordedAt: '2026-08-17T09:00:00.000Z',
        analysis: ANALYSIS,
      },
    ];
    expect(nextSessionId(entries, new Date('2026-08-18T09:00:00.000Z'))).toBe('2026-08-18-1');
  });
});
