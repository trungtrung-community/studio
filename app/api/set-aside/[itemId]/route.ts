import {handleRequest, respondItemNotFound} from '@/lib/api-response';
import {fingerprintItem} from '@/lib/content-fingerprint';
import {getStudioContext} from '@/lib/server-context';
import {appendLedgerEntry, type SetAsideReason} from '@/lib/take-ledger';

export const dynamic = 'force-dynamic';

interface RouteContext {
  params: Promise<{itemId: string}>;
}

const REASONS: readonly SetAsideReason[] = ['tibetan', 'romanization', 'unsure'];

/**
 * Passes a card over, because the speaker believes something about it is wrong.
 *
 * The reason arrives as one of three fixed values rather than as prose. A
 * sitting runs at a take every fifteen seconds, and stopping to write costs more
 * than the note is worth mid-flow; the free-text objection is a separate
 * request, made when there is something specific to say.
 *
 * What the card said is recorded alongside. The item id survives a correction to
 * the Tibetan or the romanization, so without it there would be no way to tell a
 * card that has since been fixed from one that has not.
 */
export function POST(request: Request, context: RouteContext): Promise<Response> {
  return handleRequest(async () => {
    const {itemId} = await context.params;
    const {config, itemsById} = getStudioContext();
    const item = itemsById.get(itemId);
    if (!item) {
      return respondItemNotFound(itemId);
    }

    const {reason} = (await request.json()) as {reason?: string};
    if (!reason || !REASONS.includes(reason as SetAsideReason)) {
      return Response.json(
        {error: `A reason must be one of: ${REASONS.join(', ')}.`},
        {status: 400},
      );
    }

    const entry = {
      kind: 'set-aside' as const,
      itemId,
      reason: reason as SetAsideReason,
      contentFingerprint: fingerprintItem(item),
      recordedAt: new Date().toISOString(),
    };
    appendLedgerEntry(config.dataPath, entry);

    return Response.json(entry);
  });
}

/**
 * Puts a card back into the queue.
 *
 * Appended rather than erased, like everything else in the ledger, so the
 * history still shows that the card was once in doubt.
 */
export function DELETE(_request: Request, context: RouteContext): Promise<Response> {
  return handleRequest(async () => {
    const {itemId} = await context.params;
    const {config, itemsById} = getStudioContext();
    if (!itemsById.has(itemId)) {
      return respondItemNotFound(itemId);
    }

    const entry = {
      kind: 'restore' as const,
      itemId,
      recordedAt: new Date().toISOString(),
    };
    appendLedgerEntry(config.dataPath, entry);

    return Response.json(entry);
  });
}
