import { describe, expect, it } from "vitest";
import { VIDEO_MCP_TOOLS, handleMcpMessage } from "./mcp";
import { CREATIVE_RETURN_MODES } from "../creative/document-summary";
import { CREATIVE_MCP_TOOL_NAMES } from "../creative/mcp-runtime";
import { creativeRenderCost, videoGenerationCost } from "../credit-costs";

const completed = {
  job_id: "job-1",
  status: "completed",
  provider: "openrouter",
  model: "m",
  mode: "cinematic",
  video_url: "https://cdn.example.com/v.mp4",
  error: null,
};

const uploaded = {
  asset_id: "asset-1",
  url: "https://cdn.example.com/social.png",
  content_type: "image/png",
  size_bytes: 1234,
};

const creativeResult = {
  project_id: "project-1",
  revision_id: "revision-2",
  revision: 2,
};

const deps = {
  start: async (_input: unknown) => completed,
  get: async (id: string) => (id === "job-1" ? completed : null),
  uploadImage: async (_input: unknown) => uploaded,
  creative: async (name: string, _input: unknown) => ({ ...creativeResult, tool: name }),
};

describe("Studio media MCP", () => {
  it("supports the legacy initialize handshake", async () => {
    const result = await handleMcpMessage(
      {
        jsonrpc: "2.0",
        id: 1,
        method: "initialize",
        params: {
          protocolVersion: "2025-11-25",
          capabilities: {},
          clientInfo: { name: "test", version: "1" },
        },
      },
      deps,
    );

    expect((result as any).result.protocolVersion).toBe("2025-11-25");
    expect((result as any).result.capabilities).toEqual({ tools: {} });
  });

  it("supports 2026-07-28 server discovery as Studio Media", async () => {
    const result = await handleMcpMessage(
      {
        jsonrpc: "2.0",
        id: "discover",
        method: "server/discover",
        params: {
          _meta: { "io.modelcontextprotocol/protocolVersion": "2026-07-28" },
        },
      },
      deps,
    );

    expect((result as any).result.resultType).toBe("complete");
    expect((result as any).result.supportedVersions).toEqual(["2026-07-28"]);
    expect((result as any).result._meta["io.modelcontextprotocol/serverInfo"].name).toBe(
      "Studio Media",
    );
  });

  it("lists existing media tools plus the complete creative project tool family", async () => {
    const result = await handleMcpMessage(
      { jsonrpc: "2.0", id: 2, method: "tools/list", params: {} },
      deps,
    );
    const names = (result as any).result.tools.map((tool: { name: string }) => tool.name);
    expect(names.slice(0, 3)).toEqual([
      "studio_generate_video",
      "studio_get_video_job",
      "studio_upload_image",
    ]);
    expect(names).toContain("studio_create_creative_project");
    expect(names).toContain("studio_import_creative_document");
    expect(names).toContain("studio_get_creative_project");
    expect(names).toContain("studio_edit_creative_project");
    expect(names).toContain("studio_render_creative_frame");
    expect(names).toContain("studio_render_creative_contact_sheet");
    expect(names).toContain("studio_render_creative_project");
    expect(names).toContain("studio_get_render_job");
    expect(names).toContain("studio_add_asset");
    expect(names).toContain("studio_generate_image_asset");
    expect(names).toContain("studio_promote_video_asset");
    expect(names).toContain("studio_generate_speech_asset");
    expect(names).toContain("studio_generate_music_asset");
    expect(names).toContain("studio_import_svg");
    expect(names).toContain("studio_inspect_creative_layout");
    expect(names).toContain("studio_analyze_audio_asset");
    expect(names).toContain("studio_list_creative_revisions");
    expect(names).toContain("studio_restore_creative_revision");
  });

  it("advertises Gemini's multilingual speech and exact voice catalogue", async () => {
    const result = await handleMcpMessage(
      { jsonrpc: "2.0", id: "speech-schema", method: "tools/list", params: {} },
      deps,
    );
    const speech = (result as any).result.tools.find(
      (tool: { name: string }) => tool.name === "studio_generate_speech_asset",
    );

    expect(speech.description).toMatch(/Gemini 3\.1 Flash TTS/i);
    expect(speech.description).toMatch(/70\+ languages/i);
    expect(speech.inputSchema.properties.language.enum).toBeUndefined();
    expect(speech.inputSchema.properties.voice.enum).toHaveLength(30);
    expect(speech.inputSchema.properties.voice.enum).toEqual(
      expect.arrayContaining(["Kore", "Puck", "Aoede", "Sulafat"]),
    );
  });

  it("no longer advertises the second-LLM creative director or decomposition tools", async () => {
    const result = await handleMcpMessage(
      { jsonrpc: "2.0", id: "surface", method: "tools/list", params: {} },
      deps,
    );
    const names = (result as any).result.tools.map((tool: { name: string }) => tool.name);
    expect(names).not.toContain("studio_direct_creative_project");
    expect(names).not.toContain("studio_decompose_image_asset");
  });

  it("rejects a call to a removed second-LLM creative tool", async () => {
    for (const name of ["studio_direct_creative_project", "studio_decompose_image_asset"]) {
      const result = await handleMcpMessage(
        {
          jsonrpc: "2.0",
          id: name,
          method: "tools/call",
          params: { name, arguments: { project_id: "project-1", intent: "make it pop" } },
        },
        deps,
      );
      expect((result as any).error.code).toBe(-32602);
      expect((result as any).error.message).toMatch(/unknown tool/i);
    }
  });

  it("describes the MCP surface as deterministic ChatGPT-owned creative execution", async () => {
    const result = await handleMcpMessage(
      {
        jsonrpc: "2.0",
        id: "init-instructions",
        method: "initialize",
        params: { protocolVersion: "2025-11-25", capabilities: {}, clientInfo: { name: "t", version: "1" } },
      },
      deps,
    );
    const instructions = String((result as any).result.instructions);
    expect(instructions).not.toMatch(/studio_direct_creative_project/);
    expect(instructions).not.toMatch(/studio_decompose_image_asset/);
    expect(instructions).not.toMatch(/decompose/i);
    expect(instructions).not.toMatch(/creative director/i);
    expect(instructions).not.toMatch(/natural.language/i);
    expect(instructions).toMatch(/deterministic/i);
    expect(instructions).toMatch(/frame/i);
    expect(instructions).toMatch(/reinterprets/i);
  });

  it("advertises whole-document CreativeDocument ingestion", () => {
    const importTool = VIDEO_MCP_TOOLS.find(
      (tool: any) => tool.name === "studio_import_creative_document",
    ) as any;
    expect(importTool.inputSchema.properties.document.type).toBe("object");
    expect(importTool.inputSchema.required).toEqual(["document"]);
    expect(importTool.inputSchema.properties.title.type).toBe("string");
    expect(importTool.inputSchema.properties.site_id.type).toBe("string");
  });

  it("advertises exact millisecond frame preview rendering", () => {
    const frame = VIDEO_MCP_TOOLS.find(
      (tool: any) => tool.name === "studio_render_creative_frame",
    ) as any;
    expect(frame.inputSchema.properties.time_ms.type).toBe("number");
    expect(frame.inputSchema.properties.time_ms.minimum).toBe(0);
    expect(frame.inputSchema.required).toEqual(["project_id", "time_ms"]);
    expect(frame.description).toMatch(/current .*revision/i);

    const sheet = VIDEO_MCP_TOOLS.find(
      (tool: any) => tool.name === "studio_render_creative_contact_sheet",
    ) as any;
    expect(sheet.inputSchema.properties.times_ms.type).toBe("array");
    expect(sheet.inputSchema.properties.times_ms.maxItems).toBe(12);
    expect(sheet.inputSchema.properties.times_ms.items.minimum).toBe(0);
    expect(sheet.inputSchema.properties.return_images.enum).toEqual(["sheet", "frames", "both"]);
    expect(sheet.inputSchema.required).toEqual(["project_id", "times_ms"]);
  });

  it("advertises roadmap media helpers through MCP", () => {
    const names = VIDEO_MCP_TOOLS.map((tool: any) => tool.name);
    expect(names).toContain("studio_compare_frame");
    expect(names).toContain("studio_add_sfx_asset");
    const edit = VIDEO_MCP_TOOLS.find((tool: any) => tool.name === "studio_edit_creative_project") as any;
    expect(edit.inputSchema.properties.thumbnail_times_ms.maxItems).toBe(3);
    const speech = VIDEO_MCP_TOOLS.find((tool: any) => tool.name === "studio_generate_speech_asset") as any;
    expect(speech.inputSchema.properties.marker_granularity.enum).toEqual(["words", "sentences", "both"]);
  });

  it("advertises explicit canvas dimensions for Creative Studio project creation", () => {
    const create = VIDEO_MCP_TOOLS.find(
      (tool: any) => tool.name === "studio_create_creative_project",
    ) as any;
    expect(create.inputSchema.properties.width.type).toBe("integer");
    expect(create.inputSchema.properties.height.type).toBe("integer");
    expect(create.inputSchema.properties.fps.type).toBe("integer");
  });

  it("advertises optional Studio site selection", () => {
    const generate = VIDEO_MCP_TOOLS[0] as any;
    expect(generate.inputSchema.properties.site_id.type).toBe("string");
    expect(generate.inputSchema.required).not.toContain("site_id");
  });

  it("advertises draft and timeline-window creative renders", () => {
    const render = VIDEO_MCP_TOOLS.find((tool: any) => tool.name === "studio_render_creative_project") as any;
    expect(render.inputSchema.properties.start_ms.minimum).toBe(0);
    expect(render.inputSchema.properties.end_ms.minimum).toBe(0);
    expect(render.inputSchema.properties.quality.enum).toEqual(["draft", "final"]);
  });

  it("advertises ChatGPT file handoff for image upload", () => {
    const upload = VIDEO_MCP_TOOLS.find(
      (tool: any) => tool.name === "studio_upload_image",
    ) as any;
    expect(upload._meta["openai/fileParams"]).toEqual(["file"]);
    expect(upload.inputSchema.required).toEqual(["file"]);
    expect(upload.inputSchema.properties.file.$ref).toBe("#/$defs/OpenAIFile");
    expect(upload.inputSchema.properties.image_base64).toBeUndefined();
    expect(upload.inputSchema.properties.source_url).toBeUndefined();
  });

  it("returns structured generation results", async () => {
    const result = await handleMcpMessage(
      {
        jsonrpc: "2.0",
        id: 3,
        method: "tools/call",
        params: {
          name: "studio_generate_video",
          arguments: { prompt: "p", idempotency_key: "idem" },
        },
      },
      deps,
    );
    expect((result as any).result.structuredContent.video_url).toBe(
      "https://cdn.example.com/v.mp4",
    );
    expect((result as any).result.isError).toBeUndefined();
  });

  it("returns structured image upload results for a file handoff", async () => {
    const result = await handleMcpMessage(
      {
        jsonrpc: "2.0",
        id: "upload",
        method: "tools/call",
        params: {
          name: "studio_upload_image",
          arguments: {
            file: {
              download_url: "https://files.oaiusercontent.com/example.png?sig=temporary",
              file_id: "file_123",
              mime_type: "image/png",
              file_name: "creative.png",
            },
          },
        },
      },
      deps,
    );
    expect((result as any).result.structuredContent).toEqual(uploaded);
    expect((result as any).result.isError).toBeUndefined();
  });

  it("dispatches a creative project transaction through the shared creative dependency", async () => {
    const result = await handleMcpMessage(
      {
        jsonrpc: "2.0",
        id: "creative-edit",
        method: "tools/call",
        params: {
          name: "studio_edit_creative_project",
          arguments: {
            project_id: "project-1",
            transaction: {
              summary: "Edit headline",
              operations: [{ type: "set_text", sceneId: "scene-1", elementId: "headline", text: "BETTER CAR CARE." }],
            },
          },
        },
      },
      deps,
    );
    expect((result as any).result.structuredContent.project_id).toBe("project-1");
    expect((result as any).result.structuredContent.tool).toBe("studio_edit_creative_project");
  });

  it("dispatches creative ingestion, worker, preview, import and revision tools through the same authenticated creative dependency", async () => {
    for (const name of [
      "studio_import_creative_document",
      "studio_generate_image_asset",
      "studio_promote_video_asset",
      "studio_import_svg",
      "studio_render_creative_frame",
      "studio_render_creative_contact_sheet",
      "studio_list_creative_revisions",
      "studio_restore_creative_revision",
    ]) {
      const result = await handleMcpMessage(
        {
          jsonrpc: "2.0",
          id: name,
          method: "tools/call",
          params: { name, arguments: { project_id: "project-1" } },
        },
        deps,
      );
      expect((result as any).result.structuredContent.tool).toBe(name);
      expect((result as any).result.isError).toBeUndefined();
    }
  });

  it("reports a missing job as a tool error", async () => {
    const result = await handleMcpMessage(
      {
        jsonrpc: "2.0",
        id: 4,
        method: "tools/call",
        params: { name: "studio_get_video_job", arguments: { job_id: "missing" } },
      },
      deps,
    );
    expect((result as any).result.isError).toBe(true);
    expect((result as any).result.content[0].text).toMatch(/not found/i);
  });

  it("returns method-not-found for unknown RPC methods", async () => {
    const result = await handleMcpMessage(
      { jsonrpc: "2.0", id: 5, method: "nope", params: {} },
      deps,
    );
    expect((result as any).error.code).toBe(-32601);
  });
});
/**
 * These schemas set `additionalProperties: false`, so a parameter the handler
 * reads but the schema does not declare is rejected before it ever arrives —
 * the tool silently ignores a documented option. Only a type check caught that
 * the first time; this catches it in the suite.
 */
describe("tools that honour `return` declare it", () => {
  const SUPPORTS_RETURN = [
    "studio_create_creative_project",
    "studio_import_creative_document",
    "studio_get_creative_project",
    "studio_edit_creative_project",
    "studio_import_svg",
    "studio_restore_creative_revision",
  ];

  for (const name of SUPPORTS_RETURN) {
    it(`${name} accepts every return mode`, () => {
      const tool = VIDEO_MCP_TOOLS.find((candidate) => candidate.name === name);
      expect(tool, `${name} is not in the advertised tool list`).toBeDefined();

      const schema = tool!.inputSchema as {
        additionalProperties?: boolean;
        properties?: Record<string, { enum?: string[]; description?: string }>;
      };
      const declared = schema.properties?.return;
      expect(declared, `${name} reads input.return but never advertises it`).toBeDefined();
      const expected = name === "studio_edit_creative_project"
        ? ["summary", "changed", "document", "none"]
        : [...CREATIVE_RETURN_MODES];
      expect(declared!.enum).toEqual(expected);
      expect(declared!.description).toBeTruthy();
    });
  }

  it("names which default each tool documents, since they are not all the same", () => {
    const defaults = (name: string) => {
      const tool = VIDEO_MCP_TOOLS.find((candidate) => candidate.name === name)!;
      const schema = tool.inputSchema as { properties?: Record<string, { description?: string }> };
      return schema.properties!.return.description!;
    };
    // A tool whose job is to hand back the document keeps doing that.
    expect(defaults("studio_get_creative_project")).toContain("document (default)");
    expect(defaults("studio_restore_creative_revision")).toContain("document (default)");
    // A tool whose caller authored the change does not.
    expect(defaults("studio_edit_creative_project")).toContain("summary (default)");
    expect(defaults("studio_import_creative_document")).toContain("summary (default)");
  });
});

describe("every creative tool the runtime handles is advertised", () => {
  it("advertises all of them, so none is invisible to a caller", () => {
    // A tool present in the runtime but missing from the tool list can only be
    // called by a client that guessed its name.
    const advertised = new Set(VIDEO_MCP_TOOLS.map((tool) => tool.name));
    const unadvertised = CREATIVE_MCP_TOOL_NAMES.filter((name) => !advertised.has(name));
    expect(unadvertised).toEqual([]);
  });

  it("gives every advertised tool a description and an object schema", () => {
    for (const tool of VIDEO_MCP_TOOLS) {
      expect(tool.description, `${tool.name} has no description`).toBeTruthy();
      expect((tool.inputSchema as { type?: string }).type, `${tool.name}`).toBe("object");
    }
  });
});

/**
 * A field run planned a film against a cost figure written into a document,
 * which a repricing commit had made 2.5x wrong. Quoted rates are therefore
 * computed from the cost table, and these tests fail if anyone writes one down
 * by hand again.
 */
describe("quoted prices come from the live cost table", () => {
  const description = (name: string) =>
    VIDEO_MCP_TOOLS.find((tool) => tool.name === name)!.description;

  it("quotes generation at the current per-second rates", () => {
    const quote = description("studio_generate_video");
    expect(quote).toContain(`${videoGenerationCost(1, "480p")} credits per second at 480p`);
    expect(quote).toContain(`${videoGenerationCost(1, "720p")} at 720p`);
    expect(quote).toContain(`${videoGenerationCost(15, "480p")}`);
    expect(quote).toContain(`${videoGenerationCost(15, "720p")}`);
  });

  it("quotes rendering at the current per-output-second rate", () => {
    expect(description("studio_render_creative_project")).toContain(`${creativeRenderCost(20_000)}`);
  });

  it("leaves no unresolved template placeholder in any description", () => {
    // A description built by concatenation can ship the source of a template
    // literal instead of its value, and it would read plausibly enough to miss.
    for (const tool of VIDEO_MCP_TOOLS) {
      expect(tool.description, `${tool.name}`).not.toMatch(/\$\{/);
    }
  });
});
