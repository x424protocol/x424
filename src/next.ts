/** Next.js App Router adapter. NextRequest is structurally a Fetch Request. */

import { protectFetch } from "./fetch.js";
import type { ProtectOptions } from "./middleware/resource.js";
import type { HumanResult } from "./types.js";

export type NextX424Handler<TContext = unknown> = (
  request: Request,
  context: TContext,
  result: HumanResult,
) => Response | Promise<Response>;

/** Wrap a Next.js route handler without importing Next.js into x424 core. */
export function createNextX424Handler<TContext = unknown>(
  options: ProtectOptions,
  handler: NextX424Handler<TContext>,
): (request: Request, context: TContext) => Promise<Response> {
  return async (request, context) => {
    const protectedRequest = await protectFetch(request, options);
    if (protectedRequest.response) return protectedRequest.response;
    if (!protectedRequest.result) {
      throw new Error("x424 protection completed without a human result");
    }
    return handler(request, context, protectedRequest.result);
  };
}
