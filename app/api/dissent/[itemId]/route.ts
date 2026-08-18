import {handleRequest, respondItemNotFound} from '@/lib/api-response';
import {getStudioContext} from '@/lib/server-context';
import {appendLedgerEntry} from '@/lib/take-ledger';

export const dynamic = 'force-dynamic';

interface RouteContext {
  params: Promise<{itemId: string}>;
}

/**
 * Records that the speaker disagrees with a written form they were asked to read.
 *
 * Roughly a third of vocabulary carries an open question for a native reviewer.
 * The take is still recorded, because the audio is draft exactly as the text
 * is. This note is what tells the reviewer which readings to listen to first.
 */
export function POST(request: Request, context: RouteContext): Promise<Response> {
  return handleRequest(async () => {
    const {itemId} = await context.params;
    const {config, itemsById} = getStudioContext();
    if (!itemsById.has(itemId)) {
      return respondItemNotFound(itemId);
    }

    const {note} = (await request.json()) as {note?: string};
    if (!note?.trim()) {
      return Response.json({error: 'A dissent note cannot be empty.'}, {status: 400});
    }

    const entry = {
      kind: 'dissent' as const,
      itemId,
      note: note.trim(),
      recordedAt: new Date().toISOString(),
    };
    appendLedgerEntry(config.dataPath, entry);

    return Response.json(entry);
  });
}
