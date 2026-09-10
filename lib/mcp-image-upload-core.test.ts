import { describe, expect, it } from "vitest";
import {
  buildMcpImageStoragePath,
  detectMcpImageContentType,
  parseMcpFileImageInput,
} from "./mcp-image-upload-core";

describe("MCP image upload core", () => {
  it("parses a ChatGPT file handoff", () => {
    expect(
      parseMcpFileImageInput({
        file: {
          download_url: "https://files.oaiusercontent.com/example.png?sig=temporary",
          file_id: "file_123",
          mime_type: "image/png",
          file_name: "creative.png",
        },
      }),
    ).toEqual({
      downloadUrl: "https://files.oaiusercontent.com/example.png?sig=temporary",
      fileId: "file_123",
      mimeType: "image/png",
      fileName: "creative.png",
    });
  });

  it("requires both file_id and download_url", () => {
    expect(() => parseMcpFileImageInput({ file: { file_id: "file_123" } })).toThrow(
      /download_url/i,
    );
    expect(() =>
      parseMcpFileImageInput({ file: { download_url: "https://files.oaiusercontent.com/a.png" } }),
    ).toThrow(/file_id/i);
  });

  it("rejects non-HTTPS and private download URLs", () => {
    expect(() =>
      parseMcpFileImageInput({
        file: { file_id: "file_1", download_url: "http://example.com/a.png" },
      }),
    ).toThrow(/https/i);
    expect(() =>
      parseMcpFileImageInput({
        file: { file_id: "file_1", download_url: "https://127.0.0.1/a.png" },
      }),
    ).toThrow(/public/i);
  });

  it("detects supported image types from exact bytes", () => {
    expect(
      detectMcpImageContentType(new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10])),
    ).toBe("image/png");
    expect(detectMcpImageContentType(new Uint8Array([255, 216, 255, 224]))).toBe("image/jpeg");
    expect(
      detectMcpImageContentType(
        new Uint8Array([82, 73, 70, 70, 0, 0, 0, 0, 87, 69, 66, 80]),
      ),
    ).toBe("image/webp");
  });

  it("rejects bytes that are not a supported image", () => {
    expect(() => detectMcpImageContentType(new Uint8Array([1, 2, 3, 4]))).toThrow(
      /supported image/i,
    );
  });

  it("builds a user-scoped dated storage path without exposing the original filename", () => {
    expect(
      buildMcpImageStoragePath(
        "user-123",
        "asset-456",
        "image/webp",
        new Date("2026-08-26T00:00:00.000Z"),
      ),
    ).toBe("user-123/mcp/images/2026/08/asset-456.webp");
  });
});
