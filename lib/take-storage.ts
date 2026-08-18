/**
 * @fileoverview Writing a take to disk, measuring it, and recording that it exists.
 *
 * Masters mirror the delivery tree exactly, including its `audio/` segment, so
 * one path rule covers both and neither has to be translated into the other.
 *
 * Every accepted take is copied to the backup location before the request
 * returns. Masters are gitignored and are the only artefact that cannot be
 * produced again without speaking, so the copy happens immediately rather than
 * at the end of a session that might not reach its end.
 */

import fs from 'node:fs';
import path from 'node:path';

import {toMasterPath, type RecordingItem} from './recording-plan';
import type {StudioConfig} from './studio-config';
import {
  appendLedgerEntry,
  type RecordedTake,
  type RoomToneCapture,
} from './take-ledger';
import {analyseTake, decodeWav, findQualityWarnings} from './wav-codec';

const MASTERS_FOLDER = 'masters';
const ROOM_TONE_FOLDER = 'room-tone';

/** Absolute path of the master for one item. */
export function toMasterFilePath(config: StudioConfig, audioPath: string): string {
  return path.join(config.dataPath, MASTERS_FOLDER, toMasterPath(audioPath));
}

/** Absolute path of a session's room tone capture. */
export function toRoomToneFilePath(config: StudioConfig, sessionId: string): string {
  return path.join(config.dataPath, ROOM_TONE_FOLDER, `${sessionId}.wav`);
}

/**
 * Keeps a take: writes the master, mirrors it, and appends it to the ledger.
 *
 * Re-recording an item overwrites its master and appends a second ledger entry.
 * The superseded take is gone from disk but stays visible in the history, which
 * is the level of undo a three-second recording warrants.
 *
 * @param sessionId The sitting this take belongs to, for denoising later.
 *     Empty when no room tone has been captured yet.
 * @returns The ledger entry that was written, including its measurements.
 */
export function storeTake(
  config: StudioConfig,
  item: RecordingItem,
  sessionId: string,
  wavBytes: Uint8Array,
  now: Date,
): RecordedTake {
  const analysis = analyseTake(decodeWav(wavBytes));
  const masterPath = toMasterFilePath(config, item.audioPath);

  writeFileCreatingFolders(masterPath, wavBytes);
  mirrorToBackup(config, masterPath, wavBytes);

  const take: RecordedTake = {
    kind: 'take',
    itemId: item.id,
    audioPath: item.audioPath,
    sessionId,
    recordedAt: now.toISOString(),
    analysis,
    warnings: findQualityWarnings(analysis),
  };

  appendLedgerEntry(config.dataPath, take);
  return take;
}

/**
 * Captures how the room sounds with nobody speaking.
 *
 * The measured floor is what keys the denoiser during mastering, so a session's
 * takes are cleaned against that session's own room rather than a guess made
 * from each take's quiet moments.
 */
export function storeRoomTone(
  config: StudioConfig,
  sessionId: string,
  wavBytes: Uint8Array,
  now: Date,
): RoomToneCapture {
  const analysis = analyseTake(decodeWav(wavBytes));
  const roomTonePath = toRoomToneFilePath(config, sessionId);

  writeFileCreatingFolders(roomTonePath, wavBytes);
  mirrorToBackup(config, roomTonePath, wavBytes);

  const capture: RoomToneCapture = {
    kind: 'room-tone',
    sessionId,
    recordedAt: now.toISOString(),
    analysis,
  };

  appendLedgerEntry(config.dataPath, capture);
  return capture;
}

/**
 * Withdraws a take that was previously kept.
 *
 * The master is deleted because a withdrawn take should not reach the export
 * bundle. The ledger keeps its record of both the take and the withdrawal.
 */
export function discardTake(config: StudioConfig, item: RecordingItem, now: Date): void {
  fs.rmSync(toMasterFilePath(config, item.audioPath), {force: true});
  appendLedgerEntry(config.dataPath, {
    kind: 'discard',
    itemId: item.id,
    recordedAt: now.toISOString(),
  });
}

function writeFileCreatingFolders(filePath: string, bytes: Uint8Array): void {
  fs.mkdirSync(path.dirname(filePath), {recursive: true});
  fs.writeFileSync(filePath, bytes);
}

/**
 * Copies a master to the configured backup location.
 *
 * Silently does nothing when no backup is configured. The server already warns
 * about that at startup, and failing a take here would lose the recording
 * rather than protect it.
 */
function mirrorToBackup(config: StudioConfig, masterPath: string, bytes: Uint8Array): void {
  if (!config.backupPath) {
    return;
  }
  const relativePath = path.relative(config.dataPath, masterPath);
  writeFileCreatingFolders(path.join(config.backupPath, relativePath), bytes);
}
