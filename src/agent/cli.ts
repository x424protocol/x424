#!/usr/bin/env node
import { spawn } from "node:child_process";
import { readFile } from "node:fs/promises";
import { isAbsolute } from "node:path";
import { pathToFileURL } from "node:url";
import {
  createNdjsonHandoffPresenter,
  createTerminalHandoffPresenter,
  createX424AgentClient,
  type AgentRequestSigner,
  type AgentSignatureAlgorithm,
} from "../agent.js";
import { decodeStrictBase64Url, encodeStrictBase64Url } from "../encoding.js";
import { ManagedVerifierClient } from "../managed.js";

export interface CliOptions {
  readonly url: string;
  readonly verifier: string;
  readonly signerCommand: string;
  readonly method: string;
  readonly headers: readonly [string, string][];
  readonly bodyFile?: string;
  readonly json: boolean;
}

const USAGE =
  "Usage: x424-agent <url> --verifier <url> --signer-command </absolute/path> [--method POST] [--header 'name:value'] [--body-file file] [--json]";

export class CliUsageError extends Error {
  constructor() {
    super(USAGE);
    this.name = "CliUsageError";
  }
}

function usage(): never {
  throw new CliUsageError();
}

export function parseArguments(argv: readonly string[]): CliOptions {
  const url = argv[0];
  if (!url || url.startsWith("-")) usage();
  let verifier: string | undefined;
  let signerCommand: string | undefined;
  let method = "GET";
  let bodyFile: string | undefined;
  let json = false;
  const headers: [string, string][] = [];
  for (let index = 1; index < argv.length; index += 1) {
    const argument = argv[index];
    const value = argv[index + 1];
    if (argument === "--json") {
      json = true;
    } else if (argument === "--verifier" && value) {
      verifier = value;
      index += 1;
    } else if (argument === "--signer-command" && value) {
      signerCommand = value;
      index += 1;
    } else if (argument === "--method" && value) {
      method = value.toUpperCase();
      index += 1;
    } else if (argument === "--body-file" && value) {
      bodyFile = value;
      index += 1;
    } else if (argument === "--header" && value) {
      const separator = value.indexOf(":");
      if (separator < 1) usage();
      headers.push([
        value.slice(0, separator).trim(),
        value.slice(separator + 1).trim(),
      ]);
      index += 1;
    } else {
      usage();
    }
  }
  if (!verifier || !signerCommand || !isAbsolute(signerCommand)) usage();
  return {
    url,
    verifier,
    signerCommand,
    method,
    headers,
    ...(bodyFile ? { bodyFile } : {}),
    json,
  };
}

async function signerRequest(
  command: string,
  request: unknown,
): Promise<Record<string, unknown>> {
  return new Promise((resolve, reject) => {
    const child = spawn(command, [], {
      shell: false,
      stdio: ["pipe", "pipe", "pipe"],
      env: { PATH: process.env.PATH ?? "" },
    });
    const timeout = setTimeout(() => {
      child.kill("SIGTERM");
      reject(new Error("Signer command timed out"));
    }, 30_000);
    let stdout = "";
    let stderr = "";
    child.stdout.setEncoding("utf8");
    child.stderr.setEncoding("utf8");
    child.stdout.on("data", (chunk: string) => {
      stdout += chunk;
      if (stdout.length > 65_536) child.kill("SIGTERM");
    });
    child.stderr.on("data", (chunk: string) => {
      stderr += chunk;
      if (stderr.length > 4_096) child.kill("SIGTERM");
    });
    child.on("error", reject);
    child.on("close", (code) => {
      clearTimeout(timeout);
      if (code !== 0) {
        reject(new Error(`Signer command failed (${code}): ${stderr.trim()}`));
        return;
      }
      try {
        const value = JSON.parse(stdout) as unknown;
        if (typeof value !== "object" || value === null) throw new Error();
        resolve(value as Record<string, unknown>);
      } catch {
        reject(new Error("Signer command returned invalid JSON"));
      }
    });
    child.stdin.end(`${JSON.stringify(request)}\n`);
  });
}

export async function createCommandSigner(
  command: string,
): Promise<AgentRequestSigner> {
  const metadata = await signerRequest(command, { operation: "metadata" });
  const keyId = metadata.keyId;
  const algorithm = metadata.algorithm;
  if (
    typeof keyId !== "string" ||
    (algorithm !== "ed25519" &&
      algorithm !== "eip191" &&
      algorithm !== "erc1271")
  ) {
    throw new Error("Signer metadata is invalid");
  }
  return Object.freeze({
    keyId,
    algorithm: algorithm as AgentSignatureAlgorithm,
    async sign(signatureBase: Uint8Array) {
      const response = await signerRequest(command, {
        operation: "sign",
        signatureBase: encodeStrictBase64Url(signatureBase),
      });
      if (typeof response.signature !== "string") {
        throw new Error("Signer response omitted signature");
      }
      return decodeStrictBase64Url(response.signature, "signer signature");
    },
  });
}

export function exitFor(error: unknown): number {
  if (error instanceof CliUsageError) return 2;
  const message = error instanceof Error ? error.message : String(error);
  if (/cancel|expired/iu.test(message)) return 3;
  if (/provider|human handoff|verification/iu.test(message)) return 4;
  if (/signer|signature|key/iu.test(message)) return 5;
  return 6;
}

async function main(): Promise<void> {
  const options = parseArguments(process.argv.slice(2));
  const signer = await createCommandSigner(options.signerCommand);
  const headers = new Headers([...options.headers]);
  const body = options.bodyFile ? await readFile(options.bodyFile) : undefined;
  const verifier = new ManagedVerifierClient({
    baseUrl: options.verifier,
    allowHttpLocalhost: true,
  });
  const client = createX424AgentClient({
    signer,
    handoffClient: verifier,
    presenter: options.json
      ? createNdjsonHandoffPresenter()
      : createTerminalHandoffPresenter(),
  });
  const response = await client.fetch(options.url, {
    method: options.method,
    headers,
    ...(body ? { body } : {}),
  });
  const responseBody = await response.text();
  if (options.json) {
    process.stdout.write(
      `${JSON.stringify({ type: "response", status: response.status, body: responseBody })}\n`,
    );
  } else {
    process.stdout.write(responseBody);
    if (responseBody && !responseBody.endsWith("\n"))
      process.stdout.write("\n");
  }
}

if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(process.argv[1]).href
) {
  main().catch((error: unknown) => {
    const message = error instanceof Error ? error.message : String(error);
    process.stderr.write(`${message}\n`);
    process.exit(exitFor(error));
  });
}
