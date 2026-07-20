/** High-level entry point; lower-level protocol primitives remain public. */

import { fetchWithX424, type X424FetchOptions } from "./client.js";
import { createFetchX424Handler, protectFetch } from "./fetch.js";
import {
  createExpressHumanDependencyMiddleware,
  type ProtectOptions,
} from "./middleware/resource.js";
import { createNextX424Handler } from "./next.js";

export interface X424Facade {
  readonly express: () => ReturnType<
    typeof createExpressHumanDependencyMiddleware
  >;
  readonly protectFetch: (request: Request) => ReturnType<typeof protectFetch>;
  readonly fetchHandler: (
    handler: Parameters<typeof createFetchX424Handler>[1],
  ) => ReturnType<typeof createFetchX424Handler>;
  readonly nextHandler: <TContext>(
    handler: Parameters<typeof createNextX424Handler<TContext>>[1],
  ) => ReturnType<typeof createNextX424Handler<TContext>>;
}

/** Configure the resource-server contract once and expose framework adapters. */
export function createX424(options: ProtectOptions): X424Facade {
  return Object.freeze({
    express: () => createExpressHumanDependencyMiddleware(options),
    protectFetch: (request: Request) => protectFetch(request, options),
    fetchHandler: (handler: Parameters<typeof createFetchX424Handler>[1]) =>
      createFetchX424Handler(options, handler),
    nextHandler: <TContext>(
      handler: Parameters<typeof createNextX424Handler<TContext>>[1],
    ) => createNextX424Handler(options, handler),
  });
}

/** Client-side facade retained here for discoverability. */
export function createX424Fetch(options: X424FetchOptions) {
  return (input: string | URL | Request, init?: RequestInit) =>
    fetchWithX424(input, init, options);
}
