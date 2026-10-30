import { describe, expect, it } from "vitest";
import { createCanonicalCreativeFixture } from "./fixtures";
import { resolveCreativeRenderOptions } from "./render-options";

describe("resolveCreativeRenderOptions", () => {
  it("leaves a full final render at native scale without a frame range", () => {
    const document = createCanonicalCreativeFixture();
    const resolved = resolveCreativeRenderOptions(document);
    expect(resolved.frameRange).toBeUndefined();
    expect(resolved.scale).toBe(1);
    expect(resolved.crf).toBeUndefined();
    expect(resolved.durationMs).toBe(resolved.endMs);
  });

  it("maps a millisecond range to inclusive Remotion frameRange", () => {
    const document = createCanonicalCreativeFixture();
    document.canvas.fps = 30;
    document.scenes[0].durationMs = 5000;
    const resolved = resolveCreativeRenderOptions(document, { startMs: 1000, endMs: 2500 });
    expect(resolved.frameRange).toEqual([30, 74]);
    expect(resolved.durationMs).toBe(1500);
  });

  it("uses a cheaper half-scale encoding profile for draft renders", () => {
    const resolved = resolveCreativeRenderOptions(createCanonicalCreativeFixture(), { quality: "draft" });
    expect(resolved.scale).toBe(0.5);
    expect(resolved.crf).toBe(28);
    expect(resolved.jpegQuality).toBe(65);
  });

  it("refuses invalid ranges before a renderer is restored", () => {
    const document = createCanonicalCreativeFixture();
    expect(() => resolveCreativeRenderOptions(document, { startMs: -1 })).toThrow(/start_ms/);
    expect(() => resolveCreativeRenderOptions(document, { startMs: 100, endMs: 100 })).toThrow(/end_ms/);
    expect(() => resolveCreativeRenderOptions(document, { endMs: 999999 })).toThrow(/rendered duration/);
  });

  it("maps each final file size to its encoder settings, and leaves drafts alone", () => {
    const document = createCanonicalCreativeFixture();
    expect(resolveCreativeRenderOptions(document, { fileSize: "original" })).not.toHaveProperty("crf");
    expect(resolveCreativeRenderOptions(document, {})).not.toHaveProperty("x264Preset");
    expect(resolveCreativeRenderOptions(document, { fileSize: "high_quality" })).toMatchObject({ crf: 23, x264Preset: "slow", scale: 1 });
    expect(resolveCreativeRenderOptions(document, { fileSize: "small" })).toMatchObject({ crf: 26, x264Preset: "slow", scale: 1 });
    const draft = resolveCreativeRenderOptions(document, { quality: "draft", fileSize: "small" });
    expect(draft).toMatchObject({ crf: 28, scale: 0.5 });
    expect(draft).not.toHaveProperty("x264Preset");
  });
});
