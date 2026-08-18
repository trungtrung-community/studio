/**
 * @fileoverview The configuration and plan every route handler needs.
 *
 * Building the plan parses several megabytes of content, so it is built once
 * per process and reused. Content changes are picked up by restarting the
 * studio, which is what happens between sessions anyway.
 */

import {describeGroupItems, isSetAside, type BrowsedItem} from './progress-summary';
import {
  buildRecordingPlan,
  flattenPlanItems,
  type RecordingGroup,
  type RecordingItem,
  type RecordingPlan,
} from './recording-plan';
import {loadStudioConfig, type StudioConfig} from './studio-config';
import {deriveLedgerState, isRoomToneFresh, readLedger} from './take-ledger';

/** Everything a route handler needs to answer a request. */
export interface StudioContext {
  config: StudioConfig;
  plan: RecordingPlan;
  /** Every item in the plan, keyed by id, for lookup on a take request. */
  itemsById: Map<string, RecordingItem>;
}

let cached: StudioContext | null = null;

/**
 * Returns the shared context, building it on first use.
 *
 * @throws If the studio is not configured, or the design-system path is wrong.
 *     Both are startup problems rather than request problems, and both read
 *     more clearly as a failed request than as an empty plan.
 */
export function getStudioContext(): StudioContext {
  if (cached) {
    return cached;
  }

  // The bundler warns that reading a runtime-computed path makes it trace the
  // whole project into the server output. That matters for a deployment. This
  // studio runs from its own checkout and is never deployed, and it has to read
  // a sibling repository it cannot know the location of at build time.
  const config = loadStudioConfig(/* turbopackIgnore: true */ process.cwd());
  const plan = buildRecordingPlan(config.designSystemPath);

  cached = {
    config,
    plan,
    itemsById: new Map(flattenPlanItems(plan).map((item) => [item.id, item])),
  };
  return cached;
}

/** Discards the cached context so the next request rebuilds the plan. */
export function clearStudioContext(): void {
  cached = null;
}

/** Everything the browse view needs for one group. */
export interface GroupBrowseState {
  group: RecordingGroup;
  items: BrowsedItem[];
}

/**
 * Gathers one group's cards and what became of each.
 *
 * @returns Null when no group has that id.
 */
export async function loadGroupBrowseState(
  groupId: string,
): Promise<GroupBrowseState | null> {
  const {config, plan} = getStudioContext();
  const group = plan.groups.find((candidate) => candidate.id === groupId);
  if (!group) {
    return null;
  }

  const state = deriveLedgerState(readLedger(config.dataPath));
  return {group, items: describeGroupItems(group, state)};
}

/** Everything the recording screen needs for one group. */
export interface RecordingSessionState {
  group: RecordingGroup;
  recordedItemIds: string[];
  /**
   * Cards being passed over, which the screen steps over when it opens.
   *
   * Already filtered to those whose text has not changed since. A card that was
   * corrected after being set aside is simply not here, and rejoins the queue.
   */
  setAsideItemIds: string[];
  hasFreshRoomTone: boolean;
}

/**
 * Gathers the state for one group's recording screen.
 *
 * This exists so the page component stays a shell. Reading the clock and the
 * filesystem both belong outside a React render, and gathering them here also
 * makes the freshness rule testable without a browser.
 *
 * @returns Null when no group has that id.
 */
export async function loadRecordingSessionState(
  groupId: string,
): Promise<RecordingSessionState | null> {
  const {config, plan} = getStudioContext();
  const group = plan.groups.find((candidate) => candidate.id === groupId);
  if (!group) {
    return null;
  }

  const state = deriveLedgerState(readLedger(config.dataPath));

  return {
    group,
    recordedItemIds: group.items
      .filter((item) => state.takesByItemId.has(item.id))
      .map((item) => item.id),
    setAsideItemIds: group.items
      .filter((item) => isSetAside(state, item))
      .map((item) => item.id),
    hasFreshRoomTone: isRoomToneFresh(state.currentRoomTone, new Date()),
  };
}
