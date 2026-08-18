import fs from 'node:fs';

import {handleRequest, respondItemNotFound} from '@/lib/api-response';
import {
  resolveByteRange,
  toContentRange,
  toUnsatisfiableContentRange,
} from '@/lib/byte-range';
import {getStudioContext} from '@/lib/server-context';
import {toMasterFilePath} from '@/lib/take-storage';

export const dynamic = 'force-dynamic';

interface RouteContext {
  params: Promise<{itemId: string}>;
}

/**
 * Serves the master of a kept take, so it can be heard again.
 *
 * The master rather than the delivered file: mastering runs after a session, so
 * for most of a take's life the master is the only version that exists. It is
 * also what a redo decision should be made against, since it is the recording
 * itself and not a processed copy of it.
 *
 * **Range requests are answered properly, and that is not a nicety.** A media
 * element probes a sound before playing it — Safari asks for `bytes=0-1` — and
 * treats a `200` carrying the whole file as "this server does not do ranges",
 * then refuses the resource with `MEDIA_ERR_SRC_NOT_SUPPORTED`. The bytes were
 * right and the WAV was valid; it simply would not play. Chromium never minded,
 * which is what made it look like a missing file rather than a missing header.
 */
export function GET(request: Request, context: RouteContext): Promise<Response> {
  return handleRequest(async () => {
    const {itemId} = await context.params;
    const {config, itemsById} = getStudioContext();
    const item = itemsById.get(itemId);
    if (!item) {
      return respondItemNotFound(itemId);
    }

    const masterPath = toMasterFilePath(config, item.audioPath);
    if (!fs.existsSync(masterPath)) {
      return Response.json({error: `Nothing recorded for ${itemId}.`}, {status: 404});
    }

    const stats = fs.statSync(masterPath);
    const size = stats.size;
    // A redo overwrites the master in place, so the validator has to change when
    // the recording does. Size and modification time together do that, and let
    // the browser keep a copy between presses of play rather than fetching the
    // file again for every one.
    const headers = new Headers({
      'content-type': 'audio/wav',
      'accept-ranges': 'bytes',
      etag: `"${size.toString(16)}-${stats.mtimeMs.toString(16)}"`,
      'cache-control': 'no-cache',
    });

    const range = resolveByteRange(request.headers.get('range'), size);

    if (range.kind === 'unsatisfiable') {
      headers.set('content-range', toUnsatisfiableContentRange(size));
      return new Response(null, {status: 416, headers});
    }

    if (range.kind === 'partial') {
      const length = range.end - range.start + 1;
      const bytes = Buffer.alloc(length);
      const file = fs.openSync(masterPath, 'r');
      try {
        fs.readSync(file, bytes, 0, length, range.start);
      } finally {
        fs.closeSync(file);
      }

      headers.set('content-range', toContentRange(range, size));
      headers.set('content-length', String(length));
      return new Response(bytes as unknown as BodyInit, {status: 206, headers});
    }

    // Stated explicitly. Without it the response goes out chunked, and a media
    // element that cannot learn the length up front cannot set up its decoder.
    headers.set('content-length', String(size));
    return new Response(fs.readFileSync(masterPath) as unknown as BodyInit, {headers});
  });
}
