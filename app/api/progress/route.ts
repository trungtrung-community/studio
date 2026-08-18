import {handleRequest} from '@/lib/api-response';
import {summariseProgress} from '@/lib/progress-summary';
import {getStudioContext} from '@/lib/server-context';
import {deriveLedgerState, readLedger} from '@/lib/take-ledger';

/** Progress is replayed from the ledger on every request and must never be prerendered. */
export const dynamic = 'force-dynamic';

/** Returns how far the recording has got, replayed from the ledger. */
export function GET(): Promise<Response> {
  return handleRequest(() => {
    const {config, plan} = getStudioContext();
    const state = deriveLedgerState(readLedger(config.dataPath));
    return Response.json(summariseProgress(plan, state));
  });
}
