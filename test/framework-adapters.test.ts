import { describe, expect, it } from "vitest";
import {
  InMemoryRequirementStore,
  InMemoryResultReplayStore,
  defineHumanMethodDescriptor,
  defineMethodCatalog,
  decodeHumanRequirement,
  generateResultKeyPair,
} from "../src/core.js";
import { createFetchX424Handler } from "../src/fetch.js";
import { createNextX424Handler } from "../src/next.js";

const descriptor = defineHumanMethodDescriptor({
  providerId: "example",
  methodId: "unique-human",
  version: "1",
  status: "enabled",
  claim: "Example unique human",
  nonClaims: ["Authorization"],
  assuranceLevels: ["standard"],
  nativeScopeKinds: ["relying_party"],
  verificationModes: ["backend"],
  pairwisePseudonym: true,
  replaySemantics: "single use",
  recoverySemantics: "provider defined",
  privacy: "pairwise",
});

function options() {
  return {
    deploymentProfile: "dev-local-0.1" as const,
    purpose: "publish-record",
    audience: "https://api.example.test",
    accepts: [
      {
        providerId: descriptor.providerId,
        methodId: descriptor.methodId,
        descriptorVersion: descriptor.version,
        acceptedScopeKinds: ["relying_party" as const],
      },
    ],
    catalog: defineMethodCatalog([descriptor]),
    verifier: generateResultKeyPair().verifier,
    extractBinding: async () => ({
      kind: "agent_key" as const,
      value: "sha256:agent",
    }),
    requirementStore: new InMemoryRequirementStore(),
    replayStore: new InMemoryResultReplayStore(),
    publicOrigin: { publicOrigin: "https://api.example.test" },
    requireIdempotencyKey: false,
  };
}

describe("framework resource adapters", () => {
  it("gives Fetch and Next.js identical exact-body challenges", async () => {
    const body = JSON.stringify({ title: "exact bytes" });
    const fetchHandler = createFetchX424Handler(options(), async () =>
      Response.json({ ok: true }),
    );
    const nextHandler = createNextX424Handler(options(), async () =>
      Response.json({ ok: true }),
    );
    const init = {
      method: "POST",
      headers: { "content-type": "application/json" },
      body,
    };
    const fetchResponse = await fetchHandler(
      new Request("https://api.example.test/records", init),
    );
    const nextResponse = await nextHandler(
      new Request("https://api.example.test/records", init),
      {},
    );
    const fetchRequirement = decodeHumanRequirement(
      fetchResponse.headers.get("human-required")!,
    );
    const nextRequirement = decodeHumanRequirement(
      nextResponse.headers.get("human-required")!,
    );
    expect(fetchResponse.status).toBe(424);
    expect(nextResponse.status).toBe(424);
    expect(fetchRequirement.resource.requestDigest).toBe(
      nextRequirement.resource.requestDigest,
    );
  });
});
