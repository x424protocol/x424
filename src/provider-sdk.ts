import { defineMethodCatalog, isHumanMethodIdentifier } from "./catalog.js";
import type {
  HumanMethodDescriptor,
  HumanProviderAdapter,
  ProviderVerifiedHuman,
} from "./types.js";

export type ProviderAdapterVerify = HumanProviderAdapter["verify"];
export type ProviderAdapterValidateProviderRequest =
  HumanProviderAdapter["validateProviderRequest"];

export interface HumanProviderAdapterDefinition {
  readonly providerId: string;
  readonly methods: readonly HumanMethodDescriptor[];
  readonly validateProviderRequest: ProviderAdapterValidateProviderRequest;
  readonly verify: ProviderAdapterVerify;
}

export type ProviderAdapterConformanceIssueCode =
  | "ADAPTER_INVALID"
  | "METHOD_PROVIDER_MISMATCH"
  | "NO_METHODS"
  | "PROVIDER_ID_INVALID";

export interface ProviderAdapterConformanceIssue {
  readonly code: ProviderAdapterConformanceIssueCode;
  readonly detail: string;
}

export interface ProviderAdapterConformanceReport {
  readonly conformant: boolean;
  readonly providerId: string;
  readonly methods: readonly string[];
  readonly issues: readonly ProviderAdapterConformanceIssue[];
}

/**
 * Validate and freeze one immutable provider method descriptor.
 */
export function defineHumanMethodDescriptor(
  descriptor: HumanMethodDescriptor,
): HumanMethodDescriptor {
  if (!isHumanMethodIdentifier(descriptor.providerId)) {
    throw new Error(
      "Human method providerId must use lowercase protocol identifier syntax",
    );
  }
  if (!isHumanMethodIdentifier(descriptor.methodId)) {
    throw new Error(
      "Human method methodId must use lowercase protocol identifier syntax",
    );
  }
  const catalog = defineMethodCatalog([descriptor]);
  return catalog.get(`${descriptor.providerId}:${descriptor.methodId}`)!;
}

/**
 * Inspect the static contract every provider adapter must satisfy before it is
 * installed in a verifier. This does not replace provider-specific security
 * review or live proof fixtures.
 */
export function inspectHumanProviderAdapter(
  adapter: HumanProviderAdapter,
): ProviderAdapterConformanceReport {
  const issues: ProviderAdapterConformanceIssue[] = [];
  let methods: readonly HumanMethodDescriptor[] = [];

  if (!isHumanMethodIdentifier(adapter.providerId)) {
    issues.push({
      code: "PROVIDER_ID_INVALID",
      detail:
        "Adapter providerId must use lowercase protocol identifier syntax",
    });
  }
  if (typeof adapter.validateProviderRequest !== "function") {
    issues.push({
      code: "ADAPTER_INVALID",
      detail: "Adapter must validate provider request material",
    });
  }

  try {
    methods = adapter.methods();
    if (methods.length === 0) {
      issues.push({
        code: "NO_METHODS",
        detail: "Adapter must expose at least one method descriptor",
      });
    }
    for (const descriptor of methods) {
      if (descriptor.providerId !== adapter.providerId) {
        issues.push({
          code: "METHOD_PROVIDER_MISMATCH",
          detail: `Method ${descriptor.providerId}:${descriptor.methodId} does not belong to adapter ${adapter.providerId}`,
        });
      }
    }
    defineMethodCatalog(methods);
  } catch (error) {
    issues.push({
      code: "ADAPTER_INVALID",
      detail:
        error instanceof Error ? error.message : "Adapter validation failed",
    });
  }

  return Object.freeze({
    conformant: issues.length === 0,
    providerId: adapter.providerId,
    methods: Object.freeze(
      methods.map(
        ({ providerId, methodId, version }) =>
          `${providerId}:${methodId}@${version}`,
      ),
    ),
    issues: Object.freeze(issues),
  });
}

export function assertHumanProviderAdapterConformance(
  adapter: HumanProviderAdapter,
): void {
  const report = inspectHumanProviderAdapter(adapter);
  if (!report.conformant) {
    throw new Error(
      `Non-conforming provider adapter ${adapter.providerId}: ${report.issues
        .map(({ code, detail }) => `${code}: ${detail}`)
        .join("; ")}`,
    );
  }
}

/**
 * Create a provider adapter from plain functions. Provider-native proof data
 * remains opaque to x424 core and is passed only to this boundary.
 */
export function defineHumanProviderAdapter(
  definition: HumanProviderAdapterDefinition,
): HumanProviderAdapter {
  const methods = Object.freeze(
    definition.methods.map(defineHumanMethodDescriptor),
  );
  const adapter: HumanProviderAdapter = Object.freeze({
    providerId: definition.providerId,
    methods: () => methods,
    validateProviderRequest: async (
      input: Parameters<ProviderAdapterValidateProviderRequest>[0],
    ): Promise<void> => definition.validateProviderRequest(input),
    verify: async (
      input: Parameters<ProviderAdapterVerify>[0],
    ): Promise<ProviderVerifiedHuman> => definition.verify(input),
  });
  assertHumanProviderAdapterConformance(adapter);
  return adapter;
}
