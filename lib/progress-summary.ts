/**
 * @fileoverview What the dashboard shows, derived from the plan and the ledger.
 *
 * Nothing here is stored. Every figure is recomputed from the two sources on
 * each request, which is the same discipline the content pipeline follows: a
 * number that cannot be recomputed does not get shown.
 */

import {fingerprintItem} from './content-fingerprint';
import type {RecordingGroup, RecordingItem, RecordingPlan} from './recording-plan';
import type {
  DissentNote,
  LedgerState,
  RecordedTake,
  SetAsideItem,
  SetAsideReason,
} from './take-ledger';
import type {QualityWarning} from './wav-codec';

/** How far one sitting's worth of work has got. */
export interface GroupProgress {
  id: string;
  track: 'speak' | 'read';
  title: string;
  description: string;
  totalTakes: number;
  recordedTakes: number;
  /** Recorded takes carrying at least one quality warning. */
  flaggedTakes: number;
  /** Cards passed over, which are neither recorded nor still to record. */
  setAsideItems: number;
}

/** Takes kept on one calendar day. */
export interface DailyCount {
  date: string;
  takes: number;
}

/** A kept take worth looking at again, with enough context to find it. */
export interface FlaggedTake {
  itemId: string;
  tibetan: string;
  romanization: string | null;
  groupId: string;
  groupTitle: string;
  recordedAt: string;
  warnings: QualityWarning[];
}

/** A card passed over, with enough context to decide what to do about it. */
export interface SetAsideEntry {
  itemId: string;
  tibetan: string;
  romanization: string | null;
  english: string | null;
  groupId: string;
  groupTitle: string;
  reason: SetAsideReason;
  reviewQuestion: string | null;
  recordedAt: string;
}

/** An objection the speaker raised, paired with the question that prompted it. */
export interface DissentEntry {
  itemId: string;
  tibetan: string;
  groupId: string;
  groupTitle: string;
  reviewQuestion: string | null;
  note: string;
  recordedAt: string;
}

/** Everything the dashboard needs, in one response. */
export interface ProgressSummary {
  totalTakes: number;
  recordedTakes: number;
  /** Cards passed over and still passed over, counted apart from the rest. */
  setAsideItems: number;
  groups: GroupProgress[];
  dailyCounts: DailyCount[];
  flaggedTakes: FlaggedTake[];
  setAside: SetAsideEntry[];
  /**
   * Cards that were set aside and have since been corrected in the content.
   *
   * They are back in the queue already; this is only so the correction is
   * visible, rather than the card quietly reappearing with no explanation.
   */
  corrected: SetAsideEntry[];
  /**
   * Ledger entries naming items the content no longer has.
   *
   * A card whose English handle or spelling changed arrives under a new id, and
   * everything recorded against the old one is stranded — including audio that
   * would otherwise be exported under a path the app will never request.
   */
  orphanedItemIds: string[];
  dissent: DissentEntry[];
  currentSessionId: string | null;
  /** When the room was last captured, so the screen can tell a new sitting from a resumed one. */
  roomToneCapturedAt: string | null;
  /** Mean takes kept per sitting so far. Null before the first one. */
  averageTakesPerSession: number | null;
  /** Sittings still needed at that rate. Null until there is a rate. */
  estimatedSessionsRemaining: number | null;
}

/**
 * Builds the dashboard view of the work.
 *
 * @example
 * const summary = summariseProgress(plan, deriveLedgerState(readLedger(dataPath)));
 * summary.recordedTakes; // => 143
 */
export function summariseProgress(
  plan: RecordingPlan,
  state: LedgerState,
): ProgressSummary {
  const groups = plan.groups.map((group) => {
    const recorded = group.items.filter((item) => state.takesByItemId.has(item.id));
    return {
      id: group.id,
      track: group.track,
      title: group.title,
      description: group.description,
      totalTakes: group.items.length,
      recordedTakes: recorded.length,
      flaggedTakes: recorded.filter(
        (item) => (state.takesByItemId.get(item.id)?.warnings.length ?? 0) > 0,
      ).length,
      setAsideItems: group.items.filter((item) => isSetAside(state, item)).length,
    };
  });

  const recordedTakes = groups.reduce((total, group) => total + group.recordedTakes, 0);
  const takes = [...state.takesByItemId.values()];
  const {setAside, corrected} = collectSetAside(plan, state);

  const sessionCount = new Set(takes.map((take) => take.sessionId).filter(Boolean)).size;
  const averageTakesPerSession = sessionCount
    ? Math.round(recordedTakes / sessionCount)
    : null;

  // What is left to do excludes the cards being passed over, so the figure means
  // "still to say" rather than "still outstanding for any reason".
  const remainingTakes = plan.totalTakes - recordedTakes - setAside.length;

  return {
    totalTakes: plan.totalTakes,
    recordedTakes,
    setAsideItems: setAside.length,
    groups,
    dailyCounts: countByDay(takes),
    flaggedTakes: collectFlaggedTakes(plan, state),
    setAside,
    corrected,
    orphanedItemIds: findOrphanedItemIds(plan, state),
    dissent: collectDissent(plan, state),
    currentSessionId: state.currentRoomTone?.sessionId ?? null,
    roomToneCapturedAt: state.currentRoomTone?.recordedAt ?? null,
    averageTakesPerSession,
    estimatedSessionsRemaining: averageTakesPerSession
      ? Math.ceil(remainingTakes / averageTakesPerSession)
      : null,
  };
}

/** What has happened to a card, which is the only thing a browse view sorts on. */
export type ItemState = 'recorded' | 'set-aside' | 'waiting';

/** One card as the browse view shows it: what it says and what became of it. */
export interface BrowsedItem {
  itemId: string;
  tibetan: string;
  romanization: string | null;
  english: string | null;
  wylie: string | null;
  state: ItemState;
  reviewQuestion: string | null;
  /** Present when a take stands. */
  recordedAt: string | null;
  peakDecibels: number | null;
  durationMilliseconds: number | null;
  warnings: QualityWarning[];
  /** Present when the card is being passed over. */
  setAsideReason: SetAsideReason | null;
}

/**
 * Describes every card in one group against what has been recorded.
 *
 * The whole group in one list, which is the view a sitting cannot give: a
 * sitting shows one card at a time, and that is right for recording and useless
 * for finding the take that was rushed two hundred cards ago.
 *
 * @example
 * describeGroupItems(group, state).filter((item) => item.state === 'waiting');
 */
export function describeGroupItems(
  group: RecordingGroup,
  state: LedgerState,
): BrowsedItem[] {
  return group.items.map((item) => {
    const take = state.takesByItemId.get(item.id);
    const passedOver = isSetAside(state, item);

    return {
      itemId: item.id,
      tibetan: item.tibetan,
      romanization: item.romanization,
      english: item.english,
      wylie: item.wylie,
      state: take ? 'recorded' : passedOver ? 'set-aside' : 'waiting',
      reviewQuestion: item.reviewQuestion,
      recordedAt: take?.recordedAt ?? null,
      peakDecibels: take?.analysis.peakDecibels ?? null,
      durationMilliseconds: take?.analysis.durationMilliseconds ?? null,
      warnings: take?.warnings ?? [],
      setAsideReason: passedOver
        ? (state.setAsideByItemId.get(item.id)?.reason ?? null)
        : null,
    };
  });
}

/**
 * Whether a card is currently being passed over.
 *
 * False once the content has been corrected, even though the ledger entry is
 * still there. Nothing clears a set-aside by hand: the flag describes a card as
 * it read at the time, and a card that no longer reads that way has been dealt
 * with.
 *
 * @example
 * isSetAside(state, item); // => false, after the Tibetan was fixed
 */
export function isSetAside(state: LedgerState, item: RecordingItem): boolean {
  const entry = state.setAsideByItemId.get(item.id);
  return entry !== undefined && entry.contentFingerprint === fingerprintItem(item);
}

/** Takes per calendar day, oldest first, skipping days with nothing recorded. */
function countByDay(takes: RecordedTake[]): DailyCount[] {
  const byDate = new Map<string, number>();
  for (const take of takes) {
    const date = take.recordedAt.slice(0, 10);
    byDate.set(date, (byDate.get(date) ?? 0) + 1);
  }

  return [...byDate.entries()]
    .map(([date, count]) => ({date, takes: count}))
    .sort((left, right) => left.date.localeCompare(right.date));
}

/** Builds a lookup from item id to the item and the group it sits in. */
function indexItems(plan: RecordingPlan): Map<
  string,
  {item: RecordingItem; groupId: string; groupTitle: string}
> {
  const index = new Map<string, {item: RecordingItem; groupId: string; groupTitle: string}>();
  for (const group of plan.groups) {
    for (const item of group.items) {
      index.set(item.id, {item, groupId: group.id, groupTitle: group.title});
    }
  }
  return index;
}

/** Kept takes that tripped a warning, worst-flagged first. */
function collectFlaggedTakes(plan: RecordingPlan, state: LedgerState): FlaggedTake[] {
  const index = indexItems(plan);

  return [...state.takesByItemId.values()]
    .filter((take) => take.warnings.length > 0)
    .flatMap((take) => {
      const found = index.get(take.itemId);
      if (!found) {
        // The item left the content after the take was recorded. Its file is
        // still on disk, but there is nothing to show it against.
        return [];
      }
      return [
        {
          itemId: take.itemId,
          tibetan: found.item.tibetan,
          romanization: found.item.romanization,
          groupId: found.groupId,
          groupTitle: found.groupTitle,
          recordedAt: take.recordedAt,
          warnings: take.warnings,
        },
      ];
    })
    .sort((left, right) => right.warnings.length - left.warnings.length);
}

/**
 * Splits the set-aside entries into those that still apply and those that do not.
 *
 * A card whose text has changed since it was set aside has been corrected, and
 * is reported separately so the correction is visible rather than the card
 * silently rejoining the queue.
 */
function collectSetAside(
  plan: RecordingPlan,
  state: LedgerState,
): {setAside: SetAsideEntry[]; corrected: SetAsideEntry[]} {
  const index = indexItems(plan);
  const setAside: SetAsideEntry[] = [];
  const corrected: SetAsideEntry[] = [];

  for (const entry of state.setAsideByItemId.values()) {
    const found = index.get(entry.itemId);
    if (!found) {
      // The card left the content entirely, which `findOrphanedItemIds` reports.
      continue;
    }
    const shown = toSetAsideEntry(entry, found);
    (entry.contentFingerprint === fingerprintItem(found.item) ? setAside : corrected).push(
      shown,
    );
  }

  const newestFirst = (left: SetAsideEntry, right: SetAsideEntry): number =>
    right.recordedAt.localeCompare(left.recordedAt);
  return {setAside: setAside.sort(newestFirst), corrected: corrected.sort(newestFirst)};
}

function toSetAsideEntry(
  entry: SetAsideItem,
  found: {item: RecordingItem; groupId: string; groupTitle: string},
): SetAsideEntry {
  return {
    itemId: entry.itemId,
    tibetan: found.item.tibetan,
    romanization: found.item.romanization,
    english: found.item.english,
    groupId: found.groupId,
    groupTitle: found.groupTitle,
    reason: entry.reason,
    reviewQuestion: found.item.reviewQuestion,
    recordedAt: entry.recordedAt,
  };
}

/**
 * Ledger entries naming items the content no longer has.
 *
 * Correcting an English handle or a spelling changes the id, so the corrected
 * card arrives as a new unrecorded item and everything logged against the old
 * one is stranded. Silence about that would mean a take exported under a path
 * nothing asks for, and a card that looks unrecorded for no visible reason.
 */
function findOrphanedItemIds(plan: RecordingPlan, state: LedgerState): string[] {
  const index = indexItems(plan);
  const referenced = [
    ...state.takesByItemId.keys(),
    ...state.setAsideByItemId.keys(),
    ...state.dissentByItemId.keys(),
  ];
  return [...new Set(referenced.filter((itemId) => !index.has(itemId)))].sort();
}

/** Objections raised, newest first, each shown against the question that prompted it. */
function collectDissent(plan: RecordingPlan, state: LedgerState): DissentEntry[] {
  const index = indexItems(plan);

  return [...state.dissentByItemId.entries()]
    .flatMap(([itemId, notes]: [string, DissentNote[]]) => {
      const found = index.get(itemId);
      if (!found) {
        return [];
      }
      return notes.map((note) => ({
        itemId,
        tibetan: found.item.tibetan,
        groupId: found.groupId,
        groupTitle: found.groupTitle,
        reviewQuestion: found.item.reviewQuestion,
        note: note.note,
        recordedAt: note.recordedAt,
      }));
    })
    .sort((left, right) => right.recordedAt.localeCompare(left.recordedAt));
}
