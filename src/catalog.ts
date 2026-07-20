import type { HumanMethodDescriptor } from "./types.js";

export const HUMAN_METHOD_IDENTIFIER_PATTERN = /^[a-z0-9][a-z0-9._-]{0,99}$/;

export const isHumanMethodIdentifier = (value: string): boolean =>
  HUMAN_METHOD_IDENTIFIER_PATTERN.test(value);

export const methodKey = (providerId: string, methodId: string): string =>
  `${providerId}:${methodId}`;

export function defineMethodCatalog(
  descriptors: readonly HumanMethodDescriptor[],
): ReadonlyMap<string, HumanMethodDescriptor> {
  const catalog = new Map<string, HumanMethodDescriptor>();

  for (const descriptor of descriptors) {
    const key = methodKey(descriptor.providerId, descriptor.methodId);
    if (catalog.has(key)) throw new Error(`Duplicate human method: ${key}`);
    if (
      !isHumanMethodIdentifier(descriptor.providerId) ||
      !isHumanMethodIdentifier(descriptor.methodId) ||
      !descriptor.version
    ) {
      throw new Error(`Human method identifiers are invalid: ${key}`);
    }
    if (!descriptor.claim || descriptor.nonClaims.length === 0) {
      throw new Error(`Human method must declare claim and non-claims: ${key}`);
    }
    if (
      descriptor.nativeScopeKinds.length === 0 ||
      descriptor.verificationModes.length === 0
    ) {
      throw new Error(`Human method must declare scope and execution: ${key}`);
    }
    catalog.set(
      key,
      Object.freeze({
        ...descriptor,
        nonClaims: Object.freeze([...descriptor.nonClaims]),
        assuranceLevels: Object.freeze([...descriptor.assuranceLevels]),
        nativeScopeKinds: Object.freeze([...descriptor.nativeScopeKinds]),
        verificationModes: Object.freeze([...descriptor.verificationModes]),
      }),
    );
  }

  return catalog;
}
