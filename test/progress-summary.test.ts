import {describe, expect, it} from 'vitest';

import {fingerprintItem} from '@/lib/content-fingerprint';
import {describeGroupItems, isSetAside, summariseProgress} from '@/lib/progress-summary';
import type {RecordingItem, RecordingPlan} from '@/lib/recording-plan';
import {
  deriveLedgerState,
  type LedgerEntry,
  type LedgerState,
  type RecordedTake,
  type SetAsideReason,
} from '@/lib/take-ledger';
import type {TakeAnalysis} from '@/lib/wav-codec';

const ANALYSIS: TakeAnalysis = {
  durationMilliseconds: 1_200,
  peakDecibels: -8,
  rootMeanSquareDecibels: -20,
  leadingSilenceMilliseconds: 60,
};

function makeItem(id: string, overrides: Partial<RecordingItem> = {}): RecordingItem {
  return {
    id,
    tibetan: 'ཀ',
    romanization: 'ka',
    english: null,
    wylie: 'ka',
    register: null,
    reviewQuestion: null,
    root: null,
    alsoReads: [],
    audioPath: `audio/letters/${id}.m4a`,
    ...overrides,
  };
}

/** A plan of one group, so a test can be about the counting and nothing else. */
function makePlan(items: RecordingItem[]): RecordingPlan {
  return {
    generatedAt: '2026-08-17T09:00:00.000Z',
    totalTakes: items.length,
    groups: [
      {
        id: 'read-letters',
        track: 'read',
        title: 'Letter names',
        description: 'The thirty.',
        items,
      },
    ],
  };
}

function makeTake(itemId: string, overrides: Partial<RecordedTake> = {}): RecordedTake {
  return {
    kind: 'take',
    itemId,
    audioPath: `audio/letters/${itemId}.m4a`,
    sessionId: '2026-08-17-1',
    recordedAt: '2026-08-17T09:00:00.000Z',
    analysis: ANALYSIS,
    warnings: [],
    ...overrides,
  };
}

/**
 * Sets a card aside, fingerprinting it as it reads right now.
 *
 * Passing the item rather than a fingerprint is the point: a test that wants a
 * stale flag has to say so by changing the item afterwards, exactly as a
 * correction to the content would.
 */
function setAsideEntry(item: RecordingItem, reason: SetAsideReason = 'tibetan'): LedgerEntry {
  return {
    kind: 'set-aside',
    itemId: item.id,
    reason,
    contentFingerprint: fingerprintItem(item),
    recordedAt: '2026-08-17T10:00:00.000Z',
  };
}

function stateFrom(entries: LedgerEntry[]): LedgerState {
  return deriveLedgerState(entries);
}

describe('counting a card that was set aside', () => {
  const first = makeItem('letter.ka');
  const second = makeItem('letter.kha', {tibetan: 'ཁ', romanization: 'kha', wylie: 'kha'});
  const third = makeItem('letter.ga', {tibetan: 'ག', romanization: 'ga', wylie: 'ga'});

  it('counts it apart from recorded and from still to record', () => {
    const plan = makePlan([first, second, third]);
    const summary = summariseProgress(
      plan,
      stateFrom([makeTake('letter.ka'), setAsideEntry(second)]),
    );

    expect(summary.recordedTakes).toBe(1);
    expect(summary.setAsideItems).toBe(1);
    // Three cards, one recorded, one set aside: one is still to record.
    expect(summary.totalTakes - summary.recordedTakes - summary.setAsideItems).toBe(1);
  });

  it('counts it in its own group as well as overall', () => {
    const plan = makePlan([first, second]);
    const summary = summariseProgress(plan, stateFrom([setAsideEntry(second)]));

    expect(summary.groups[0].setAsideItems).toBe(1);
  });

  it('lists it with the reason and enough context to find it', () => {
    const plan = makePlan([first, second]);
    const summary = summariseProgress(plan, stateFrom([setAsideEntry(second, 'romanization')]));

    expect(summary.setAside).toHaveLength(1);
    expect(summary.setAside[0]).toMatchObject({
      itemId: 'letter.kha',
      reason: 'romanization',
      groupId: 'read-letters',
      tibetan: 'ཁ',
    });
  });
});

describe('a card that has been corrected since it was set aside', () => {
  // This is the whole reason the fingerprint exists. Speak ids are built from
  // the English handle and Read ids from the Wylie, so correcting a card's
  // Tibetan or its romanization leaves the id exactly as it was.
  const original = makeItem('letter.ka', {tibetan: 'ཀ', romanization: 'ka'});
  const corrected = makeItem('letter.ka', {tibetan: 'ཀ', romanization: 'kah'});

  it('stops counting as set aside once the content changes', () => {
    const summary = summariseProgress(
      makePlan([corrected]),
      stateFrom([setAsideEntry(original)]),
    );

    expect(summary.setAsideItems).toBe(0);
    expect(summary.setAside).toHaveLength(0);
  });

  it('is reported as corrected, rather than vanishing without explanation', () => {
    const summary = summariseProgress(
      makePlan([corrected]),
      stateFrom([setAsideEntry(original)]),
    );

    expect(summary.corrected.map((entry) => entry.itemId)).toEqual(['letter.ka']);
  });

  it('goes on counting as set aside while the content is unchanged', () => {
    const summary = summariseProgress(
      makePlan([original]),
      stateFrom([setAsideEntry(original)]),
    );

    expect(summary.setAsideItems).toBe(1);
    expect(summary.corrected).toHaveLength(0);
  });

  it('rejoins the queue, which is what isSetAside tells the recording screen', () => {
    const state = stateFrom([setAsideEntry(original)]);

    expect(isSetAside(state, original)).toBe(true);
    expect(isSetAside(state, corrected)).toBe(false);
  });
});

describe('ledger entries the content no longer has', () => {
  it('reports a take recorded against an id that has since changed', () => {
    // Correcting an English handle or a spelling mints a new id, and everything
    // logged against the old one is stranded — including audio that would
    // otherwise be exported under a path nothing ever requests.
    const summary = summariseProgress(
      makePlan([makeItem('letter.ka')]),
      stateFrom([makeTake('letter.ka'), makeTake('letter.gone')]),
    );

    expect(summary.orphanedItemIds).toEqual(['letter.gone']);
  });

  it('reports a set-aside on a card that no longer exists', () => {
    const missing = makeItem('letter.gone');
    const summary = summariseProgress(
      makePlan([makeItem('letter.ka')]),
      stateFrom([setAsideEntry(missing)]),
    );

    expect(summary.orphanedItemIds).toEqual(['letter.gone']);
    // It is not also counted as set aside; there is no card to set aside.
    expect(summary.setAsideItems).toBe(0);
  });

  it('says nothing when every entry still has a card', () => {
    const summary = summariseProgress(
      makePlan([makeItem('letter.ka')]),
      stateFrom([makeTake('letter.ka')]),
    );

    expect(summary.orphanedItemIds).toEqual([]);
  });
});

describe('describeGroupItems', () => {
  const recorded = makeItem('letter.ka');
  const passedOver = makeItem('letter.kha', {tibetan: 'ཁ', romanization: 'kha'});
  const waiting = makeItem('letter.ga', {tibetan: 'ག', romanization: 'ga'});

  it('says what became of every card in the group', () => {
    const plan = makePlan([recorded, passedOver, waiting]);
    const described = describeGroupItems(
      plan.groups[0],
      stateFrom([makeTake('letter.ka'), setAsideEntry(passedOver)]),
    );

    expect(described.map((item) => item.state)).toEqual([
      'recorded',
      'set-aside',
      'waiting',
    ]);
  });

  it('carries the take’s measurements so a rushed one can be spotted', () => {
    const plan = makePlan([recorded]);
    const described = describeGroupItems(plan.groups[0], stateFrom([makeTake('letter.ka')]));

    expect(described[0]).toMatchObject({
      peakDecibels: -8,
      durationMilliseconds: 1_200,
      recordedAt: '2026-08-17T09:00:00.000Z',
    });
  });

  it('carries the reason a card was passed over', () => {
    const plan = makePlan([passedOver]);
    const described = describeGroupItems(
      plan.groups[0],
      stateFrom([setAsideEntry(passedOver, 'unsure')]),
    );

    expect(described[0].setAsideReason).toBe('unsure');
  });

  it('shows a card as recorded even if it was once set aside', () => {
    const plan = makePlan([recorded]);
    const described = describeGroupItems(
      plan.groups[0],
      stateFrom([setAsideEntry(recorded), makeTake('letter.ka')]),
    );

    expect(described[0].state).toBe('recorded');
    expect(described[0].setAsideReason).toBeNull();
  });
});
