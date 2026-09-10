import { describe, expect, it } from "vitest";
import { clipVisibleDurationMs, inspectClipCoverage, requiredSourceMs } from "./clip-coverage";
import type { CreativeDocument, CreativeScene, CreativeVideoElement } from "./schema";

function clip(overrides: Partial<CreativeVideoElement> = {}): CreativeVideoElement {
  return {
    id: "clip",
    name: "clip",
    type: "video",
    assetId: "asset",
    sourceStartMs: 0,
    fit: "cover",
    volume: 0,
    playbackRate: 1,
    transform: {
      x: 0, y: 0, width: 1080, height: 1920, rotation: 0,
      opacity: 1, anchorX: 0.5, anchorY: 0.5, zIndex: 0,
    },
    ...overrides,
  };
}

function doc(elements: CreativeVideoElement[], durationMs = 3000): CreativeDocument {
  const scene: CreativeScene = {
    id: "scene-1",
    name: "Scene",
    durationMs,
    elements,
    groups: [],
  };
  return {
    version: 1,
    id: "doc",
    title: "Film",
    canvas: { width: 1080, height: 1920, fps: 30, background: { kind: "literal", value: "#000" } },
    designSystem: { colors: {}, typography: {}, spacing: {} } as CreativeDocument["designSystem"],
    scenes: [scene],
  };
}

const assets = (durationMs: number | null) => new Map([["asset", durationMs]]);

describe("clipVisibleDurationMs", () => {
  it("fills the scene when the element carries no timing", () => {
    expect(clipVisibleDurationMs(clip(), 3000)).toBe(3000);
  });

  it("uses the element's own window when it has one", () => {
    expect(clipVisibleDurationMs(clip({ timing: { startMs: 500, endMs: 2000 } }), 3000)).toBe(1500);
  });
});

describe("requiredSourceMs", () => {
  it("is the source reached at the end of the visible window", () => {
    expect(requiredSourceMs(clip({ sourceStartMs: 1000 }), 3000)).toBe(4000);
  });

  it("grows with playback rate, which is what makes a fast clip overrun", () => {
    expect(requiredSourceMs(clip({ sourceStartMs: 0, playbackRate: 2 }), 3000)).toBe(6000);
  });

  it("respects an explicit out point even when the clip never reaches it", () => {
    // The continuous path trims at sourceEndMs, so a window past the asset is
    // an overrun whether or not the clip is long enough to play that far.
    expect(requiredSourceMs(clip({ sourceStartMs: 0, sourceEndMs: 20_000 }), 1000)).toBe(20_000);
  });

  it("treats a freeze as one position, not a window", () => {
    expect(requiredSourceMs(clip({ freezeAtSourceMs: 2000 }), 9000)).toBe(2000);
  });
});

describe("inspectClipCoverage", () => {
  it("says nothing when the footage covers the clip", () => {
    expect(inspectClipCoverage(doc([clip()]), assets(15_000))).toEqual([]);
  });

  it("catches the black-frame case before it is rendered", () => {
    // A 15s asset under a 3s scene at 2x asks for 6s — fine. At 6x it asks for
    // 18s and goes black two thirds of the way through.
    const warnings = inspectClipCoverage(doc([clip({ playbackRate: 6 })]), assets(15_000));
    expect(warnings).toHaveLength(1);
    expect(warnings[0].code).toBe("clip_source_overrun");
    expect(warnings[0].requiredSourceMs).toBe(18_000);
    expect(warnings[0].assetDurationMs).toBe(15_000);
    expect(warnings[0].message).toContain("render black");
  });

  it("does not fire on a clip that ends exactly at the end of its asset", () => {
    // Frames land on the nearest source frame, so asking for the final instant
    // is not an overrun. A warning that fires on correct work gets ignored.
    expect(inspectClipCoverage(doc([clip({ sourceStartMs: 12_000 })]), assets(15_000))).toEqual([]);
  });

  it("reports a clip pointing at an asset the project does not have", () => {
    const warnings = inspectClipCoverage(doc([clip({ assetId: "ghost" })]), assets(15_000));
    expect(warnings).toHaveLength(1);
    expect(warnings[0].code).toBe("clip_source_missing_asset");
  });

  it("stays quiet when the asset's duration was never measured", () => {
    // A warning nobody can act on trains people to stop reading warnings.
    expect(inspectClipCoverage(doc([clip({ playbackRate: 6 })]), assets(null))).toEqual([]);
  });

  it("ignores elements that are not video", () => {
    const text = { id: "t", name: "t", type: "text" } as unknown as CreativeVideoElement;
    expect(inspectClipCoverage(doc([text]), assets(15_000))).toEqual([]);
  });

  it("names the scene and element, so a warning points at one edit", () => {
    const warnings = inspectClipCoverage(doc([clip({ id: "end-card", playbackRate: 9 })]), assets(5000));
    expect(warnings[0].sceneId).toBe("scene-1");
    expect(warnings[0].elementId).toBe("end-card");
  });

  it("agrees with the renderer about a slowed clip that does fit", () => {
    // The end card that shipped black: 13300-15000 at half speed under 3400ms.
    // It always had footage; the engine simply was not asking for it. The
    // check has to agree, or it would report the fix as the fault.
    const endCard = clip({ sourceStartMs: 13_300, sourceEndMs: 15_000, playbackRate: 0.5 });
    expect(inspectClipCoverage(doc([endCard], 3400), assets(15_000))).toEqual([]);
  });
});
