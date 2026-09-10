import { describe, expect, it } from "vitest";
import { createCanonicalCreativeFixture } from "./fixtures";
import { getCreativeRenderedDurationMs, resolveCreativeFrameAtTime } from "./frame-time";
import type { CreativeDocument, CreativeScene } from "./schema";

function multiSceneDocument(): CreativeDocument {
  const base = createCanonicalCreativeFixture();
  const first: CreativeScene = {
    ...base.scenes[0],
    durationMs: 2000,
    transitionOut: { kind: "fade", durationMs: 500, easing: "ease-in-out" },
  };
  const second: CreativeScene = {
    ...base.scenes[0],
    id: "scene-2",
    name: "Second",
    durationMs: 3000,
    transitionOut: undefined,
  };
  return { ...base, scenes: [first, second] };
}

describe("resolveCreativeFrameAtTime", () => {
  it("resolves the first frame at exactly zero milliseconds", () => {
    const document = createCanonicalCreativeFixture();
    expect(resolveCreativeFrameAtTime(document, 0)).toEqual({
      frame: 0,
      timeMs: 0,
      renderedDurationMs: 8000,
      fps: 30,
    });
  });

  it("uses exact floor(timeMs * fps / 1000) conversion", () => {
    const document = createCanonicalCreativeFixture();
    expect(resolveCreativeFrameAtTime(document, 1000).frame).toBe(30);
    expect(resolveCreativeFrameAtTime(document, 1033).frame).toBe(30);
    expect(resolveCreativeFrameAtTime(document, 1034).frame).toBe(31);
    expect(resolveCreativeFrameAtTime(document, 2500).frame).toBe(75);
  });

  it("never resolves past the last rendered frame index", () => {
    const document = createCanonicalCreativeFixture();
    const last = resolveCreativeFrameAtTime(document, 7999);
    expect(last.frame).toBe(239);
    expect(last.frame).toBeLessThan(Math.ceil((8000 / 1000) * 30));
  });

  it("respects the overlap-aware rendered timeline across scene transitions", () => {
    const document = multiSceneDocument();
    // 2000ms + 3000ms - 500ms of transition overlap.
    expect(getCreativeRenderedDurationMs(document)).toBe(4500);
    expect(resolveCreativeFrameAtTime(document, 1500).frame).toBe(45);
    expect(resolveCreativeFrameAtTime(document, 4499).frame).toBe(134);
    expect(() => resolveCreativeFrameAtTime(document, 4500)).toThrow(/rendered duration/i);
    expect(() => resolveCreativeFrameAtTime(document, 5000)).toThrow(/rendered duration/i);
  });

  it("rejects the exact project end instead of clamping it", () => {
    const document = createCanonicalCreativeFixture();
    expect(() => resolveCreativeFrameAtTime(document, 8000)).toThrow(/rendered duration/i);
  });

  it("rejects negative, NaN and non-finite input instead of clamping it", () => {
    const document = createCanonicalCreativeFixture();
    expect(() => resolveCreativeFrameAtTime(document, -1)).toThrow(/greater than or equal to zero/i);
    expect(() => resolveCreativeFrameAtTime(document, Number.NaN)).toThrow(/finite/i);
    expect(() => resolveCreativeFrameAtTime(document, Number.POSITIVE_INFINITY)).toThrow(/finite/i);
    expect(() => resolveCreativeFrameAtTime(document, "1000" as unknown as number)).toThrow(/finite/i);
  });

  it("honours the document frame rate", () => {
    const document = createCanonicalCreativeFixture();
    const at60 = { ...document, canvas: { ...document.canvas, fps: 60 } };
    expect(resolveCreativeFrameAtTime(at60, 1000).frame).toBe(60);
    expect(resolveCreativeFrameAtTime(at60, 1000).fps).toBe(60);
    const at24 = { ...document, canvas: { ...document.canvas, fps: 24 } };
    expect(resolveCreativeFrameAtTime(at24, 1000).frame).toBe(24);
  });
});
