#!/usr/bin/env node
import { createMcpExpressApp } from "@modelcontextprotocol/sdk/server/express.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { createX424McpServer } from "./server.js";

async function runStdio(): Promise<void> {
  const server = createX424McpServer();
  await server.connect(new StdioServerTransport());
  console.error("x424 MCP server listening on stdio");
}

async function runHttp(): Promise<void> {
  const app = createMcpExpressApp({ host: "127.0.0.1" });
  app.post("/mcp", async (request, response) => {
    const server = createX424McpServer();
    const transport = new StreamableHTTPServerTransport({
      enableJsonResponse: true,
    });
    response.on("close", () => {
      void transport.close();
      void server.close();
    });
    try {
      // The SDK's optional callback fields are not declared with
      // exactOptionalPropertyTypes; the runtime object implements Transport.
      await server.connect(
        transport as unknown as Parameters<typeof server.connect>[0],
      );
      await transport.handleRequest(request, response, request.body);
    } catch (error) {
      console.error("x424 MCP request failed", error);
      if (!response.headersSent) {
        response.status(500).json({
          jsonrpc: "2.0",
          error: { code: -32603, message: "Internal MCP error" },
          id: null,
        });
      }
    }
  });
  app.all("/mcp", (_request, response) => {
    response.status(405).json({
      jsonrpc: "2.0",
      error: { code: -32000, message: "Use POST for stateless MCP" },
      id: null,
    });
  });
  const rawPort = process.env.X424_MCP_PORT ?? "4240";
  const port = Number(rawPort);
  if (!Number.isInteger(port) || port < 1 || port > 65_535) {
    throw new Error("X424_MCP_PORT must be a valid TCP port");
  }
  app.listen(port, "127.0.0.1", () => {
    console.error(`x424 MCP server listening on http://127.0.0.1:${port}/mcp`);
  });
}

const transport = process.env.X424_MCP_TRANSPORT ?? "stdio";
(transport === "http" ? runHttp() : runStdio()).catch((error: unknown) => {
  console.error(error);
  process.exitCode = 1;
});
