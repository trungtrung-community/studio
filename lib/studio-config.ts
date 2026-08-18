/**
 * @fileoverview Where the studio reads content from and writes recordings to.
 *
 * The studio is one of four repositories and owns none of the content it
 * records. It reads the design-system repository without ever writing to it,
 * and hands finished audio back as an exported bundle. These paths are the only
 * coupling between the two.
 */

import fs from 'node:fs';
import path from 'node:path';

/** Resolved locations and session settings for one installation of the studio. */
export interface StudioConfig {
  /** Absolute path to the design-system repository, the source of all content. */
  designSystemPath: string;
  /** Absolute path where lossless masters are mirrored after every take. */
  backupPath: string;
  /** Absolute path holding masters, the take ledger and the export bundle. */
  dataPath: string;
}

/** The shape accepted in `studio.config.json`, before paths are resolved. */
interface StudioConfigFile {
  designSystemPath?: string;
  backupPath?: string;
  dataPath?: string;
}

const CONFIG_FILE_NAME = 'studio.config.json';

const DEFAULT_DESIGN_SYSTEM_PATH = '../design-system';
const DEFAULT_DATA_PATH = './data';

/**
 * Reads and resolves the studio configuration.
 *
 * Relative paths in the file are resolved against the repository root, so the
 * default `../design-system` works for anyone who cloned the four repositories
 * side by side.
 *
 * The backup path is deliberately not defaulted. Masters are the only
 * irreplaceable artefact the studio produces, and a silent default would let
 * weeks of recording accumulate in one place without anyone choosing it.
 *
 * @param repositoryRoot Directory containing `studio.config.json`.
 * @throws If the file is missing, unparseable, or names a design-system path
 *     that does not contain the expected content.
 */
export function loadStudioConfig(repositoryRoot: string): StudioConfig {
  const configPath = path.join(repositoryRoot, CONFIG_FILE_NAME);

  if (!fs.existsSync(configPath)) {
    throw new Error(
      `No ${CONFIG_FILE_NAME} at ${configPath}. Copy ${CONFIG_FILE_NAME}.example and set the paths.`,
    );
  }

  let parsed: StudioConfigFile;
  try {
    parsed = JSON.parse(fs.readFileSync(configPath, 'utf8')) as StudioConfigFile;
  } catch (cause) {
    throw new Error(`${CONFIG_FILE_NAME} is not valid JSON: ${String(cause)}`);
  }

  const resolveAgainstRoot = (value: string): string =>
    path.isAbsolute(value) ? value : path.resolve(repositoryRoot, value);

  const designSystemPath = resolveAgainstRoot(
    parsed.designSystemPath ?? DEFAULT_DESIGN_SYSTEM_PATH,
  );
  const dataPath = resolveAgainstRoot(parsed.dataPath ?? DEFAULT_DATA_PATH);

  assertDesignSystemPath(designSystemPath);

  return {
    designSystemPath,
    backupPath: parsed.backupPath ? resolveAgainstRoot(parsed.backupPath) : '',
    dataPath,
  };
}

/**
 * Confirms a path really is the design-system repository.
 *
 * A wrong path would otherwise surface much later as an empty recording plan,
 * which reads as "nothing left to record" rather than as a misconfiguration.
 */
function assertDesignSystemPath(designSystemPath: string): void {
  const vocabularyPath = path.join(designSystemPath, 'content', 'vocabulary.json');
  if (!fs.existsSync(vocabularyPath)) {
    throw new Error(
      `No content found at ${designSystemPath}. Expected ${vocabularyPath}. ` +
        `Set designSystemPath in ${CONFIG_FILE_NAME}.`,
    );
  }
}

/**
 * Reports whether masters are being mirrored somewhere outside this repository.
 *
 * Masters are gitignored and never leave the machine on their own. Recording a
 * full session without a backup risks losing work that can only be recovered by
 * recording it again.
 */
export function hasUsableBackupPath(config: StudioConfig): boolean {
  return config.backupPath !== '' && fs.existsSync(config.backupPath);
}
