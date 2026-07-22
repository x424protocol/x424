import { spawn } from "node:child_process";
import { request as httpRequest } from "node:http";
import { createServer } from "node:net";
import process from "node:process";

async function reservePort() {
  const server = createServer();
  await new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", resolve);
  });
  const address = server.address();
  if (address === null || typeof address === "string") {
    throw new Error("Could not reserve an MCP smoke-test port");
  }
  await new Promise((resolve, reject) =>
    server.close((error) => (error ? reject(error) : resolve())),
  );
  return address.port;
}

async function waitForReady(child) {
  await new Promise((resolve, reject) => {
    const timeout = setTimeout(
      () => reject(new Error("Timed out waiting for the MCP HTTP server")),
      10_000,
    );
    child.once("exit", (code) => {
      clearTimeout(timeout);
      reject(
        new Error(`MCP HTTP server exited before startup (${String(code)})`),
      );
    });
    child.stderr.on("data", (chunk) => {
      if (String(chunk).includes("x424 MCP server listening")) {
        clearTimeout(timeout);
        resolve();
      }
    });
  });
}

async function requestWithHost(port, host) {
  return await new Promise((resolve, reject) => {
    const request = httpRequest(
      {
        host: "127.0.0.1",
        port,
        path: "/mcp",
        method: "POST",
        headers: {
          host,
          accept: "application/json, text/event-stream",
          "content-type": "application/json",
        },
      },
      (response) => {
        response.resume();
        response.once("end", () => resolve(response.statusCode));
      },
    );
    request.once("error", reject);
    request.end("{}");
  });
}

const port = await reservePort();
const child = spawn(process.execPath, ["dist/mcp/cli.js"], {
  cwd: process.cwd(),
  env: {
    ...process.env,
    X424_MCP_TRANSPORT: "http",
    X424_MCP_PORT: String(port),
  },
  stdio: ["ignore", "ignore", "pipe"],
});

try {
  await waitForReady(child);
  const response = await fetch(`http://127.0.0.1:${String(port)}/mcp`, {
    method: "POST",
    headers: {
      accept: "application/json, text/event-stream",
      "content-type": "application/json",
    },
    body: JSON.stringify({
      jsonrpc: "2.0",
      id: 1,
      method: "initialize",
      params: {
        protocolVersion: "2025-11-25",
        capabilities: {},
        clientInfo: { name: "x424-http-smoke", version: "1.0.0" },
      },
    }),
  });
  if (response.status !== 200) {
    throw new Error(`MCP initialize returned HTTP ${String(response.status)}`);
  }
  const payload = await response.json();
  if (
    payload?.result?.serverInfo?.name !== "x424-mcp-server" ||
    payload?.result?.serverInfo?.version !== "0.1.1" ||
    payload?.result?.protocolVersion !== "2025-11-25"
  ) {
    throw new Error("MCP initialize returned an unexpected response");
  }
  if ((await requestWithHost(port, "attacker.example")) !== 403) {
    throw new Error("MCP HTTP server accepted an untrusted Host header");
  }
  console.log("mcp-http-smoke ok: initialize and host protection");
} finally {
  child.kill("SIGTERM");
}
