import { describe, expect, it } from "vitest";
import { assertProbeTimeInRange, buildAssetProbeDocument } from "./asset-probe";
import { resolveCreativeFrameAtTime } from "./frame-time";
import { validateCreativeDocument } from "./validate";
import { resolveVideoSourceTimeMs } from "./video-playback";
import type { CreativeVideoElement } from "./schema";

const asset = { id: "asset-1", width: 720, height: 1280, durationMs: 15_000 };

function sourceElement(document = buildAssetProbeDocument(asset)): CreativeVideoElement {
  return document.scenes[0].elements[0] as CreativeVideoElement;
}

describe("buildAssetProbeDocument", () => {
  it("builds a document the renderer will accept", () => {
    // This is the test that was missing. The renderer validates its own input,
    // so a malformed probe document does not degrade — it fails the whole
    // call. The first version hand-rolled a design system without `radii` and
    // every probe died on "radii tokens must be an object", which is a
    // confusing way for a tool with no design system of its own to fail.
    for (const candidate of [asset, { id: "unmeasured" }, { id: "flat", width: 1920, height: 1080, durationMs: 8000 }]) {
      const result = validateCreativeDocument(buildAssetProbeDocument(candidate));
      expect(result.valid, JSON.stringify(result.issues?.slice(0, 3))).toBe(true);
    }
  });

  it("makes a timeline millisecond mean a source millisecond", () => {
    // The whole value of a probe is that the time you ask about is the time
    // you see. Anything that retimed the clip would answer a question about
    // 12,500ms with a different frame and no sign it had.
    const element = sourceElement();
    for (const timeMs of [0, 2500, 7333, 12_500, 14_999]) {
      expect(resolveVideoSourceTimeMs(element, timeMs)).toBe(timeMs);
    }
  });

  it("keeps the clip untrimmed and unretimed, which is what makes that true", () => {
    const element = sourceElement();
    expect(element.sourceStartMs).toBe(0);
    expect(element.playbackRate).toBe(1);
    expect(element.sourceEndMs).toBeUndefined();
    expect(element.speedRamp).toBeUndefined();
    expect(element.freezeAtSourceMs).toBeUndefined();
  });

  it("shows the whole frame rather than cropping it", () => {
    // `cover` would crop the edges out of the thing you asked to look at.
    expect(sourceElement().fit).toBe("contain");
  });

  it("takes the canvas from the asset, so the probe is not letterboxed", () => {
    const document = buildAssetProbeDocument(asset);
    expect(document.canvas.width).toBe(720);
    expect(document.canvas.height).toBe(1280);
  });

  it("falls back to a portrait canvas when the asset was never measured", () => {
    const document = buildAssetProbeDocument({ id: "unmeasured" });
    expect(document.canvas.width).toBe(1080);
    expect(document.canvas.height).toBe(1920);
  });

  it("is long enough to probe anywhere in the asset", () => {
    const document = buildAssetProbeDocument(asset);
    expect(document.scenes[0].durationMs).toBe(15_000);
    // The renderer rejects a time at or past the rendered duration, so the
    // last probeable instant has to be inside the scene.
    expect(() => resolveCreativeFrameAtTime(document, 14_999)).not.toThrow();
  });

  it("does not cap an unmeasured asset at zero length", () => {
    const document = buildAssetProbeDocument({ id: "unmeasured" });
    expect(() => resolveCreativeFrameAtTime(document, 30_000)).not.toThrow();
  });

  it("marks the plate as scenery, so a full-bleed probe raises no layout noise", () => {
    expect(sourceElement().role).toBe("background");
  });

  it("never collides with a real project id", () => {
    expect(buildAssetProbeDocument(asset).id).toBe("probe-asset-1");
  });
});

describe("assertProbeTimeInRange", () => {
  it("accepts a time inside the asset", () => {
    expect(() => assertProbeTimeInRange(14_999, 15_000)).not.toThrow();
    expect(() => assertProbeTimeInRange(0, 15_000)).not.toThrow();
  });

  it("rejects a time past the end instead of quietly clamping", () => {
    // Clamping would answer a question about 20s with the frame at 15s, and
    // the caller would write down the wrong cut.
    expect(() => assertProbeTimeInRange(20_000, 15_000)).toThrow(/past the end/);
    expect(() => assertProbeTimeInRange(15_000, 15_000)).toThrow(/past the end/);
  });

  it("rejects nonsense times", () => {
    expect(() => assertProbeTimeInRange(-1, 15_000)).toThrow(/greater than or equal to zero/);
    expect(() => assertProbeTimeInRange(Number.NaN, 15_000)).toThrow(/greater than or equal to zero/);
  });

  it("allows any time when the duration is unknown, rather than guessing one", () => {
    expect(() => assertProbeTimeInRange(90_000, null)).not.toThrow();
    expect(() => assertProbeTimeInRange(90_000, 0)).not.toThrow();
  });
});
