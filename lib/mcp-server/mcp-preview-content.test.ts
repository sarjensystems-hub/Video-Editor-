import { afterEach, describe, expect, it, vi } from "vitest";
import { handleMcpMessage } from "./mcp";
import { withInlineImages, type InlineImage } from "./inline-images";

const WEBP = new Uint8Array([0x52, 0x49, 0x46, 0x46, 0x57, 0x45, 0x42, 0x50]);
const WEBP_BASE64 = Buffer.from(WEBP).toString("base64");

function image(role: InlineImage["role"], bytes: Uint8Array = WEBP): InlineImage {
  return { bytes, mimeType: "image/webp", role };
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

function deps(value: unknown) {
  return {
    start: async () => ({}),
    get: async () => null,
    uploadImage: async () => ({}),
    creative: async () => value,
  };
}

const imagesIn = (result: unknown) =>
  ((result as any).result.content as Array<Record<string, unknown>>).filter((item) => item.type === "image");

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("creative preview MCP content", () => {
  it("returns a rendered frame as inline WebP image content", async () => {
    const frame = { project_id: "project-1", revision_id: "revision-1", time_ms: 1500, frame: 45, content_type: "image/webp", size_bytes: 8 };
    const result = await handleMcpMessage(
      modernCall("studio_render_creative_frame", { project_id: "project-1", time_ms: 1500 }),
      deps(withInlineImages({ ...frame }, [image("frame")])),
    );

    expect((result as any).result.structuredContent).toEqual(frame);
    expect(imagesIn(result)).toEqual([{ type: "image", data: WEBP_BASE64, mimeType: "image/webp" }]);
  });

  /**
   * The image is in memory already. Reaching for the network would mean it
   * was stored somewhere first — which is the thing that must not happen.
   */
  it("never fetches a preview to inline it", async () => {
    const fetchSpy = vi.fn();
    vi.stubGlobal("fetch", fetchSpy);
    await handleMcpMessage(
      modernCall("studio_render_creative_frame", { project_id: "project-1", time_ms: 0 }),
      deps(withInlineImages({ frame: 0 }, [image("frame")])),
    );
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("keeps image bytes out of the structured and text payloads", async () => {
    const result = await handleMcpMessage(
      modernCall("studio_render_creative_frame", { project_id: "project-1", time_ms: 0 }),
      deps(withInlineImages({ frame: 0 }, [image("frame")])),
    );
    const body = (result as any).result;
    expect(JSON.stringify(body.structuredContent)).not.toContain(WEBP_BASE64);
    expect(body.content[0]).toEqual({ type: "text", text: JSON.stringify({ frame: 0 }) });
  });

  it("returns only the contact sheet by default", async () => {
    const result = await handleMcpMessage(
      modernCall("studio_render_creative_contact_sheet", { project_id: "project-1", times_ms: [0, 1500] }),
      deps(withInlineImages({ frames: [] }, [image("sheet"), image("frame"), image("frame")])),
    );
    expect(imagesIn(result)).toHaveLength(1);
  });

  it("returns the individual frames, or both, when asked", async () => {
    const value = () => withInlineImages({ frames: [] }, [image("sheet"), image("frame"), image("frame")]);
    const frames = await handleMcpMessage(
      modernCall("studio_render_creative_contact_sheet", { project_id: "p", times_ms: [0, 1], return_images: "frames" }),
      deps(value()),
    );
    const both = await handleMcpMessage(
      modernCall("studio_render_creative_contact_sheet", { project_id: "p", times_ms: [0, 1], return_images: "both" }),
      deps(value()),
    );
    expect(imagesIn(frames)).toHaveLength(2);
    expect(imagesIn(both)).toHaveLength(3);
  });

  it("leaves images out, and says so, past the response size limit", async () => {
    const huge = new Uint8Array(13 * 1024 * 1024);
    const result = await handleMcpMessage(
      modernCall("studio_render_creative_contact_sheet", { project_id: "p", times_ms: [0, 1], return_images: "frames" }),
      deps(withInlineImages({ frames: [] }, [image("frame", huge), image("frame", huge)])),
    );
    const content = (result as any).result.content;
    expect(imagesIn(result)).toHaveLength(1);
    expect(content).toContainEqual(
      expect.objectContaining({ type: "text", text: expect.stringMatching(/1 of 2 preview images were left out/i) }),
    );
  });
});
