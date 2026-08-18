import {handleRequest, respondItemNotFound} from '@/lib/api-response';
import {getStudioContext} from '@/lib/server-context';
import {deriveLedgerState, readLedger} from '@/lib/take-ledger';
import {discardTake, storeTake} from '@/lib/take-storage';

export const dynamic = 'force-dynamic';

/** Next resolves dynamic segments asynchronously from version 15 onward. */
interface RouteContext {
  params: Promise<{itemId: string}>;
}

/**
 * Keeps a take.
 *
 * The body is the raw WAV the browser captured. It is sent only once the
 * speaker has accepted the take, so a redo never reaches the server and never
 * leaves a file behind.
 */
export function POST(request: Request, context: RouteContext): Promise<Response> {
  return handleRequest(async () => {
    const {itemId} = await context.params;
    const {config, itemsById} = getStudioContext();
    const item = itemsById.get(itemId);
    if (!item) {
      return respondItemNotFound(itemId);
    }

    const wavBytes = new Uint8Array(await request.arrayBuffer());
    const {currentRoomTone} = deriveLedgerState(readLedger(config.dataPath));
    const take = storeTake(config, item, currentRoomTone?.sessionId ?? '', wavBytes, new Date());

    return Response.json(take);
  });
}

/** Withdraws a take that was previously kept, deleting its master. */
export function DELETE(_request: Request, context: RouteContext): Promise<Response> {
  return handleRequest(async () => {
    const {itemId} = await context.params;
    const {config, itemsById} = getStudioContext();
    const item = itemsById.get(itemId);
    if (!item) {
      return respondItemNotFound(itemId);
    }

    discardTake(config, item, new Date());
    return Response.json({discarded: itemId});
  });
}
