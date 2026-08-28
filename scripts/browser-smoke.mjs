/**
 * Release gate for the documented browser entrypoints.
 *
 * Bundles the built package for a browser without externals or polyfills, then
 * evaluates both bundles in a browser-like VM that deliberately omits Node's
 * process, Buffer, require, and crypto modules.
 */
import vm from "node:vm";
import { build } from "esbuild";

const root = process.cwd();
const forbiddenInput =
  /(?:^|\/)node_modules\/(?:buffer|crypto-browserify|process|stream-browserify|util)\/|(?:^|\/)node:/u;
const forbiddenOutput =
  /\bBuffer(?:\.|\[|\()|\bprocess\.(?:browser|cwd|env|nextTick|versions)\b|node:[a-z0-9_/.-]+/u;

async function bundle(packageExport, globalName) {
  const result = await build({
    stdin: {
      contents: `export * from ${JSON.stringify(packageExport)};`,
      resolveDir: root,
      sourcefile: `${packageExport}.browser-entry.js`,
    },
    bundle: true,
    conditions: ["browser", "import", "default"],
    format: "iife",
    globalName,
    legalComments: "none",
    metafile: true,
    platform: "browser",
    target: ["es2022"],
    treeShaking: true,
    write: false,
  });
  const inputs = Object.keys(result.metafile.inputs);
  const forbidden = inputs.find((input) => forbiddenInput.test(input));
  if (forbidden) {
    throw new Error(`${packageExport} pulled a Node polyfill: ${forbidden}`);
  }
  const output = result.outputFiles[0]?.text;
  if (!output) throw new Error(`${packageExport} produced no browser bundle`);
  if (forbiddenOutput.test(output)) {
    throw new Error(`${packageExport} contains a Node runtime dependency`);
  }
  return output;
}

function browserContext() {
  const context = {
    AbortController,
    AbortSignal,
    Blob,
    DOMException,
    Event,
    EventTarget,
    FormData,
    Headers,
    Request,
    Response,
    TextDecoder,
    TextEncoder,
    URL,
    URLSearchParams,
    atob,
    btoa,
    clearInterval,
    clearTimeout,
    console,
    crypto: globalThis.crypto,
    fetch,
    navigator: { userAgent: "x424-browser-smoke" },
    queueMicrotask,
    setInterval,
    setTimeout,
    structuredClone,
  };
  context.globalThis = context;
  context.self = context;
  context.window = context;
  return vm.createContext(context);
}

async function smokeClient(source) {
  const context = browserContext();
  new vm.Script(source, { filename: "x424-client.browser.js" }).runInContext(
    context,
  );
  const client = context.X424Client;
  if (
    typeof client?.fetchWithX424 !== "function" ||
    typeof client?.createHttpHumanDependencyResolver !== "function"
  ) {
    throw new Error("x424/client did not expose its documented browser API");
  }

  const requirement = {
    x424Version: "0.1",
    dependencyId: "x424_dep_browser_smoke",
    purpose: "browser-smoke",
    resource: {
      method: "POST",
      uri: "https://api.example.test/records",
      audience: "https://api.example.test",
      requestDigest: `sha256:${"A".repeat(43)}`,
    },
    nonce: "browser-smoke-nonce",
    binding: { kind: "session", value: "browser-smoke-session" },
    createdAt: "2026-07-27T00:00:00.000Z",
    expiresAt: "2026-07-27T00:05:00.000Z",
    accepts: [
      {
        providerId: "example",
        methodId: "unique-human",
        descriptorVersion: "1",
        acceptedScopeKinds: ["relying_party"],
      },
    ],
  };
  const challenge = {
    type: "https://x424.org/problems/human-required",
    title: "Unique human required",
    status: 424,
    detail: "Browser smoke challenge",
    dependencyId: requirement.dependencyId,
    x424Transport: "body",
    requirement,
  };
  const requests = [];
  const response = await client.fetchWithX424(
    requirement.resource.uri,
    { method: "POST", body: "{}" },
    {
      fetchImplementation: async (request) => {
        requests.push(request);
        if (!request.headers.has("human-proof")) {
          return new Response(JSON.stringify(challenge), {
            status: 424,
            headers: { "content-type": "application/problem+json" },
          });
        }
        return new Response("created", { status: 201 });
      },
      resolveHumanDependency: async () => ({
        humanProof: "browser-smoke-result",
      }),
    },
  );
  if (
    response.status !== 201 ||
    requests.length !== 2 ||
    requests[1]?.headers.get("human-proof") !== "browser-smoke-result"
  ) {
    throw new Error(
      "x424/client failed its browser 424 -> proof -> retry flow",
    );
  }
}

function smokeWorldClient(source) {
  const context = browserContext();
  new vm.Script(source, {
    filename: "x424-world-id-client.browser.js",
  }).runInContext(context);
  const client = context.X424WorldClient;
  if (
    typeof client?.createWorldIdProofRequest !== "function" ||
    typeof client?.createWorldIdIdKitProofResolver !== "function"
  ) {
    throw new Error(
      "x424/providers/world-id/client did not expose its documented browser API",
    );
  }
  if (typeof client.createWorldIdIdKitProofResolver() !== "function") {
    throw new Error("World IDKit browser resolver could not be constructed");
  }
}

function assertBundleBudget(label, source, maximumBytes) {
  if (source.length > maximumBytes) {
    throw new Error(
      `${label} browser bundle is ${source.length} B; budget is ${maximumBytes} B`,
    );
  }
}

const clientBundle = await bundle("x424/client", "X424Client");
const worldBundle = await bundle(
  "x424/providers/world-id/client",
  "X424WorldClient",
);
assertBundleBudget("x424/client", clientBundle, 700_000);
assertBundleBudget("x424/providers/world-id/client", worldBundle, 200_000);
await smokeClient(clientBundle);
smokeWorldClient(worldBundle);
console.log(
  `browser-smoke ok: client ${clientBundle.length} B, World ID client ${worldBundle.length} B`,
);
