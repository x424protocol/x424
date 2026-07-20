import { canonicalJson, sha256 } from "../canonical.js";
import { defineHumanMethodDescriptor } from "../provider-sdk.js";
import type {
  HumanMethodDescriptor,
  HumanProviderAdapter,
  ProviderVerifiedHuman,
} from "../types.js";
import { isRecord } from "../validation.js";

export const WORLD_ID_ORB_METHOD: HumanMethodDescriptor =
  defineHumanMethodDescriptor({
    providerId: "world",
    methodId: "world-id-4-orb",
    version: "1",
    status: "enabled",
    claim:
      "World accepted a World ID 4.0 proof_of_human uniqueness proof backed by the Orb credential schema for the configured relying party and action.",
    nonClaims: [
      "Civil or legal identity",
      "The human's name, age, nationality, or address",
      "Continuous human presence after verification",
      "Ownership of an agent, wallet, account, or transaction",
      "Authorization for any relying-party action beyond the bound dependency",
      "Equivalence to any non-World unique-human method",
    ],
    assuranceLevels: ["orb"],
    nativeScopeKinds: ["action"],
    verificationModes: ["backend"],
    pairwisePseudonym: true,
    replaySemantics:
      "World ID 4.0 uniqueness nullifiers are one-time. The relying party must also atomically consume the x424 dependency nonce.",
    recoverySemantics:
      "World controls credential and authenticator recovery. x424 rotates local pairwise subjects only through an explicit relying-party migration.",
    privacy:
      "The World nullifier remains inside the adapter. x424 exposes only an audience-pairwise HMAC pseudonym and a proof digest.",
  });

export type WorldIdRemoteVerifier = (nativeProof: unknown) => Promise<unknown>;

export type WorldIdBindingValidator = (input: {
  readonly nativeProof: unknown;
  readonly expectedBinding: { readonly kind: string; readonly value: string };
}) => Promise<boolean>;

export interface WorldIdAdapterOptions {
  readonly rpId: string;
  readonly action: string;
  readonly environment: "production" | "staging";
  readonly verifyRemote?: WorldIdRemoteVerifier;
  readonly validateBinding: WorldIdBindingValidator;
  readonly fetchImplementation?: typeof fetch;
  readonly now?: () => Date;
}

function remoteNullifier(value: unknown): string | undefined {
  if (!isRecord(value) || value.success !== true) return undefined;
  if (typeof value.nullifier === "string" && value.nullifier) {
    return value.nullifier;
  }
  if (!Array.isArray(value.results)) return undefined;
  for (const result of value.results) {
    if (
      isRecord(result) &&
      result.success === true &&
      typeof result.nullifier === "string" &&
      result.nullifier
    ) {
      return result.nullifier;
    }
  }
  return undefined;
}

function assertWorldRequestMetadata(
  providerRequests: Readonly<Record<string, unknown>> | undefined,
  rpId: string,
  action: string,
): void {
  const request = providerRequests?.["world:world-id-4-orb"];
  if (
    !isRecord(request) ||
    request.rpId !== rpId ||
    request.action !== action
  ) {
    throw new Error(
      "Requirement does not contain the configured World RP/action",
    );
  }
}

export class WorldIdAdapter implements HumanProviderAdapter {
  readonly providerId = "world";
  readonly #options: WorldIdAdapterOptions;

  constructor(options: WorldIdAdapterOptions) {
    if (!options.rpId.startsWith("rp_") || !options.action) {
      throw new Error("World adapter requires an rp_ ID and action");
    }
    this.#options = options;
  }

  methods(): readonly HumanMethodDescriptor[] {
    return [WORLD_ID_ORB_METHOD];
  }

  async verify(
    input: Parameters<HumanProviderAdapter["verify"]>[0],
  ): Promise<ProviderVerifiedHuman> {
    assertWorldRequestMetadata(
      input.requirement.providerRequests,
      this.#options.rpId,
      this.#options.action,
    );
    if (
      input.acceptedMethod.descriptorVersion !== WORLD_ID_ORB_METHOD.version ||
      input.acceptedMethod.assuranceLevel !== "orb"
    ) {
      throw new Error(
        "World proof requirement must request descriptor 1 / Orb",
      );
    }
    if (
      !(await this.#options.validateBinding({
        nativeProof: input.proof.nativeProof,
        expectedBinding: input.requirement.binding,
      }))
    ) {
      throw new Error("World proof is not bound to the required caller");
    }

    const response = await (this.#options.verifyRemote
      ? this.#options.verifyRemote(input.proof.nativeProof)
      : this.#verifyWithWorld(input.proof.nativeProof));
    const nullifier = remoteNullifier(response);
    if (!nullifier)
      throw new Error("World did not accept a unique-human proof");

    const verifiedAt =
      isRecord(response) && typeof response.created_at === "string"
        ? response.created_at
        : (this.#options.now?.() ?? new Date()).toISOString();
    return {
      providerId: this.providerId,
      methodId: WORLD_ID_ORB_METHOD.methodId,
      descriptorVersion: WORLD_ID_ORB_METHOD.version,
      assuranceLevel: "orb",
      providerSubject: nullifier,
      uniquenessScope: {
        kind: "action",
        id: `world:${this.#options.rpId}:${this.#options.action}`,
      },
      verificationMode: "backend",
      proofDigest: sha256(canonicalJson(input.proof.nativeProof)),
      verifiedAt,
      stateReferences: [
        `world:rp:${this.#options.rpId}`,
        `world:action:${this.#options.action}`,
        `world:environment:${this.#options.environment}`,
      ],
    };
  }

  async #verifyWithWorld(nativeProof: unknown): Promise<unknown> {
    const fetchImplementation = this.#options.fetchImplementation ?? fetch;
    const origin =
      this.#options.environment === "production"
        ? "https://developer.world.org"
        : "https://staging-developer.worldcoin.org";
    const response = await fetchImplementation(
      `${origin}/api/v4/verify/${encodeURIComponent(this.#options.rpId)}`,
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        // Do not reshape provider-native IDKit proof fields.
        body: JSON.stringify(nativeProof),
        signal: AbortSignal.timeout(15_000),
      },
    );
    const body: unknown = await response.json();
    if (!response.ok)
      throw new Error(`World verification failed (${response.status})`);
    return body;
  }
}
