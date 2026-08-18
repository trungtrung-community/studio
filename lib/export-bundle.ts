/**
 * @fileoverview The handoff to the content pipeline.
 *
 * The studio never writes into the design-system repository. It produces a
 * self-describing folder instead, and an importer there copies it in. That
 * keeps each repository the only writer of its own tree, which matters when
 * several terminals are open at once.
 *
 * Every file is listed with a checksum so the importer can verify the bundle
 * rather than trust it.
 */

import {createHash} from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';

import {toDeliveryFilePath} from './mastering';
import type {RecordingPlan} from './recording-plan';
import {flattenPlanItems} from './recording-plan';
import type {StudioConfig} from './studio-config';
import {deriveLedgerState, readLedger, type DissentNote} from './take-ledger';
import type {TakeAnalysis} from './wav-codec';

const BUNDLE_FOLDER = 'out';
const MANIFEST_FILE_NAME = 'manifest.json';

/** One delivered recording, as the importer sees it. */
export interface BundledTake {
  /** The content id this recording belongs to. */
  id: string;
  /** Where it belongs in the content tree, relative to the audio root. */
  path: string;
  sha256: string;
  bytes: number;
  durationMilliseconds: number;
  recordedAt: string;
  sessionId: string;
}

/** An objection the speaker raised, carried across so a reviewer sees it. */
export interface BundledDissent {
  id: string;
  note: string;
  recordedAt: string;
}

/** What the bundle contains, written beside the audio as `manifest.json`. */
export interface BundleManifest {
  generatedAt: string;
  /** Takes in this bundle. */
  count: number;
  /** Takes the content calls for in total, so the importer can report coverage. */
  plannedTakes: number;
  takes: BundledTake[];
  dissent: BundledDissent[];
}

/** What one export produced, and what it could not. */
export interface ExportReport {
  manifest: BundleManifest;
  bundlePath: string;
  /** Takes that are recorded but not yet mastered, so are absent from the bundle. */
  missingDelivery: string[];
  /**
   * Item ids the content no longer has, whose takes were left out.
   *
   * Correcting an English handle or a spelling changes the id, and the audio
   * recorded against the old one becomes a file nothing will ever ask for.
   * Exporting it anyway would inflate the bundle and, worse, make the corrected
   * card look covered when it has never been spoken.
   */
  orphaned: string[];
}

/**
 * Copies every mastered take into a bundle with a manifest.
 *
 * A recorded take with no delivered file is reported rather than exported,
 * because a half-mastered bundle would look complete to the importer.
 *
 * @example
 * const report = exportBundle(config, plan);
 * report.manifest.count; // => 143
 */
export function exportBundle(config: StudioConfig, plan: RecordingPlan): ExportReport {
  const bundlePath = path.join(config.dataPath, BUNDLE_FOLDER);
  fs.rmSync(bundlePath, {recursive: true, force: true});
  fs.mkdirSync(bundlePath, {recursive: true});

  const state = deriveLedgerState(readLedger(config.dataPath));
  const plannedItemIds = new Set(flattenPlanItems(plan).map((item) => item.id));
  const takes: BundledTake[] = [];
  const missingDelivery: string[] = [];
  const orphaned: string[] = [];

  for (const take of state.takesByItemId.values()) {
    if (!plannedItemIds.has(take.itemId)) {
      orphaned.push(take.itemId);
      continue;
    }

    const deliveryPath = toDeliveryFilePath(config, take.audioPath);
    if (!fs.existsSync(deliveryPath)) {
      missingDelivery.push(take.audioPath);
      continue;
    }

    const bytes = fs.readFileSync(deliveryPath);
    const destination = path.join(bundlePath, take.audioPath);
    fs.mkdirSync(path.dirname(destination), {recursive: true});
    fs.writeFileSync(destination, bytes);

    takes.push({
      id: take.itemId,
      path: take.audioPath,
      sha256: createHash('sha256').update(bytes).digest('hex'),
      bytes: bytes.byteLength,
      durationMilliseconds: (take.analysis satisfies TakeAnalysis).durationMilliseconds,
      recordedAt: take.recordedAt,
      sessionId: take.sessionId,
    });
  }

  takes.sort((left, right) => left.path.localeCompare(right.path));

  const manifest: BundleManifest = {
    generatedAt: new Date().toISOString(),
    count: takes.length,
    plannedTakes: plannedItemIds.size,
    takes,
    dissent: collectDissent(state.dissentByItemId),
  };

  fs.writeFileSync(
    path.join(bundlePath, MANIFEST_FILE_NAME),
    `${JSON.stringify(manifest, null, 2)}\n`,
    'utf8',
  );

  return {manifest, bundlePath, missingDelivery, orphaned: orphaned.sort()};
}

/** Flattens the dissent notes into the manifest's shape, newest first. */
function collectDissent(dissentByItemId: Map<string, DissentNote[]>): BundledDissent[] {
  return [...dissentByItemId.entries()]
    .flatMap(([itemId, notes]) =>
      notes.map((note) => ({id: itemId, note: note.note, recordedAt: note.recordedAt})),
    )
    .sort((left, right) => right.recordedAt.localeCompare(left.recordedAt));
}

/**
 * Checks a bundle against its own manifest.
 *
 * Used by the export command to prove what it just wrote. The importer in the
 * design-system repository performs the same check on arrival.
 *
 * @returns Paths whose contents do not match the checksum recorded for them.
 */
export function findCorruptedFiles(bundlePath: string): string[] {
  const manifest = JSON.parse(
    fs.readFileSync(path.join(bundlePath, MANIFEST_FILE_NAME), 'utf8'),
  ) as BundleManifest;

  return manifest.takes
    .filter((take) => {
      const filePath = path.join(bundlePath, take.path);
      if (!fs.existsSync(filePath)) {
        return true;
      }
      const digest = createHash('sha256').update(fs.readFileSync(filePath)).digest('hex');
      return digest !== take.sha256;
    })
    .map((take) => take.path);
}
