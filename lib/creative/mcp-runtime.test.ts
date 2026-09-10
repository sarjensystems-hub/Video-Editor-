import { describe, expect, it } from "vitest";
import { VIDEO_MCP_TOOLS } from "../mcp-server/mcp";
import { CREATIVE_RETURN_MODES } from "./document-summary";
import { createCanonicalCreativeFixture } from "./fixtures";
import { MAX_TRANSACTION_OPERATIONS } from "./schema-guide";
import {
  CREATIVE_MCP_TOOL_NAMES,
  parseCreativeContactSheetInput,
  parseCreativeDocumentImportInput,
  parseCreativeFrameRequestInput,
  parseCreativeProjectCanvasInput,
  parseCreativeProjectRenderInput,
  parseCreativeTransactionInput,
  parseProjectId,
} from "./mcp-runtime";

describe("creative MCP runtime", () => {
  it("exposes the deterministic ChatGPT-native creative tool family", () => {
    expect(CREATIVE_MCP_TOOL_NAMES).toContain("studio_create_creative_project");
    expect(CREATIVE_MCP_TOOL_NAMES).toContain("studio_import_creative_document");
    expect(CREATIVE_MCP_TOOL_NAMES).toContain("studio_get_creative_project");
    expect(CREATIVE_MCP_TOOL_NAMES).toContain("studio_edit_creative_project");
    expect(CREATIVE_MCP_TOOL_NAMES).toContain("studio_render_creative_frame");
    expect(CREATIVE_MCP_TOOL_NAMES).toContain("studio_compare_frame");
    expect(CREATIVE_MCP_TOOL_NAMES).toContain("studio_render_creative_contact_sheet");
    expect(CREATIVE_MCP_TOOL_NAMES).toContain("studio_render_creative_project");
    expect(CREATIVE_MCP_TOOL_NAMES).toContain("studio_get_render_job");
    expect(CREATIVE_MCP_TOOL_NAMES).toContain("studio_generate_image_asset");
    expect(CREATIVE_MCP_TOOL_NAMES).toContain("studio_promote_video_asset");
    expect(CREATIVE_MCP_TOOL_NAMES).toContain("studio_generate_speech_asset");
    expect(CREATIVE_MCP_TOOL_NAMES).toContain("studio_generate_music_asset");
    expect(CREATIVE_MCP_TOOL_NAMES).toContain("studio_add_sfx_asset");
    expect(CREATIVE_MCP_TOOL_NAMES).toContain("studio_import_svg");
    expect(CREATIVE_MCP_TOOL_NAMES).toContain("studio_inspect_creative_layout");
    expect(CREATIVE_MCP_TOOL_NAMES).toContain("studio_analyze_audio_asset");
    expect(CREATIVE_MCP_TOOL_NAMES).toContain("studio_list_creative_revisions");
    expect(CREATIVE_MCP_TOOL_NAMES).toContain("studio_restore_creative_revision");
  });

  /**
   * The drift this repo keeps paying for: a tool added to the runtime list but
   * not to tools/list is unreachable, and one advertised but not dispatched is
   * a tool call that errors. Neither shows up in any other test, because each
   * half is internally consistent.
   */
  it("advertises exactly the creative tools the runtime dispatches", () => {
    // Every tool now shares one brand prefix, so the creative set is what is
    // left once the three the outer message handler serves itself are taken
    // out: the OpenAI file handoff, and the two video-generation tools that
    // run through the job orchestrator rather than handleCreativeMcpTool.
    const HANDLED_OUTSIDE_CREATIVE_DISPATCH = new Set([
      "studio_upload_image",
      "studio_generate_video",
      "studio_get_video_job",
    ]);
    const advertised = VIDEO_MCP_TOOLS
      .map((tool) => tool.name as string)
      .filter((name) => !HANDLED_OUTSIDE_CREATIVE_DISPATCH.has(name));
    expect([...advertised].sort()).toEqual([...CREATIVE_MCP_TOOL_NAMES].sort());
  });

  /**
   * The same drift the test above catches, one layer deeper: a value added to
   * CREATIVE_RETURN_MODES (roadmap #67 added `outline`) has to reach the
   * advertised JSON schema too, or a caller sending it is rejected by the
   * transport before `parseCreativeReturnMode` — which already accepts it —
   * ever sees the call. get_creative_project is singled out because it is
   * the read tool the new mode was built for; `document` stays its default.
   */
  it("advertises every CREATIVE_RETURN_MODES value on studio_get_creative_project", () => {
    const tool = VIDEO_MCP_TOOLS.find((candidate) => candidate.name === "studio_get_creative_project");
    const schema = tool!.inputSchema as { properties?: Record<string, { enum?: readonly string[] }> };
    expect(schema.properties?.return?.enum).toEqual([...CREATIVE_RETURN_MODES]);
  });

  it("publishes the schema guide as a discoverable tool", () => {
    expect(CREATIVE_MCP_TOOL_NAMES).toContain("studio_describe_creative_schema");
    // Discovery is the whole point: a caller finds it while reading the tool
    // they were already going to use, not by knowing to look for it.
    const edit = VIDEO_MCP_TOOLS.find((tool) => tool.name === "studio_edit_creative_project");
    expect(edit?.description).toContain("studio_describe_creative_schema");
    const importTool = VIDEO_MCP_TOOLS.find((tool) => tool.name === "studio_import_creative_document");
    expect(importTool?.description).toContain("studio_describe_creative_schema");
  });

  it("says that a new project arrives with an empty seeded scene", () => {
    // roadmap #66: the seeded scene is fine, saying nothing about it was not.
    const create = VIDEO_MCP_TOOLS.find((tool) => tool.name === "studio_create_creative_project");
    expect(create?.description).toMatch(/scene-1/);
    expect(create?.description).toMatch(/empty scene/i);
  });

  it("no longer advertises a second-LLM creative director or image decomposition path", () => {
    expect(CREATIVE_MCP_TOOL_NAMES).not.toContain("studio_direct_creative_project");
    expect(CREATIVE_MCP_TOOL_NAMES).not.toContain("studio_decompose_image_asset");
  });

  it("requires a non-empty project id", () => {
    expect(() => parseProjectId({})).toThrow(/project_id/i);
    expect(parseProjectId({ project_id: " abc " })).toBe("abc");
  });

  it("accepts explicit Story canvas dimensions at project creation", () => {
    expect(parseCreativeProjectCanvasInput({ width: 1080, height: 1920, fps: 30 })).toEqual({
      width: 1080,
      height: 1920,
      fps: 30,
    });
    expect(parseCreativeProjectCanvasInput({})).toEqual({});
    expect(() => parseCreativeProjectCanvasInput({ width: 0 })).toThrow(/width/i);
    expect(() => parseCreativeProjectCanvasInput({ height: 8193 })).toThrow(/8192/);
    expect(() => parseCreativeProjectCanvasInput({ fps: 121 })).toThrow(/fps/i);
  });

  it("parses a closed transaction shape", () => {
    const transaction = parseCreativeTransactionInput({
      summary: "Edit headline",
      operations: [{ type: "set_text", sceneId: "scene-1", elementId: "headline", text: "BETTER CAR CARE." }],
    });
    expect(transaction.summary).toBe("Edit headline");
    expect(transaction.operations[0].type).toBe("set_text");
    expect(() => parseCreativeTransactionInput({ summary: "Bad", operations: [{ type: "execute_shell" }] })).toThrow(/unsupported operation/i);
  });

  /**
   * roadmap #71: the advertised `maxItems` on the edit tool's operations
   * array is client-side guidance only - nothing validates an incoming
   * tools/call request against the advertised JSON schema server-side - so
   * this parser, which every transaction from every caller passes through,
   * is where the cap actually has to be real.
   */
  it("enforces the transaction operation cap it advertises", () => {
    const op = { type: "set_text", sceneId: "scene-1", elementId: "headline", text: "x" };
    const atCap = Array.from({ length: MAX_TRANSACTION_OPERATIONS }, () => op);
    expect(parseCreativeTransactionInput({ summary: "At the cap", operations: atCap }).operations).toHaveLength(
      MAX_TRANSACTION_OPERATIONS,
    );

    const overCap = Array.from({ length: MAX_TRANSACTION_OPERATIONS + 1 }, () => op);
    expect(() => parseCreativeTransactionInput({ summary: "Over the cap", operations: overCap })).toThrow(
      new RegExp(String(MAX_TRANSACTION_OPERATIONS)),
    );
  });

  it("accepts a complete canonical CreativeDocument for direct ingestion", () => {
    const document = createCanonicalCreativeFixture();
    const parsed = parseCreativeDocumentImportInput({ title: "  ChatGPT concept  ", document });
    expect(parsed.title).toBe("ChatGPT concept");
    expect(parsed.document.scenes).toHaveLength(document.scenes.length);
    expect(parsed.document.scenes[0].elements[0].id).toBe(document.scenes[0].elements[0].id);
  });

  it("normalizes incoming project identity instead of rejecting a foreign or missing id", () => {
    const document = createCanonicalCreativeFixture();
    const foreign = { ...document, id: "chatgpt-local-draft" };
    expect(() => parseCreativeDocumentImportInput({ document: foreign })).not.toThrow();
    const withoutId = { ...document } as Record<string, unknown>;
    delete withoutId.id;
    expect(() => parseCreativeDocumentImportInput({ document: withoutId })).not.toThrow();
  });

  it("rejects malformed ingestion payloads before any persistence", () => {
    expect(() => parseCreativeDocumentImportInput({})).toThrow(/document/i);
    expect(() => parseCreativeDocumentImportInput({ document: null })).toThrow(/document/i);
    expect(() => parseCreativeDocumentImportInput({ document: [] })).toThrow(/document/i);
    expect(() => parseCreativeDocumentImportInput({ document: "{}" })).toThrow(/document/i);
    const broken = createCanonicalCreativeFixture();
    broken.scenes = [];
    expect(() => parseCreativeDocumentImportInput({ document: broken })).toThrow(/scene/i);
  });

  it("parses draft and timeline-window project renders", () => {
    expect(parseCreativeProjectRenderInput({ project_id: "project-1", start_ms: 1000, end_ms: 2500, quality: "draft" })).toEqual({
      projectId: "project-1", sceneId: null, startMs: 1000, endMs: 2500, quality: "draft",
    });
    expect(parseCreativeProjectRenderInput({ project_id: "project-1", scene_id: " scene-1 " })).toEqual({
      projectId: "project-1", sceneId: "scene-1", startMs: undefined, endMs: undefined, quality: undefined,
    });
    expect(() => parseCreativeProjectRenderInput({ project_id: "project-1", quality: "preview" })).toThrow(/quality/i);
    expect(() => parseCreativeProjectRenderInput({ project_id: "project-1", start_ms: -1 })).toThrow(/start_ms/i);
  });

  it("requires finite non-negative milliseconds for a rendered frame preview", () => {
    expect(parseCreativeFrameRequestInput({ project_id: "project-1", time_ms: 0 })).toEqual({
      projectId: "project-1",
      timeMs: 0,
    });
    expect(parseCreativeFrameRequestInput({ project_id: "project-1", time_ms: 1500 }).timeMs).toBe(1500);
    expect(() => parseCreativeFrameRequestInput({ project_id: "project-1" })).toThrow(/time_ms/i);
    expect(() => parseCreativeFrameRequestInput({ project_id: "project-1", time_ms: -1 })).toThrow(/time_ms/i);
    expect(() => parseCreativeFrameRequestInput({ project_id: "project-1", time_ms: Number.NaN })).toThrow(/time_ms/i);
    expect(() => parseCreativeFrameRequestInput({ project_id: "project-1", time_ms: "500" })).toThrow(/time_ms/i);
    expect(() => parseCreativeFrameRequestInput({ time_ms: 10 })).toThrow(/project_id/i);
  });

  it("parses a bounded, de-duplicated contact sheet timestamp list", () => {
    expect(parseCreativeContactSheetInput({ project_id: "project-1", times_ms: [0, 1200, 2400] })).toEqual({
      projectId: "project-1",
      timesMs: [0, 1200, 2400],
    });
    expect(() => parseCreativeContactSheetInput({ project_id: "project-1", times_ms: [] })).toThrow(/times_ms/i);
    expect(() => parseCreativeContactSheetInput({ project_id: "project-1", times_ms: [0, 0] })).toThrow(/duplicate/i);
    expect(() => parseCreativeContactSheetInput({ project_id: "project-1", times_ms: [0, -5] })).toThrow(/times_ms/i);
    expect(() => parseCreativeContactSheetInput({ project_id: "project-1" })).toThrow(/times_ms/i);
    expect(() =>
      parseCreativeContactSheetInput({ project_id: "project-1", times_ms: [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13] }),
    ).toThrow(/times_ms/i);
  });
});
