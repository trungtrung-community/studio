/**
 * @fileoverview Turning a thrown error into a response the interface can show.
 *
 * The studio's failures are nearly all configuration: a wrong design-system
 * path, a missing config file, a backup location that is not mounted. Those
 * messages are written to be read by the person recording, so they are passed
 * through to the browser rather than replaced with a status code.
 */

/** The body every failing route returns. */
export interface ApiError {
  error: string;
}

/**
 * Runs a route handler, converting a thrown error into a 500 with its message.
 *
 * @example
 * export const GET = () => handleRequest(() => Response.json(getStudioContext().plan));
 */
export async function handleRequest(
  run: () => Response | Promise<Response>,
): Promise<Response> {
  try {
    return await run();
  } catch (cause) {
    const message = cause instanceof Error ? cause.message : String(cause);
    return Response.json({error: message} satisfies ApiError, {status: 500});
  }
}

/** A 404 for an item id that is not in the plan. */
export function respondItemNotFound(itemId: string): Response {
  return Response.json({error: `No item ${itemId} in the plan.`} satisfies ApiError, {
    status: 404,
  });
}
