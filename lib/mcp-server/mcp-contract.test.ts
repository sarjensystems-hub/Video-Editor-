import { describe, expect, it } from "vitest";
import { CREATIVE_OPERATION_SCHEMA } from "../creative/operation-contract";
import { documentSha256 } from "../creative/document-hash";
import { handleMcpMessage } from "./mcp";

const deps = {
  start: async (_input: unknown) => ({}),
  get: async (_id: string) => null,
  uploadImage: async (_input: unknown) => ({}),
  creative: async (_name: string, _input: unknown) => ({}),
};

describe("Creative MCP public contract", () => {
  it("identifies the canonical edit contract in modern server metadata", async () => {
    const result = await handleMcpMessage(
      {
        jsonrpc: "2.0",
        id: "discover-contract",
        method: "server/discover",
        params: {
          _meta: { "io.modelcontextprotocol/protocolVersion": "2026-07-28" },
        },
      },
      deps,
    );

    const expectedContractSha = documentSha256(CREATIVE_OPERATION_SCHEMA);
    const meta = (result as any).result._meta;

    expect(meta["studio/creativeEditContractSha256"]).toBe(expectedContractSha);
    expect(meta["io.modelcontextprotocol/serverInfo"].version).toBe(
      `2.4.0+creative.${expectedContractSha.slice(0, 12)}`,
    );
  });

  it("serves the canonical Creative operation schema through tools/list", async () => {
    const result = await handleMcpMessage(
      { jsonrpc: "2.0", id: "contract", method: "tools/list", params: {} },
      deps,
    );
    const editTool = (result as any).result.tools.find(
      (tool: { name: string }) => tool.name === "studio_edit_creative_project",
    );
    const advertisedOperationSchema =
      editTool.inputSchema.properties.transaction.properties.operations.items;

    expect(advertisedOperationSchema).toEqual(CREATIVE_OPERATION_SCHEMA);
  });
});
