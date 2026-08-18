import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import {handleRequest} from '@/lib/api-response';
import {
  decodeToWav,
  findSessionNoiseFloor,
  isFfmpegAvailable,
  renderDeliveryFile,
} from '@/lib/mastering';
import {getStudioContext} from '@/lib/server-context';
import {deriveLedgerState, readLedger} from '@/lib/take-ledger';

export const dynamic = 'force-dynamic';

/**
 * Masters one take so the speaker can hear what will ship, before keeping it.
 *
 * The point is to move the discovery of a problem from days later to seconds
 * later. The denoiser is keyed to the room and the trim cuts at −45 dB, and the
 * sounds most at risk from both are aspirated consonants — which is most of what
 * the Read track teaches. Hearing the processed take while it can still be
 * recorded again is the only cheap way to catch that.
 *
 * It runs the same chain as the batch pass, from the same function, against the
 * same session's noise floor. A preview produced any other way would be a
 * preview of something else.
 *
 * What comes back is the delivered file **decoded to PCM**, not the delivered
 * file itself. `decodeAudioData` is fussy about AAC in an MP4 and Safari refuses
 * files that ffmpeg and Chromium read happily; a preview that will not decode
 * falls back to the raw capture and makes the processing look as though it does
 * nothing. Decoding it here changes the container and nothing else, so the
 * speaker still hears exactly what will ship.
 *
 * Nothing is kept. The take is written to the system temporary directory, read
 * back as the delivered file, and both are removed before the response returns —
 * so a take that gets redone still leaves nothing behind, which is the rule the
 * rest of the studio follows.
 */
export function POST(request: Request): Promise<Response> {
  return handleRequest(async () => {
    if (!isFfmpegAvailable()) {
      return Response.json(
        {error: 'ffmpeg is not installed, so takes cannot be previewed.'},
        {status: 503},
      );
    }

    const wavBytes = new Uint8Array(await request.arrayBuffer());
    if (wavBytes.byteLength === 0) {
      return Response.json({error: 'The preview request carried no audio.'}, {status: 400});
    }

    const {config} = getStudioContext();
    const {currentRoomTone} = deriveLedgerState(readLedger(config.dataPath));
    const noiseFloor = findSessionNoiseFloor(config, currentRoomTone?.sessionId ?? '');

    const workingPath = fs.mkdtempSync(path.join(os.tmpdir(), 'trungtrung-preview-'));
    try {
      const sourcePath = path.join(workingPath, 'take.wav');
      const deliveryPath = path.join(workingPath, 'take.m4a');
      const previewPath = path.join(workingPath, 'preview.wav');
      fs.writeFileSync(sourcePath, wavBytes);

      renderDeliveryFile(sourcePath, deliveryPath, noiseFloor);
      decodeToWav(deliveryPath, previewPath);

      return new Response(fs.readFileSync(previewPath) as unknown as BodyInit, {
        headers: {
          'content-type': 'audio/wav',
          'cache-control': 'no-store',
          // Read on screen beside the take, so the number the denoiser is using
          // is visible rather than inferred.
          'x-noise-floor-decibels': noiseFloor.toFixed(1),
        },
      });
    } finally {
      fs.rmSync(workingPath, {recursive: true, force: true});
    }
  });
}
