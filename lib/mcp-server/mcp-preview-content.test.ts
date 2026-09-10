import { afterEach, describe, expect, it, vi } from "vitest";
import { handleMcpMessage } from "./mcp";

const PNG_BYTES = new Uint8Array([137, 80, 78, 71]);
const PNG_BASE64 = "iVBORw==";

function stubPreviewFetch() {
  vi.stubGlobal(
    "fetch",
    vi.fn(async () =>
      new Response(PNG_BYTES, {
        status: 200,
        headers: { "content-type": "image/png" },
      }),
    ),
  );
}

function modernCall(name: string, args: Record<string, unknown>) {
  return {
    jsonrpc: "2.0",
    id: name,
    method: "tools/call",
    params: {
      name,
      arguments: args,
      _meta: { "io.modelcontextprotocol/protocolVersion": "2026-07-28" },
    },
  };
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("creative preview MCP content", () => {
  it("returns an exact rendered frame as MCP image content for model vision", async () => {
    stubPreviewFetch();
    const frame = {
      project_id: "project-1",
      revision_id: "revision-1",
      time_ms: 1500,
      frame: 45,
      output_url: "https://cdn.example.com/frame-45.png",
      content_type: "image/png",
      size_bytes: 4,
    };
    const result = await handleMcpMessage(
      modernCall("studio_render_creative_frame", { project_id: "project-1", time_ms: 1500 }),
      {
        start: async () => ({}),
        get: async () => null,
        uploadImage: async () => ({}),
        creative: async () => frame,
      },
    );

    expect((result as any).result.structuredContent).toEqual(frame);
    expect((result as any).result.content).toContainEqual({
      type: "image",
      data: PNG_BASE64,
      mimeType: "image/png",
    });
  });

  it("returns the rendered contact sheet as one MCP image content block", async () => {
    stubPreviewFetch();
    const sheet = {
      project_id: "project-1",
      revision_id: "revision-1",
      rendered_duration_ms: 12000,
      contact_sheet_url: "https://cdn.example.com/contact-sheet.png",
      contact_sheet_columns: 3,
      contact_sheet_rows: 2,
      content_type: "image/png",
      size_bytes: 4,
      frames: [],
    };
    const result = await handleMcpMessage(
      modernCall("studio_render_creative_contact_sheet", {
        project_id: "project-1",
        times_ms: [0, 1500],
      }),
      {
        start: async () => ({}),
        get: async () => null,
        uploadImage: async () => ({}),
        creative: async () => sheet,
      },
    );

    expect((result as any).result.structuredContent).toEqual(sheet);
    expect((result as any).result.content).toContainEqual({
      type: "image",
      data: PNG_BASE64,
      mimeType: "image/png",
    });
  });

  it("returns full-resolution contact-sheet frames inline when requested", async () => {
    stubPreviewFetch();
    const sheet = {
      contact_sheet_url: "https://cdn.example.com/contact-sheet.png",
      content_type: "image/png",
      frames: [
        { output_url: "https://cdn.example.com/frame-0.png", content_type: "image/png" },
        { output_url: "https://cdn.example.com/frame-45.png", content_type: "image/png" },
      ],
    };
    const result = await handleMcpMessage(
      modernCall("studio_render_creative_contact_sheet", {
        project_id: "project-1", times_ms: [0, 1500], return_images: "frames",
      }),
      { start: async () => ({}), get: async () => null, uploadImage: async () => ({}), creative: async () => sheet },
    );
    expect((result as any).result.content.filter((item: any) => item.type === "image")).toHaveLength(2);
    expect(fetch).toHaveBeenCalledTimes(2);
  });

  it("keeps successful preview images when another image cannot be loaded", async () => {
    vi.stubGlobal("fetch", vi.fn()
      .mockResolvedValueOnce(new Response("upstream error", { status: 502 }))
      .mockResolvedValueOnce(new Response(PNG_BYTES, { status: 200, headers: { "content-type": "image/png" } })));
    const sheet = {
      frames: [
        { output_url: "https://cdn.example.com/frame-0.png", content_type: "image/png" },
        { output_url: "https://cdn.example.com/frame-45.png", content_type: "image/png" },
      ],
    };
    const result = await handleMcpMessage(
      modernCall("studio_render_creative_contact_sheet", {
        project_id: "project-1", times_ms: [0, 1500], return_images: "frames",
      }),
      { start: async () => ({}), get: async () => null, uploadImage: async () => ({}), creative: async () => sheet },
    );
    const content = (result as any).result.content;
    expect(content.filter((item: any) => item.type === "image")).toHaveLength(1);
    expect(content).toContainEqual(expect.objectContaining({ type: "text", text: expect.stringMatching(/could not inline 1 of 2/i) }));
  });

  it("omits an oversized inline preview without downloading its body", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response(PNG_BYTES, {
      status: 200,
      headers: { "content-length": String(9 * 1024 * 1024), "content-type": "image/png" },
    })));
    const frame = {
      output_url: "https://cdn.example.com/oversized.png",
      content_type: "image/png",
    };
    const result = await handleMcpMessage(
      modernCall("studio_render_creative_frame", { project_id: "project-1", time_ms: 0 }),
      { start: async () => ({}), get: async () => null, uploadImage: async () => ({}), creative: async () => frame },
    );
    const content = (result as any).result.content;
    expect(content.filter((item: any) => item.type === "image")).toHaveLength(0);
    expect(content).toContainEqual(expect.objectContaining({ type: "text", text: expect.stringMatching(/could not inline 1 of 1/i) }));
  });

  it("stops streaming when an undeclared body exceeds the inline limit", async () => {
    let reads = 0;
    let cancelled = false;
    vi.stubGlobal("fetch", vi.fn(async () => ({
      ok: true,
      status: 200,
      headers: { get: () => null },
      body: {
        getReader: () => ({
          read: async () => ({ done: false, value: new Uint8Array(5 * 1024 * 1024 + reads++ * 0) }),
          cancel: async () => { cancelled = true; },
        }),
      },
    })));
    const result = await handleMcpMessage(
      modernCall("studio_render_creative_frame", { project_id: "project-1", time_ms: 0 }),
      {
        start: async () => ({}), get: async () => null, uploadImage: async () => ({}),
        creative: async () => ({ output_url: "https://cdn.example.com/no-length.png", content_type: "image/png" }),
      },
    );
    const content = (result as any).result.content;
    expect(reads).toBe(2);
    expect(cancelled).toBe(true);
    expect(content.filter((item: any) => item.type === "image")).toHaveLength(0);
  });
});
