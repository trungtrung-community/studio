import {handleRequest} from '@/lib/api-response';
import {getStudioContext} from '@/lib/server-context';

/** The plan is read from disk on every request and must never be prerendered. */
export const dynamic = 'force-dynamic';

/** Returns every take the content currently calls for, grouped into sittings. */
export function GET(): Promise<Response> {
  return handleRequest(() => Response.json(getStudioContext().plan));
}
