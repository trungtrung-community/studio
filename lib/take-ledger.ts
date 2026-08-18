/**
 * @fileoverview Everything that has happened, in the order it happened.
 *
 * The ledger is append-only and progress is derived by replaying it. Nothing is
 * ever edited in place, so an interrupted write can damage at most the last
 * line, and a re-recorded take leaves its predecessor visible in the history.
 *
 * Replaying also means the studio has no separate progress figure to keep in
 * step with the files on disk. There is one source and it is the log.
 */

import fs from 'node:fs';
import path from 'node:path';

import type {QualityWarning, TakeAnalysis} from './wav-codec';

/** A kept recording of one item. A later one for the same item supersedes it. */
export interface RecordedTake {
  kind: 'take';
  itemId: string;
  /** Where the delivered file belongs, relative to the audio root. */
  audioPath: string;
  /** The session whose room tone keys this take's denoising. */
  sessionId: string;
  recordedAt: string;
  analysis: TakeAnalysis;
  warnings: QualityWarning[];
}

/** Three seconds of the room, captured once per sitting to profile its noise. */
export interface RoomToneCapture {
  kind: 'room-tone';
  sessionId: string;
  recordedAt: string;
  analysis: TakeAnalysis;
}

/**
 * The speaker's objection to a reading they were asked to record.
 *
 * Roughly a third of vocabulary carries an open question for a native reviewer.
 * A dissent note records that the speaker believes the written form is wrong,
 * so the reviewer can see exactly which takes to revisit.
 */
export interface DissentNote {
  kind: 'dissent';
  itemId: string;
  note: string;
  recordedAt: string;
}

/** A take withdrawn after it was kept. */
export interface DiscardedTake {
  kind: 'discard';
  itemId: string;
  recordedAt: string;
}

/**
 * Why a card was passed over rather than recorded.
 *
 * Three, because they go to three different places. The Tibetan is a question
 * for the native reviewer; the romanization is a question for
 * `content/read/sounds.json` and `romanize.py`; being unsure how to say it is a
 * question about the reading rather than about either written form.
 */
export type SetAsideReason = 'tibetan' | 'romanization' | 'unsure';

/**
 * A card passed over because the speaker believes something about it is wrong.
 *
 * A sitting runs at a take every fifteen seconds, and stopping to write down
 * what is wrong with a card breaks that rhythm badly enough that the temptation
 * is to record it anyway. One keystroke to set it aside costs nothing, and the
 * card can be looked at properly later.
 */
export interface SetAsideItem {
  kind: 'set-aside';
  itemId: string;
  reason: SetAsideReason;
  /**
   * What the card said at the moment it was set aside.
   *
   * The id survives a correction to the Tibetan or the romanization, so without
   * this there would be no way to tell a card that has since been fixed from one
   * that has not. See `lib/content-fingerprint.ts`.
   */
  contentFingerprint: string;
  recordedAt: string;
}

/** A card put back into the queue after having been set aside. */
export interface RestoredItem {
  kind: 'restore';
  itemId: string;
  recordedAt: string;
}

export type LedgerEntry =
  | RecordedTake
  | RoomToneCapture
  | DissentNote
  | DiscardedTake
  | SetAsideItem
  | RestoredItem;

/** The ledger replayed: what is recorded now, and what has been objected to. */
export interface LedgerState {
  /** The take that currently stands for each item. */
  takesByItemId: Map<string, RecordedTake>;
  dissentByItemId: Map<string, DissentNote[]>;
  /** Cards currently passed over. Recording one takes it out of this map. */
  setAsideByItemId: Map<string, SetAsideItem>;
  /**
   * The most recent room tone, which the next take will be keyed to.
   *
   * Its age is what tells the recording screen whether this is still the same
   * sitting or a new one that needs the room captured again.
   */
  currentRoomTone: RoomToneCapture | null;
}

const LEDGER_FILE_NAME = 'takes.jsonl';

/** Absolute path of the ledger for a given data directory. */
export function toLedgerPath(dataPath: string): string {
  return path.join(dataPath, LEDGER_FILE_NAME);
}

/**
 * Appends one entry.
 *
 * A single `appendFile` of one line is the whole write. There is no read, no
 * rewrite and no temporary file, so two requests arriving together cannot lose
 * each other's work.
 */
export function appendLedgerEntry(dataPath: string, entry: LedgerEntry): void {
  fs.mkdirSync(dataPath, {recursive: true});
  fs.appendFileSync(toLedgerPath(dataPath), `${JSON.stringify(entry)}\n`, 'utf8');
}

/**
 * Reads every entry ever written.
 *
 * A damaged final line is dropped rather than thrown on. Only a crash during
 * the last append can produce one, it costs at most a single take, and refusing
 * to start would cost the whole history. A damaged line anywhere earlier means
 * something other than this studio wrote the file, which is worth stopping for.
 *
 * @returns Entries oldest first. Empty when nothing has been recorded yet.
 * @throws If a line other than the last is not valid JSON.
 */
export function readLedger(dataPath: string): LedgerEntry[] {
  const ledgerPath = toLedgerPath(dataPath);
  if (!fs.existsSync(ledgerPath)) {
    return [];
  }

  const lines = fs.readFileSync(ledgerPath, 'utf8').split('\n').filter((line) => line.trim());

  return lines.flatMap((line, index) => {
    try {
      return [JSON.parse(line) as LedgerEntry];
    } catch (cause) {
      if (index === lines.length - 1) {
        return [];
      }
      throw new Error(`${ledgerPath} is damaged at line ${index + 1}: ${String(cause)}`);
    }
  });
}

/**
 * Replays the ledger into the current state.
 *
 * @example
 * const state = deriveLedgerState(readLedger(dataPath));
 * state.takesByItemId.size; // how many items are recorded
 */
export function deriveLedgerState(entries: LedgerEntry[]): LedgerState {
  const takesByItemId = new Map<string, RecordedTake>();
  const dissentByItemId = new Map<string, DissentNote[]>();
  const setAsideByItemId = new Map<string, SetAsideItem>();
  let currentRoomTone: RoomToneCapture | null = null;

  for (const entry of entries) {
    switch (entry.kind) {
      case 'take':
        takesByItemId.set(entry.itemId, entry);
        // Recording a card is the strongest possible statement that it is no
        // longer being passed over.
        setAsideByItemId.delete(entry.itemId);
        break;
      case 'discard':
        takesByItemId.delete(entry.itemId);
        break;
      case 'set-aside':
        setAsideByItemId.set(entry.itemId, entry);
        break;
      case 'restore':
        setAsideByItemId.delete(entry.itemId);
        break;
      case 'dissent': {
        const existing = dissentByItemId.get(entry.itemId) ?? [];
        dissentByItemId.set(entry.itemId, [...existing, entry]);
        break;
      }
      case 'room-tone':
        currentRoomTone = entry;
        break;
      default: {
        // A kind written by a newer version of the studio. Ignoring it keeps an
        // older build usable against a newer ledger instead of refusing to load.
        break;
      }
    }
  }

  return {takesByItemId, dissentByItemId, setAsideByItemId, currentRoomTone};
}

/**
 * How long a captured room stays a fair description of it.
 *
 * A sitting resumed after lunch is the same room. Opening the studio the next
 * morning is not, because the heating, the window and the street outside have
 * all changed since. Six hours separates the two without having to ask.
 */
const ROOM_TONE_LIFETIME_MILLISECONDS = 6 * 60 * 60 * 1000;

/**
 * Whether a captured room still describes the room being recorded in.
 *
 * @param now Passed in rather than read, so the caller owns the clock.
 * @returns False when nothing has been captured, which starts a new sitting.
 */
export function isRoomToneFresh(roomTone: RoomToneCapture | null, now: Date): boolean {
  if (!roomTone) {
    return false;
  }
  return now.getTime() - Date.parse(roomTone.recordedAt) < ROOM_TONE_LIFETIME_MILLISECONDS;
}

/**
 * Names the next recording session.
 *
 * A session is one sitting at the microphone, and it exists so every take can
 * be denoised against the room as it sounded at the time. Names are dated so
 * the history reads plainly, and numbered so two sittings in one day stay
 * distinct.
 *
 * @param entries The whole ledger.
 * @param now Used only for the date part, so a caller can pin it in tests.
 * @example
 * nextSessionId(entries, new Date('2026-08-17')); // => '2026-08-17-1'
 */
export function nextSessionId(entries: LedgerEntry[], now: Date): string {
  const today = now.toISOString().slice(0, 10);
  const todaysSessions = entries.filter(
    (entry) => entry.kind === 'room-tone' && entry.sessionId.startsWith(today),
  );
  return `${today}-${todaysSessions.length + 1}`;
}
