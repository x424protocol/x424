import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { afterEach, describe, expect, it } from "vitest";
import { createX424McpServer } from "../src/mcp/server.js";

describe("x424 MCP server", () => {
  const closeables: Array<{ close(): Promise<void> }> = [];

  afterEach(async () => {
    await Promise.all(closeables.splice(0).map((item) => item.close()));
  });

  it("publishes focused tools with structured results", async () => {
    const server = createX424McpServer();
    const client = new Client({ name: "x424-test-client", version: "1.0.0" });
    const [clientTransport, serverTransport] =
      InMemoryTransport.createLinkedPair();
    closeables.push(client, server);
    await server.connect(
      serverTransport as unknown as Parameters<typeof server.connect>[0],
    );
    await client.connect(
      clientTransport as unknown as Parameters<typeof client.connect>[0],
    );

    const listed = await client.listTools();
    expect(listed.tools.map(({ name }) => name).sort()).toEqual([
      "x424_create_requirement",
      "x424_evaluate_result",
      "x424_inspect_requirement",
      "x424_verify_result_token",
    ]);

    const created = await client.callTool({
      name: "x424_create_requirement",
      arguments: {
        purpose: "test-action",
        method: "POST",
        uri: "https://api.example.test/action",
        audience: "https://api.example.test",
        binding: { kind: "agent_key", value: "sha256:test-key" },
        accepts: [
          {
            providerId: "world",
            methodId: "world-id-4-orb",
            descriptorVersion: "1",
            assuranceLevel: "orb",
            acceptedScopeKinds: ["action"],
          },
        ],
        ttl_seconds: 300,
      },
    });
    expect(created.isError).not.toBe(true);
    const structured = created.structuredContent as {
      humanRequired: string;
      dependencyId: string;
    };
    expect(structured.dependencyId).toMatch(/^x424_dep_/);

    const inspected = await client.callTool({
      name: "x424_inspect_requirement",
      arguments: { human_required: structured.humanRequired },
    });
    expect(inspected.structuredContent).toMatchObject({
      purpose: "test-action",
      bindingKind: "agent_key",
      acceptedMethods: ["world:world-id-4-orb@1"],
    });

    const resources = await client.listResources();
    expect(resources.resources.map(({ uri }) => uri).sort()).toEqual([
      "x424://fixtures/conformance/0.1",
      "x424://protocol/profile/0.1",
    ]);
    const fixture = await client.readResource({
      uri: "x424://fixtures/conformance/0.1",
    });
    expect(fixture.contents[0]).toMatchObject({
      mimeType: "application/json",
      uri: "x424://fixtures/conformance/0.1",
    });
    const fixtureContent = fixture.contents[0];
    if (!fixtureContent || !("text" in fixtureContent)) {
      throw new Error("Expected a text conformance resource");
    }
    const fixtureData = JSON.parse(fixtureContent.text) as {
      humanRequired: string;
      validHumanResult: string;
      evaluationTime: string;
      methodDescriptors: unknown[];
    };
    const evaluated = await client.callTool({
      name: "x424_evaluate_result",
      arguments: {
        human_required: fixtureData.humanRequired,
        human_result: fixtureData.validHumanResult,
        method_descriptors: fixtureData.methodDescriptors,
        now: fixtureData.evaluationTime,
      },
    });
    expect(evaluated.structuredContent).toEqual({
      satisfied: true,
      failureCodes: [],
    });
  });
});
