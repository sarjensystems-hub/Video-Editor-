import { describe, expect, it } from "vitest";
import { createEmptyCreativeDocument } from "./defaults";
import { createCanonicalCreativeFixture } from "./fixtures";
import {
  getCreativeCompositionMetadata,
  getCreativeInputAssetMap,
} from "./remotion";

describe("creative Remotion adapter", () => {
  it("derives composition dimensions, fps and frame count from CreativeDocument", () => {
    const document = createCanonicalCreativeFixture();
    const metadata = getCreativeCompositionMetadata(document);
    expect(metadata.width).toBe(1080);
    expect(metadata.height).toBe(1350);
    expect(metadata.fps).toBe(30);
    expect(metadata.durationInFrames).toBe(Math.ceil((8000 / 1000) * 30));
  });

  it("accounts for scene transition overlap in frame count", () => {
    const document = createEmptyCreativeDocument({ id: "transition" });
    document.scenes[0].durationMs = 3000;
    document.scenes[0].transitionOut = { kind: "fade", durationMs: 500, easing: "linear" };
    document.scenes.push({ id: "two", name: "Two", durationMs: 2000, elements: [], groups: [] });
    expect(getCreativeCompositionMetadata(document).durationInFrames).toBe(135);
  });

  it("creates a serializable asset input map", () => {
    const assets = getCreativeInputAssetMap([
      { id: "a", url: "https://cdn.example/a.png", mimeType: "image/png" },
      { id: "b", url: "https://cdn.example/b.mp4", mimeType: "video/mp4" },
    ]);
    expect(assets).toEqual({
      a: { url: "https://cdn.example/a.png", mimeType: "image/png" },
      b: { url: "https://cdn.example/b.mp4", mimeType: "video/mp4" },
    });
    expect(JSON.parse(JSON.stringify(assets))).toEqual(assets);
  });
});
