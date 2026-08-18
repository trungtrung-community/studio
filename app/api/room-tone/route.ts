import {handleRequest} from '@/lib/api-response';
import {getStudioContext} from '@/lib/server-context';
import {nextSessionId, readLedger} from '@/lib/take-ledger';
import {storeRoomTone} from '@/lib/take-storage';

export const dynamic = 'force-dynamic';

/**
 * Starts a session by capturing how the room sounds with nobody speaking.
 *
 * The body is three seconds of silence. Its measured floor is what the
 * denoiser is keyed to for every take that follows, which is gentler on
 * consonants than guessing the floor from each take's own quiet moments.
 */
export function POST(request: Request): Promise<Response> {
  return handleRequest(async () => {
    const {config} = getStudioContext();
    const wavBytes = new Uint8Array(await request.arrayBuffer());
    const sessionId = nextSessionId(readLedger(config.dataPath), new Date());

    return Response.json(storeRoomTone(config, sessionId, wavBytes, new Date()));
  });
}
