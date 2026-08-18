/**
 * @fileoverview `npm run bundle` — write the folder the content pipeline imports.
 *
 * The bundle is verified against its own manifest before this reports success,
 * so a truncated copy is caught here rather than in the other repository.
 */

import path from 'node:path';

import {exportBundle, findCorruptedFiles} from '../lib/export-bundle';
import {buildRecordingPlan} from '../lib/recording-plan';
import {loadStudioConfig} from '../lib/studio-config';

function main(): void {
  const config = loadStudioConfig(path.resolve(process.cwd()));
  const plan = buildRecordingPlan(config.designSystemPath);
  const report = exportBundle(config, plan);

  console.log(`bundled ${report.manifest.count} of ${report.manifest.plannedTakes} takes`);
  console.log(`  ${report.bundlePath}`);

  const {dissent} = report.manifest;
  if (dissent.length) {
    console.log(`  ${dissent.length} dissent ${dissent.length === 1 ? 'note' : 'notes'} carried across`);
  }

  if (report.missingDelivery.length) {
    console.log(
      `\n${report.missingDelivery.length} recorded but not yet mastered — run npm run master:`,
    );
    for (const audioPath of report.missingDelivery.slice(0, 10)) {
      console.log(`  ${audioPath}`);
    }
  }

  if (report.orphaned.length) {
    console.log(
      `\n${report.orphaned.length} recorded against ids the content no longer has, and left out.`,
    );
    console.log('  Their cards changed handle or spelling and have to be recorded again:');
    for (const itemId of report.orphaned.slice(0, 10)) {
      console.log(`  ${itemId}`);
    }
  }

  const corrupted = findCorruptedFiles(report.bundlePath);
  if (corrupted.length) {
    console.error(`\n${corrupted.length} files do not match their checksum:`);
    for (const filePath of corrupted) {
      console.error(`  ${filePath}`);
    }
    process.exitCode = 1;
    return;
  }

  console.log('\nevery file matches its checksum');
}

main();
