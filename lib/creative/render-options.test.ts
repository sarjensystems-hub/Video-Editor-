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
});
