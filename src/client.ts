import {
  HUMAN_PROOF_HEADER,
  HUMAN_REQUIRED_HEADER,
  decodeHumanRequirement,
} from "./http.js";
import type { HumanRequirement } from "./types.js";

export interface HumanDependencyResolution {
  /** Signed x424-result+jws token returned by a trusted verifier. */
  readonly humanProof: string;
}

export type HumanDependencyResolver = (input: {
  readonly requirement: HumanRequirement;
  readonly response: Response;
}) => Promise<HumanDependencyResolution>;

export interface X424FetchOptions {
  readonly resolveHumanDependency: HumanDependencyResolver;
  readonly fetchImplementation?: typeof fetch;
}

/**
 * Execute one HTTP request, resolve one x424 challenge, and retry once with
 * HUMAN-PROOF. The resolver owns provider UI/handoff and verifier submission.
 * Payment and application authorization remain separate response stages.
 */
export async function fetchWithX424(
  input: string | URL | Request,
  init: RequestInit | undefined,
  options: X424FetchOptions,
): Promise<Response> {
  const fetchImplementation = options.fetchImplementation ?? fetch;
  const firstRequest = new Request(input, init);
  const retryBody = firstRequest.clone();
  const firstResponse = await fetchImplementation(firstRequest);
  const required = firstResponse.headers.get(HUMAN_REQUIRED_HEADER);

  if (firstResponse.status !== 424 || !required) return firstResponse;
  if (firstRequest.headers.has(HUMAN_PROOF_HEADER)) return firstResponse;

  const requirement = decodeHumanRequirement(required);
  const challengedUri = firstResponse.url || firstRequest.url;
  if (
    requirement.resource.method !== firstRequest.method ||
    requirement.resource.uri !== challengedUri
  ) {
    throw new Error("Human dependency challenge names another HTTP request");
  }
  const resolution = await options.resolveHumanDependency({
    requirement,
    response: firstResponse,
  });
  if (!resolution.humanProof || resolution.humanProof.length > 65_536) {
    throw new Error("Human dependency resolver returned an invalid proof");
  }

  const headers = new Headers(retryBody.headers);
  headers.set(HUMAN_PROOF_HEADER, resolution.humanProof);
  return fetchImplementation(new Request(retryBody, { headers }));
}
