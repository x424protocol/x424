import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  preset: vi.fn(),
  request: vi.fn(),
  proofOfHuman: vi.fn((options: unknown) => ({ options })),
}));

vi.mock("@worldcoin/idkit-core", () => ({
  IDKit: { request: mocks.request },
  proofOfHuman: mocks.proofOfHuman,
}));

import {
  createHumanRequirement,
  createWorldIdMethodRequirements,
  createWorldIdProviderRequests,
} from "../src/index.js";
import { createWorldIdIdKitProofResolver } from "../src/providers/world-id-client.js";

const binding = { kind: "wallet", value: "0x1234" } as const;

function requirement(options: { allowLegacyProofs?: boolean } = {}) {
  const providerRequests = createWorldIdProviderRequests({
    appId: "app_test",
    rpId: "rp_test",
    action: "vote",
    environment: "staging",
    signingKeyHex: `0x${"ab".repeat(32)}`,
    binding,
    ...(options.allowLegacyProofs === undefined
      ? {}
      : { allowLegacyProofs: options.allowLegacyProofs }),
  });
  return createHumanRequirement({
    purpose: "vote",
    method: "POST",
    uri: "https://api.example.test/votes",
    audience: "https://api.example.test",
    binding,
    accepts: createWorldIdMethodRequirements(options),
    providerRequests,
  });
}

describe("World IDKit proof resolver", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.request.mockReturnValue({ preset: mocks.preset });
  });

  it("builds IDKit from signed provider material and returns the exact result", async () => {
    const nativeProof = {
      protocol_version: "4.0",
      action: "vote",
      responses: [{ identifier: "proof_of_human" }],
    };
    mocks.preset.mockResolvedValue({
      connectorURI: "https://world.org/verify/test",
      pollUntilCompletion: vi.fn().mockResolvedValue({
        success: true,
        result: nativeProof,
      }),
    });
    const connectorUris: string[] = [];
    const resolver = createWorldIdIdKitProofResolver({
      onConnectorUri: ({ connectorUri }) => {
        connectorUris.push(connectorUri);
      },
      wait: { timeout: 60_000 },
    });

    await expect(resolver({ requirement: requirement() })).resolves.toEqual({
      providerId: "world",
      methodId: "proof-of-human",
      descriptorVersion: "1",
      nativeProof,
    });
    expect(connectorUris).toEqual(["https://world.org/verify/test"]);
    expect(mocks.proofOfHuman).toHaveBeenCalledWith({ signal: "0x1234" });
    expect(mocks.request).toHaveBeenCalledWith(
      expect.objectContaining({
        app_id: "app_test",
        action: "vote",
        allow_legacy_proofs: false,
        environment: "staging",
      }),
    );
  });

  it("uses the same ceremony but labels an accepted v3 Orb fallback exactly", async () => {
    const nativeProof = {
      protocol_version: "3.0",
      action: "vote",
      responses: [{ identifier: "orb" }],
    };
    mocks.preset.mockResolvedValue({
      connectorURI: "https://world.org/verify/legacy",
      pollUntilCompletion: vi.fn().mockResolvedValue({
        success: true,
        result: nativeProof,
      }),
    });
    const resolver = createWorldIdIdKitProofResolver();

    await expect(
      resolver({ requirement: requirement({ allowLegacyProofs: true }) }),
    ).resolves.toEqual({
      providerId: "world",
      methodId: "orb-legacy",
      descriptorVersion: "1",
      nativeProof,
    });
    expect(mocks.request).toHaveBeenCalledWith(
      expect.objectContaining({ allow_legacy_proofs: true }),
    );
  });

  it("rejects a legacy fallback that the requirement did not accept", async () => {
    mocks.preset.mockResolvedValue({
      connectorURI: "https://world.org/verify/unexpected-legacy",
      pollUntilCompletion: vi.fn().mockResolvedValue({
        success: true,
        result: {
          protocol_version: "3.0",
          responses: [{ identifier: "orb" }],
        },
      }),
    });

    await expect(
      createWorldIdIdKitProofResolver()({ requirement: requirement() }),
    ).rejects.toThrow("unaccepted human method");
  });
});
