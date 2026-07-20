import { readFile } from "node:fs/promises";
import { describe, expect, it } from "vitest";
import {
  WorldIdAdapter,
  createHumanRequirement,
  createWorldIdMethodRequirement,
} from "../src/index.js";

interface Fixture {
  readonly verifier: {
    readonly appId: string;
    readonly rpId: string;
    readonly action: string;
    readonly environment: "production" | "staging";
  };
  readonly binding: { readonly kind: "agent_key"; readonly value: string };
  readonly providerRequest: Record<string, unknown>;
  readonly negativeMutations: readonly {
    readonly name: string;
    readonly path: string;
    readonly value: unknown;
  }[];
}

function mutated(
  value: Record<string, unknown>,
  path: string,
  replacement: unknown,
): Record<string, unknown> {
  const copy = structuredClone(value);
  const parts = path.split(".");
  let target = copy;
  for (const part of parts.slice(0, -1)) {
    target = target[part] as Record<string, unknown>;
  }
  target[parts.at(-1)!] = replacement;
  return copy;
}

describe("World provider-request conformance", () => {
  it("accepts the fixed request and rejects every policy mutation", async () => {
    const fixture = JSON.parse(
      await readFile(
        new URL(
          "../conformance/world-v1/provider-request-vectors.json",
          import.meta.url,
        ),
        "utf8",
      ),
    ) as Fixture;
    const acceptedMethod = createWorldIdMethodRequirement();
    const requirement = createHumanRequirement({
      purpose: "conformance",
      method: "POST",
      uri: "https://api.example.test/actions",
      audience: "https://api.example.test",
      binding: fixture.binding,
      accepts: [acceptedMethod],
      providerRequests: {
        "world:proof-of-human": fixture.providerRequest,
      },
    });
    const adapter = new WorldIdAdapter({
      ...fixture.verifier,
      verifyRemote: async () => {
        throw new Error("not called");
      },
    });
    expect(() =>
      adapter.validateProviderRequest({
        requirement,
        acceptedMethod,
        providerRequest: fixture.providerRequest,
      }),
    ).not.toThrow();

    for (const vector of fixture.negativeMutations) {
      expect(
        () =>
          adapter.validateProviderRequest({
            requirement,
            acceptedMethod,
            providerRequest: mutated(
              fixture.providerRequest,
              vector.path,
              vector.value,
            ),
          }),
        vector.name,
      ).toThrow();
    }
  });
});
