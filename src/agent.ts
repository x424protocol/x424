import {
  createHash,
  createPublicKey,
  KeyObject,
  randomBytes,
  sign as nodeSign,
  verify as nodeVerify,
  type KeyLike,
} from "node:crypto";
import {
  hashMessage,
  isAddress,
  toHex,
  verifyMessage,
  type Address,
  type Hex,
} from "viem";
import { HUMAN_PROOF_HEADER } from "./http.js";
import { HUMAN_REQUIRED_HEADER, requirementFromChallenge } from "./http.js";
import { encodeStrictBase64Url } from "./encoding.js";
import {
  assertChallengeRequestMatch,
  isCrossOriginRedirect,
} from "./transport.js";
import type { HumanBinding, HumanRequirement } from "./types.js";
import type {
  HumanHandoffEvent,
  HumanHandoffPresenter,
  HumanHandoffView,
  StartedHumanHandoff,
} from "./handoff.js";
import type { PaymentDependencyResolver } from "./x402.js";
import QRCode from "qrcode";

export const X424_AGENT_SIGNATURE_LABEL = "x424-agent" as const;
export type AgentSignatureAlgorithm = "ed25519" | "eip191" | "erc1271";

export interface AgentRequestSigner {
  readonly keyId: string;
  readonly algorithm: AgentSignatureAlgorithm;
  sign(signatureBase: Uint8Array): Promise<Uint8Array> | Uint8Array;
}

export interface ResolvedAgentKey {
  readonly keyId: string;
  readonly algorithm: AgentSignatureAlgorithm;
  verify(
    signatureBase: Uint8Array,
    signature: Uint8Array,
  ): Promise<boolean> | boolean;
}

export type AgentKeyResolver = (input: {
  readonly keyId: string;
  readonly algorithm: AgentSignatureAlgorithm;
  readonly request: Request;
}) => Promise<ResolvedAgentKey | undefined> | ResolvedAgentKey | undefined;

interface AgentSignatureParameters {
  readonly components: readonly string[];
  readonly created: number;
  readonly expires: number;
  readonly keyId: string;
  readonly algorithm: AgentSignatureAlgorithm;
  readonly nonce: string;
  readonly serialized: string;
}

function quoted(value: string): string {
  if (/[^\u0020-\u007e]/u.test(value) || /[\r\n]/u.test(value)) {
    throw new Error("HTTP signature parameter contains unsafe characters");
  }
  return `"${value.replace(/(["\\])/gu, "\\$1")}"`;
}

function contentDigest(bytes: Uint8Array): string {
  return `sha-256=:${createHash("sha256").update(bytes).digest("base64")}:`;
}

async function requestContent(request: Request): Promise<Uint8Array> {
  if (request.body === null) return new Uint8Array();
  return new Uint8Array(await request.clone().arrayBuffer());
}

function componentValue(request: Request, component: string): string {
  if (component === "@method") return request.method.toLowerCase();
  if (component === "@target-uri") return request.url;
  const value = request.headers.get(component);
  if (value === null)
    throw new Error(`Signed component is missing: ${component}`);
  if (/\r|\n/u.test(value)) throw new Error("Signed header contains a newline");
  return value.trim();
}

function signatureBase(
  request: Request,
  parameters: AgentSignatureParameters,
): Uint8Array {
  const lines = parameters.components.map(
    (component) =>
      `${quoted(component)}: ${componentValue(request, component)}`,
  );
  lines.push(`"@signature-params": ${parameters.serialized}`);
  return new TextEncoder().encode(lines.join("\n"));
}

function signatureComponents(request: Request): string[] {
  const components = ["@method", "@target-uri"];
  if (request.body !== null) components.push("content-digest");
  if (request.headers.has(HUMAN_PROOF_HEADER))
    components.push(HUMAN_PROOF_HEADER);
  if (request.headers.has("payment-signature"))
    components.push("payment-signature");
  return components;
}

export async function signX424AgentRequest(
  request: Request,
  signer: AgentRequestSigner,
  options: {
    readonly nonce?: string;
    readonly now?: Date;
    readonly lifetimeSeconds?: number;
  } = {},
): Promise<Request> {
  const now = options.now ?? new Date();
  const lifetime = options.lifetimeSeconds ?? 60;
  if (!Number.isInteger(lifetime) || lifetime < 1 || lifetime > 60) {
    throw new Error(
      "Agent signature lifetime must be between 1 and 60 seconds",
    );
  }
  const headers = new Headers(request.headers);
  if (request.body !== null) {
    headers.set("content-digest", contentDigest(await requestContent(request)));
  }
  const unsigned = new Request(request.clone(), { headers });
  const components = signatureComponents(unsigned);
  const created = Math.floor(now.getTime() / 1_000);
  const expires = created + lifetime;
  const nonce = options.nonce ?? encodeStrictBase64Url(randomBytes(16));
  const serialized = `(${components.map(quoted).join(" ")});created=${created};expires=${expires};keyid=${quoted(signer.keyId)};alg=${quoted(signer.algorithm)};nonce=${quoted(nonce)};tag="x424-agent"`;
  const parameters: AgentSignatureParameters = {
    components,
    created,
    expires,
    keyId: signer.keyId,
    algorithm: signer.algorithm,
    nonce,
    serialized,
  };
  const signature = await signer.sign(signatureBase(unsigned, parameters));
  headers.set("signature-input", `${X424_AGENT_SIGNATURE_LABEL}=${serialized}`);
  headers.set(
    "signature",
    `${X424_AGENT_SIGNATURE_LABEL}=:${Buffer.from(signature).toString("base64")}:`,
  );
  return new Request(unsigned, { headers });
}

function parseParameters(request: Request): AgentSignatureParameters {
  const input = request.headers.get("signature-input");
  if (!input?.startsWith(`${X424_AGENT_SIGNATURE_LABEL}=`)) {
    throw new Error("Missing x424-agent Signature-Input");
  }
  const serialized = input.slice(X424_AGENT_SIGNATURE_LABEL.length + 1);
  const listEnd = serialized.indexOf(")");
  if (!serialized.startsWith("(") || listEnd < 1) {
    throw new Error("Invalid x424-agent Signature-Input");
  }
  const list = serialized.slice(1, listEnd);
  const components = [...list.matchAll(/"([^"\\]+)"/gu)].map(
    (match) => match[1]!,
  );
  if (!components.length || components.map(quoted).join(" ") !== list) {
    throw new Error("Invalid x424-agent component list");
  }
  const params = serialized.slice(listEnd + 1);
  const integer = (name: string): number => {
    const match = params.match(
      new RegExp(`(?:^|;)${name}=([0-9]+)(?:;|$)`, "u"),
    );
    if (!match) throw new Error(`Missing agent signature parameter: ${name}`);
    return Number(match[1]);
  };
  const string = (name: string): string => {
    const match = params.match(
      new RegExp(`(?:^|;)${name}="([^"]*)"(?:;|$)`, "u"),
    );
    if (!match) throw new Error(`Missing agent signature parameter: ${name}`);
    return match[1]!;
  };
  const algorithm = string("alg");
  if (
    algorithm !== "ed25519" &&
    algorithm !== "eip191" &&
    algorithm !== "erc1271"
  ) {
    throw new Error("Unsupported agent signature algorithm");
  }
  if (string("tag") !== "x424-agent") throw new Error("Invalid signature tag");
  return {
    components,
    created: integer("created"),
    expires: integer("expires"),
    keyId: string("keyid"),
    algorithm,
    nonce: string("nonce"),
    serialized,
  };
}

function parseSignature(request: Request): Uint8Array {
  const value = request.headers.get("signature");
  const match = value?.match(/^x424-agent=:([A-Za-z0-9+/]+={0,2}):$/u);
  if (!match) throw new Error("Missing or invalid x424-agent Signature");
  return new Uint8Array(Buffer.from(match[1]!, "base64"));
}

export async function verifyX424AgentRequest(
  request: Request,
  options: {
    readonly resolveKey: AgentKeyResolver;
    readonly expectedNonce?: string;
    readonly now?: Date;
    readonly clockSkewSeconds?: number;
  },
): Promise<HumanBinding> {
  const parameters = parseParameters(request);
  const now = Math.floor((options.now ?? new Date()).getTime() / 1_000);
  const skew = options.clockSkewSeconds ?? 5;
  if (
    parameters.created > now + skew ||
    parameters.expires < now - skew ||
    parameters.expires <= parameters.created ||
    parameters.expires - parameters.created > 60
  ) {
    throw new Error("Agent signature time window is invalid");
  }
  if (
    options.expectedNonce !== undefined &&
    parameters.nonce !== options.expectedNonce
  ) {
    throw new Error("Agent signature nonce does not match the dependency");
  }
  const requiredComponents = signatureComponents(request);
  if (
    parameters.components.length !== requiredComponents.length ||
    parameters.components.some(
      (value, index) => value !== requiredComponents[index],
    )
  ) {
    throw new Error("Agent signature does not cover the required components");
  }
  if (request.body !== null) {
    const expected = contentDigest(await requestContent(request));
    if (request.headers.get("content-digest") !== expected) {
      throw new Error("Agent request Content-Digest is invalid");
    }
  }
  const key = await options.resolveKey({
    keyId: parameters.keyId,
    algorithm: parameters.algorithm,
    request,
  });
  if (
    !key ||
    key.keyId !== parameters.keyId ||
    key.algorithm !== parameters.algorithm ||
    !(await key.verify(
      signatureBase(request, parameters),
      parseSignature(request),
    ))
  ) {
    throw new Error("Agent request signature is invalid");
  }
  return { kind: "agent_key", value: parameters.keyId };
}

function jwkThumbprintUri(publicKey: KeyLike): string {
  const key =
    publicKey instanceof KeyObject && publicKey.type === "public"
      ? publicKey
      : createPublicKey(publicKey);
  const jwk = key.export({ format: "jwk" });
  if (jwk.kty !== "OKP" || jwk.crv !== "Ed25519" || !jwk.x) {
    throw new Error("Agent Ed25519 key must export as an OKP JWK");
  }
  const digest = createHash("sha256")
    .update(canonicalJwk({ crv: jwk.crv, kty: jwk.kty, x: jwk.x }))
    .digest();
  return `urn:ietf:params:oauth:jwk-thumbprint:sha-256:${encodeStrictBase64Url(digest)}`;
}

function canonicalJwk(value: { crv: string; kty: string; x: string }): string {
  return JSON.stringify({ crv: value.crv, kty: value.kty, x: value.x });
}

export function createEd25519AgentRequestSigner(
  privateKey: KeyLike,
): AgentRequestSigner {
  return Object.freeze({
    keyId: jwkThumbprintUri(privateKey),
    algorithm: "ed25519" as const,
    sign: (base: Uint8Array) =>
      new Uint8Array(nodeSign(null, base, privateKey)),
  });
}

export function createEd25519AgentKeyResolver(
  keys: ReadonlyMap<string, KeyLike>,
): AgentKeyResolver {
  return ({ keyId, algorithm }) => {
    if (algorithm !== "ed25519") return undefined;
    const key = keys.get(keyId);
    if (!key || jwkThumbprintUri(key) !== keyId) return undefined;
    return {
      keyId,
      algorithm,
      verify: (base, signature) => nodeVerify(null, base, key, signature),
    };
  };
}

export interface EvmAgentMessageSigner {
  readonly accountId: string;
  readonly contractWallet?: boolean;
  signMessage(input: { readonly message: { readonly raw: Hex } }): Promise<Hex>;
}

export function createEvmAgentRequestSigner(
  signer: EvmAgentMessageSigner,
): AgentRequestSigner {
  parseCaip10(signer.accountId);
  return Object.freeze({
    keyId: signer.accountId,
    algorithm: signer.contractWallet
      ? ("erc1271" as const)
      : ("eip191" as const),
    sign: async (base: Uint8Array) =>
      new Uint8Array(
        Buffer.from(
          (await signer.signMessage({ message: { raw: toHex(base) } })).slice(
            2,
          ),
          "hex",
        ),
      ),
  });
}

export interface Erc1271PublicClient {
  readContract(input: {
    readonly address: Address;
    readonly abi: readonly unknown[];
    readonly functionName: "isValidSignature";
    readonly args: readonly [Hex, Hex];
  }): Promise<unknown>;
}

const ERC1271_ABI = [
  {
    type: "function",
    name: "isValidSignature",
    stateMutability: "view",
    inputs: [
      { name: "hash", type: "bytes32" },
      { name: "signature", type: "bytes" },
    ],
    outputs: [{ name: "magicValue", type: "bytes4" }],
  },
] as const;

export function createEvmAgentKeyResolver(
  options: {
    readonly erc1271Clients?: ReadonlyMap<string, Erc1271PublicClient>;
  } = {},
): AgentKeyResolver {
  return ({ keyId, algorithm }) => {
    if (algorithm !== "eip191" && algorithm !== "erc1271") return undefined;
    const account = parseCaip10(keyId);
    if (algorithm === "eip191") {
      return {
        keyId,
        algorithm,
        verify: async (base, signature) =>
          verifyMessage({
            address: account.address,
            message: { raw: toHex(base) },
            signature: toHex(signature),
          }),
      };
    }
    const client = options.erc1271Clients?.get(account.chainId);
    if (!client) return undefined;
    return {
      keyId,
      algorithm,
      verify: async (base, signature) => {
        const result = await client.readContract({
          address: account.address,
          abi: ERC1271_ABI,
          functionName: "isValidSignature",
          args: [hashMessage({ raw: toHex(base) }), toHex(signature)],
        });
        return String(result).toLowerCase() === "0x1626ba7e";
      },
    };
  };
}

function parseCaip10(value: string): { chainId: string; address: Address } {
  const match = value.match(/^eip155:([0-9]+):(0x[0-9a-fA-F]{40})$/u);
  if (!match || !isAddress(match[2]!))
    throw new Error("Invalid EVM CAIP-10 key ID");
  return { chainId: match[1]!, address: match[2]! as Address };
}

export interface AgentHandoffClient {
  startHandoff(input: {
    readonly dependencyId: string;
    readonly nonce: string;
    readonly providerId: string;
    readonly methodId: string;
  }): Promise<StartedHumanHandoff>;
  getHandoff(handoffId: string, accessToken: string): Promise<HumanHandoffView>;
  cancelHandoff(handoffId: string, accessToken: string): Promise<void>;
}

export interface X424AgentClientOptions {
  readonly signer: AgentRequestSigner;
  readonly handoffClient: AgentHandoffClient;
  readonly presenter?: HumanHandoffPresenter;
  readonly fetchImplementation?: typeof fetch;
  readonly selectMethod?: (requirement: HumanRequirement) => {
    readonly providerId: string;
    readonly methodId: string;
  };
  readonly resolvePaymentDependency?: PaymentDependencyResolver;
  readonly bodyFactory?: (
    attempt: 1 | 2 | 3,
  ) => BodyInit | null | Promise<BodyInit | null>;
  readonly signal?: AbortSignal;
}

export interface X424AgentClient {
  fetch(input: string | URL | Request, init?: RequestInit): Promise<Response>;
}

export function createX424AgentClient(
  options: X424AgentClientOptions,
): X424AgentClient {
  return Object.freeze({
    fetch: (input: string | URL | Request, init?: RequestInit) =>
      fetchWithAgentDependencies(input, init, options),
  });
}

async function fetchWithAgentDependencies(
  input: string | URL | Request,
  init: RequestInit | undefined,
  options: X424AgentClientOptions,
): Promise<Response> {
  const fetchImplementation = options.fetchImplementation ?? fetch;
  const requests = await agentRequestCopies(input, init, options.bodyFactory);
  const seedHeaders = new Headers(requests[0].headers);
  if (
    !["GET", "HEAD", "OPTIONS"].includes(requests[0].method) &&
    !seedHeaders.has("idempotency-key")
  ) {
    seedHeaders.set("idempotency-key", randomUUIDLike());
    for (let index = 0; index < requests.length; index += 1) {
      requests[index] = new Request(requests[index]!, { headers: seedHeaders });
    }
  }
  let current = await signX424AgentRequest(requests[0], options.signer);
  let response = await fetchImplementation(current);
  assertAgentNoRedirect(current, response);
  if (response.status !== 424) return response;
  if (current.headers.has(HUMAN_PROOF_HEADER)) return response;
  const requirement = await agentRequirementFromResponse(current, response);
  if (!requirement) return response;
  const selected =
    options.selectMethod?.(requirement) ?? requirement.accepts[0];
  if (!selected) throw new Error("x424 challenge has no accepted human method");
  const started = await options.handoffClient.startHandoff({
    dependencyId: requirement.dependencyId,
    nonce: requirement.nonce,
    providerId: selected.providerId,
    methodId: selected.methodId,
  });
  await options.presenter?.present({
    type: "human_action_required",
    handoffId: started.handoffId,
    providerId: started.providerId,
    methodId: started.methodId,
    presentation: started.presentation,
    expiresAt: started.expiresAt,
  });
  let view: HumanHandoffView;
  try {
    view = await waitForHandoff(started, options);
  } catch (error) {
    await options.handoffClient
      .cancelHandoff(started.handoffId, started.accessToken)
      .catch(() => undefined);
    throw error;
  }
  if (view.status !== "completed") {
    throw new Error(`Human handoff ended with ${view.status}`);
  }
  const secondHeaders = new Headers(requests[1].headers);
  secondHeaders.set(HUMAN_PROOF_HEADER, view.humanProof);
  current = await signX424AgentRequest(
    new Request(requests[1], { headers: secondHeaders }),
    options.signer,
    { nonce: requirement.dependencyId },
  );
  response = await fetchImplementation(current);
  assertAgentNoRedirect(current, response);
  if (response.status !== 402 || !options.resolvePaymentDependency)
    return response;
  const payment = await options.resolvePaymentDependency({
    response,
    request: current,
  });
  const finalHeaders = new Headers(requests[2].headers);
  finalHeaders.set(HUMAN_PROOF_HEADER, view.humanProof);
  finalHeaders.set("payment-signature", payment.paymentSignature);
  const finalRequest = await signX424AgentRequest(
    new Request(requests[2], { headers: finalHeaders }),
    options.signer,
    { nonce: requirement.dependencyId },
  );
  const finalResponse = await fetchImplementation(finalRequest);
  assertAgentNoRedirect(finalRequest, finalResponse);
  await payment.processResponse?.(finalResponse);
  return finalResponse;
}

async function waitForHandoff(
  started: StartedHumanHandoff,
  options: X424AgentClientOptions,
): Promise<HumanHandoffView> {
  for (;;) {
    if (options.signal?.aborted) {
      await options.presenter?.present({
        type: "cancelled",
        handoffId: started.handoffId,
      });
      throw new Error("Human handoff was cancelled");
    }
    const view = await options.handoffClient.getHandoff(
      started.handoffId,
      started.accessToken,
    );
    if (view.status === "pending") {
      await options.presenter?.present({
        type: "waiting",
        handoffId: started.handoffId,
      });
      await delay(
        Math.max(500, Math.min(10_000, view.pollAfterMs)),
        options.signal,
      );
      continue;
    }
    const event: HumanHandoffEvent =
      view.status === "completed"
        ? { type: "completed", handoffId: started.handoffId }
        : view.status === "failed"
          ? { type: "failed", handoffId: started.handoffId, code: view.code }
          : { type: view.status, handoffId: started.handoffId };
    await options.presenter?.present(event);
    return view;
  }
}

async function agentRequestCopies(
  input: string | URL | Request,
  init: RequestInit | undefined,
  bodyFactory: X424AgentClientOptions["bodyFactory"],
): Promise<[Request, Request, Request]> {
  const seed = new Request(input, init);
  if (!bodyFactory) {
    try {
      return [seed.clone(), seed.clone(), seed.clone()];
    } catch {
      throw new Error(
        "Agent request body is not replayable; supply bodyFactory",
      );
    }
  }
  const build = async (attempt: 1 | 2 | 3): Promise<Request> =>
    new Request(seed.url, {
      method: seed.method,
      headers: seed.headers,
      body: await bodyFactory(attempt),
      credentials: seed.credentials,
      redirect: "manual",
      signal: seed.signal,
    });
  return [await build(1), await build(2), await build(3)];
}

async function agentRequirementFromResponse(
  request: Request,
  response: Response,
): Promise<HumanRequirement | undefined> {
  const header = response.headers.get(HUMAN_REQUIRED_HEADER);
  let body: unknown = null;
  try {
    body = await response.clone().json();
  } catch {
    if (!header) return undefined;
  }
  try {
    const requirement = requirementFromChallenge({
      headers: response.headers,
      body,
    });
    assertChallengeRequestMatch({
      requestMethod: request.method,
      requestUrl: request.url,
      challengeUrl: response.url || request.url,
      resourceMethod: requirement.resource.method,
      resourceUri: requirement.resource.uri,
    });
    return requirement;
  } catch {
    return undefined;
  }
}

function assertAgentNoRedirect(request: Request, response: Response): void {
  if (
    response.type === "opaqueredirect" ||
    [301, 302, 303, 307, 308].includes(response.status) ||
    isCrossOriginRedirect(request.url, response.headers.get("location"))
  ) {
    throw new Error("x424 agent client refuses redirects");
  }
}

function randomUUIDLike(): string {
  return `x424-operation-${encodeStrictBase64Url(randomBytes(18))}`;
}

function delay(ms: number, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(resolve, ms);
    signal?.addEventListener(
      "abort",
      () => {
        clearTimeout(timer);
        reject(new Error("Human handoff was cancelled"));
      },
      { once: true },
    );
  });
}

export function createCallbackHandoffPresenter(
  callback: (event: HumanHandoffEvent) => void | Promise<void>,
): HumanHandoffPresenter {
  return Object.freeze({ present: callback });
}

export function createNdjsonHandoffPresenter(
  output: { write(value: string): unknown } = process.stdout,
): HumanHandoffPresenter {
  return Object.freeze({
    present(event: HumanHandoffEvent) {
      output.write(`${JSON.stringify(event)}\n`);
    },
  });
}

export function createTerminalHandoffPresenter(
  output: { write(value: string): unknown } = process.stderr,
): HumanHandoffPresenter {
  return Object.freeze({
    async present(event: HumanHandoffEvent) {
      if (event.type === "human_action_required") {
        output.write(`Human action required\n${event.presentation.uri}\n`);
        output.write(
          await QRCode.toString(event.presentation.uri, {
            type: "terminal",
            small: true,
            errorCorrectionLevel: "M",
          }),
        );
        output.write(`Expires: ${event.expiresAt}\n`);
      } else if (event.type === "waiting") {
        output.write("Waiting for human verification…\n");
      } else if (event.type === "completed") {
        output.write("Human dependency satisfied.\n");
      } else if (event.type === "failed") {
        output.write(`Human verification failed (${event.code}).\n`);
      } else {
        output.write(`Human handoff ${event.type}.\n`);
      }
    },
  });
}
