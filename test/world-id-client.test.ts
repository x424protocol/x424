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
  createWorldIdMethodRequirement,
  createWorldIdProviderRequest,
} from "../src/index.js";
import { createWorldIdIdKitProofResolver } from "../src/providers/world-id-client.js";

const binding = { kind: "wallet", value: "0x1234" } as const;

function requirement() {
  const providerRequest = createWorldIdProviderRequest({
    appId: "app_test",
    rpId: "rp_test",
    action: "vote",
    environment: "staging",
    signingKeyHex: `0x${"ab".repeat(32)}`,
    binding,
  });
  return createHumanRequirement({
    purpose: "vote",
    method: "POST",
    uri: "https://api.example.test/votes",
    audience: "https://api.example.test",
    binding,
    accepts: [createWorldIdMethodRequirement()],
    providerRequests: { "world:proof-of-human": providerRequest },
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
        environment: "staging",
      }),
    );
  });
});
