#!/usr/bin/env node
import { WebStandardStreamableHTTPServerTransport } from "@modelcontextprotocol/server";
import { StdioServerTransport } from "@modelcontextprotocol/server/stdio";
import {
  createServer,
  type IncomingMessage,
  type ServerResponse,
} from "node:http";
import { createX424McpServer } from "./server.js";

const MAX_MCP_BODY_BYTES = 1024 * 1024;

async function readBody(request: IncomingMessage): Promise<string> {
  const chunks: Buffer[] = [];
  let total = 0;
  for await (const rawChunk of request) {
    const chunk = Buffer.isBuffer(rawChunk) ? rawChunk : Buffer.from(rawChunk);
    total += chunk.byteLength;
    if (total > MAX_MCP_BODY_BYTES) {
      throw new Error("MCP request body exceeds 1 MiB");
    }
    chunks.push(chunk);
  }
  return Buffer.concat(chunks).toString("utf8");
}

function copyHeaders(request: IncomingMessage): Headers {
  const headers = new Headers();
  for (const [name, value] of Object.entries(request.headers)) {
    if (Array.isArray(value)) {
      for (const item of value) headers.append(name, item);
    } else if (value !== undefined) {
      headers.set(name, value);
    }
  }
  return headers;
}

function isLoopbackHostname(hostname: string): boolean {
  return hostname === "127.0.0.1" || hostname === "localhost";
}

function hasAllowedBrowserContext(request: IncomingMessage): boolean {
  const host = request.headers.host;
  if (host === undefined) return false;
  try {
    if (!isLoopbackHostname(new URL(`http://${host}`).hostname)) return false;
    const origin = request.headers.origin;
    return origin === undefined || isLoopbackHostname(new URL(origin).hostname);
  } catch {
    return false;
  }
}

async function writeResponse(
  response: Response,
  target: ServerResponse,
): Promise<void> {
  const headers: Record<string, string> = {};
  response.headers.forEach((value, name) => {
    headers[name] = value;
  });
  target.writeHead(response.status, headers);
  target.end(Buffer.from(await response.arrayBuffer()));
}

async function runStdio(): Promise<void> {
  const server = createX424McpServer();
  await server.connect(new StdioServerTransport());
  console.error("x424 MCP server listening on stdio");
}

async function runHttp(): Promise<void> {
  const rawPort = process.env.X424_MCP_PORT ?? "4240";
  const port = Number(rawPort);
  if (!Number.isInteger(port) || port < 1 || port > 65_535) {
    throw new Error("X424_MCP_PORT must be a valid TCP port");
  }
  const httpServer = createServer(async (request, response) => {
    if (!hasAllowedBrowserContext(request)) {
      response.writeHead(403, { "content-type": "application/json" });
      response.end(
        JSON.stringify({
          jsonrpc: "2.0",
          error: { code: -32000, message: "Forbidden host or origin" },
          id: null,
        }),
      );
      return;
    }
    if (request.method !== "POST" || request.url !== "/mcp") {
      response.writeHead(405, { "content-type": "application/json" });
      response.end(
        JSON.stringify({
          jsonrpc: "2.0",
          error: { code: -32000, message: "Use POST /mcp" },
          id: null,
        }),
      );
      return;
    }
    const server = createX424McpServer();
    const transport = new WebStandardStreamableHTTPServerTransport({
      enableJsonResponse: true,
    });
    response.on("close", () => {
      void transport.close();
      void server.close();
    });
    try {
      await server.connect(transport);
      const body = await readBody(request);
      const webRequest = new Request(
        `http://127.0.0.1:${String(port)}${request.url}`,
        {
          method: "POST",
          headers: copyHeaders(request),
          body,
        },
      );
      await writeResponse(await transport.handleRequest(webRequest), response);
    } catch (error) {
      console.error("x424 MCP request failed", error);
      if (!response.headersSent) {
        response.writeHead(500, { "content-type": "application/json" });
        response.end(
          JSON.stringify({
            jsonrpc: "2.0",
            error: { code: -32603, message: "Internal MCP error" },
            id: null,
          }),
        );
      }
    }
  });
  httpServer.listen(port, "127.0.0.1", () => {
    console.error(`x424 MCP server listening on http://127.0.0.1:${port}/mcp`);
  });
}

const transport = process.env.X424_MCP_TRANSPORT ?? "stdio";
(transport === "http" ? runHttp() : runStdio()).catch((error: unknown) => {
  console.error(error);
  process.exitCode = 1;
});
