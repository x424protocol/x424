/** Maintained Fetch resource adapter with exact raw-body binding. */

import type { RequestBodyDigestInput } from "./canonical.js";
import {
  protectFetchResource,
  type FetchProtectResult,
  type ProtectOptions,
} from "./middleware/resource.js";
import { mergeVary } from "./transport.js";
import type { HumanResult } from "./types.js";

export type FetchProtectedHandler = (
  request: Request,
  result: HumanResult,
) => Response | Promise<Response>;

async function bodyInputForRequest(
  request: Request,
): Promise<RequestBodyDigestInput> {
  if (request.method === "GET" || request.method === "HEAD") {
    return { kind: "absent" };
  }
  const bytes = new Uint8Array(await request.clone().arrayBuffer());
  return bytes.byteLength === 0 ? { kind: "empty" } : { kind: "opaque", bytes };
}

/** Challenge or verify a Fetch request, deriving the digest from exact bytes. */
export async function protectFetch(
  request: Request,
  options: ProtectOptions,
): Promise<FetchProtectResult> {
  return protectFetchResource(request, {
    ...options,
    bodyInput: await bodyInputForRequest(request),
  });
}

/**
 * Apply the mandatory cache and CORS headers returned by the x424 protection
 * step to the application response.
 */
export function finalizeFetchX424Response(
  response: Response,
  protectionHeaders: Headers,
): Response {
  const headers = new Headers(response.headers);
  for (const [name, value] of protectionHeaders) {
    if (name.toLowerCase() === "vary") {
      headers.set("vary", mergeVary(headers.get("vary") ?? undefined, value));
    } else {
      headers.set(name, value);
    }
  }
  return new Response(response.body, {
    status: response.status,
    statusText: response.statusText,
    headers,
  });
}

/** Framework-neutral handler for Workers, Bun, Deno, Node, and edge runtimes. */
export function createFetchX424Handler(
  options: ProtectOptions,
  handler: FetchProtectedHandler,
): (request: Request) => Promise<Response> {
  return async (request) => {
    const protectedRequest = await protectFetch(request, options);
    if (protectedRequest.response) return protectedRequest.response;
    if (!protectedRequest.result) {
      throw new Error("x424 protection completed without a human result");
    }
    return finalizeFetchX424Response(
      await handler(request, protectedRequest.result),
      protectedRequest.responseHeaders,
    );
  };
}
