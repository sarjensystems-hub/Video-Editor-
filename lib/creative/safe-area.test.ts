import { describe, expect, it } from "vitest";
import { createCanonicalCreativeFixture } from "./fixtures";
import { createDefaultTransform } from "./defaults";
import {
  REELS_SAFE_AREA,
  TITLE_SAFE_AREA,
  defaultSafeAreaFor,
  inspectCreativeSafeAreas,
  safeAreaInsetsFor,
} from "./safe-area";
import type { CreativeDocument, CreativeTextElement } from "./schema";

/** The fixture headline, narrowed so tests can spread it as a text element. */
function headlineElement(): CreativeTextElement {
  const base = createCanonicalCreativeFixture();
  const found = base.scenes[0].elements.find((e) => e.id === "headline");
  if (!found || found.type !== "text") throw new Error("fixture headline missing");
  return found;
}

function docWith(elements: CreativeDocument["scenes"][number]["elements"]): CreativeDocument {
  const base = createCanonicalCreativeFixture();
  return { ...base, scenes: [{ ...base.scenes[0], elements, groups: [] }] };
}

const box = (o: Partial<{ x: number; y: number; width: number; height: number }>) =>
  createDefaultTransform({ x: 0, y: 0, width: 200, height: 100, ...o });

describe("safeAreaInsetsFor", () => {
  it("scales the Reels preset to the canvas", () => {
    const insets = safeAreaInsetsFor({ width: 1080, height: 1920 }, REELS_SAFE_AREA);
    expect(insets.left).toBeGreaterThan(0);
    expect(insets.top).toBeGreaterThan(0);
    // Reels reserves much more at the bottom for the caption and action rail.
    expect(insets.bottom).toBeGreaterThan(insets.top);
  });

  it("is proportional, so a taller canvas reserves more absolute space", () => {
    const small = safeAreaInsetsFor({ width: 540, height: 960 }, REELS_SAFE_AREA);
    const large = safeAreaInsetsFor({ width: 1080, height: 1920 }, REELS_SAFE_AREA);
    expect(large.bottom).toBeCloseTo(small.bottom * 2, 5);
  });
});

describe("inspectCreativeSafeAreas", () => {
  it("reports nothing for a document whose elements sit inside the canvas", () => {
    const doc = docWith([
      { id: "a", name: "A", type: "shape", shape: "rect",
        fill: { kind: "token", token: "accent" }, transform: box({ x: 300, y: 500 }) },
    ]);
    expect(inspectCreativeSafeAreas(doc)).toEqual([]);
  });

  it("flags an element that runs off the canvas", () => {
    const doc = docWith([
      { id: "bleed", name: "Bleed", type: "shape", shape: "rect",
        fill: { kind: "token", token: "accent" }, transform: box({ x: 1000, y: 100, width: 400 }) },
    ]);
    const warnings = inspectCreativeSafeAreas(doc);
    expect(warnings).toHaveLength(1);
    expect(warnings[0].code).toBe("out_of_canvas");
    expect(warnings[0].elementId).toBe("bleed");
    expect(warnings[0].sceneId).toBe("scene-1");
  });

  it("flags an element inside the canvas but outside the action-safe area", () => {
    const doc = docWith([
      { id: "low", name: "Low", type: "shape", shape: "rect",
        fill: { kind: "token", token: "accent" }, transform: box({ x: 100, y: 1300, height: 40 }) },
    ]);
    const warnings = inspectCreativeSafeAreas(doc, REELS_SAFE_AREA);
    expect(warnings.some((w) => w.code === "outside_safe_area")).toBe(true);
  });

  it("flags text that overflows its own box", () => {
    const headline = headlineElement();
    const doc = docWith([
      { ...headline, text: "FIND THE RIGHT PEOPLE FOR YOUR CAR TODAY AND TOMORROW AND EVERY DAY",
        transform: box({ x: 40, y: 400, width: 300, height: 60 }) },
    ]);
    const warnings = inspectCreativeSafeAreas(doc);
    expect(warnings.some((w) => w.code === "text_overflow")).toBe(true);
  });

  it("does not flag text that shrinks to fit", () => {
    const headline = headlineElement();
    const long = "FIND THE RIGHT PEOPLE FOR YOUR CAR";
    const overflowing = docWith([
      { ...headline, text: long, transform: box({ x: 40, y: 400, width: 320, height: 70 }) },
    ]);
    expect(inspectCreativeSafeAreas(overflowing).some((w) => w.code === "text_overflow")).toBe(true);

    const fitted = docWith([
      { ...headline, text: long, fit: { mode: "shrink", minFontSize: 10 },
        transform: box({ x: 40, y: 400, width: 320, height: 70 }) },
    ]);
    expect(inspectCreativeSafeAreas(fitted).some((w) => w.code === "text_overflow")).toBe(false);
  });

  it("ignores hidden elements, which are not on screen to bleed", () => {
    const doc = docWith([
      { id: "bleed", name: "Bleed", type: "shape", shape: "rect", hidden: true,
        fill: { kind: "token", token: "accent" }, transform: box({ x: 2000, y: 100 }) },
    ]);
    expect(inspectCreativeSafeAreas(doc)).toEqual([]);
  });

  it("returns warnings, never throws, so inspection can never block an edit", () => {
    const doc = docWith([
      { id: "bad", name: "Bad", type: "shape", shape: "rect",
        fill: { kind: "token", token: "accent" }, transform: box({ x: -900, y: -900 }) },
    ]);
    expect(() => inspectCreativeSafeAreas(doc)).not.toThrow();
    expect(inspectCreativeSafeAreas(doc).length).toBeGreaterThan(0);
  });
});

describe("scenery does not raise layout warnings", () => {
  const canvas = { width: 1080, height: 1920, fps: 30, background: { kind: "literal" as const, value: "#000" } };

  const plate = (overrides: Record<string, unknown> = {}) => ({
    id: "plate",
    name: "Plate",
    type: "video" as const,
    assetId: "asset",
    sourceStartMs: 0,
    fit: "cover" as const,
    volume: 0,
    playbackRate: 1,
    transform: {
      x: 0, y: 0, width: 1080, height: 1920, rotation: 0,
      opacity: 1, anchorX: 0.5, anchorY: 0.5, zIndex: 0,
    },
    ...overrides,
  });

  const documentWith = (elements: unknown[]) => ({
    version: 1 as const,
    id: "doc",
    title: "Film",
    canvas,
    designSystem: { colors: {}, typography: {}, spacing: {} },
    scenes: [{ id: "scene-1", name: "Scene", durationMs: 3000, elements, groups: [] }],
  }) as unknown as Parameters<typeof inspectCreativeSafeAreas>[0];

  it("says nothing about a full-bleed plate", () => {
    // Eight full-bleed scenes used to report sixteen expected warnings, and a
    // check that is mostly noise stops being read.
    expect(inspectCreativeSafeAreas(documentWith([plate()]), REELS_SAFE_AREA)).toEqual([]);
  });

  it("says nothing about a plate deliberately larger than the canvas", () => {
    const oversized = plate({
      transform: { x: -40, y: -40, width: 1160, height: 2000, rotation: 0,
        opacity: 1, anchorX: 0.5, anchorY: 0.5, zIndex: 0 },
    });
    expect(inspectCreativeSafeAreas(documentWith([oversized]), REELS_SAFE_AREA)).toEqual([]);
  });

  it("takes a declared background at its word even when it covers only part", () => {
    // A lower-third scrim bleeds sideways on purpose but does not cover the
    // canvas, so geometry alone cannot tell it apart from a mistake.
    const scrim = plate({
      id: "scrim",
      role: "background",
      transform: { x: -60, y: 1200, width: 1200, height: 720, rotation: 0,
        opacity: 1, anchorX: 0.5, anchorY: 0.5, zIndex: 1 },
    });
    expect(inspectCreativeSafeAreas(documentWith([scrim]), REELS_SAFE_AREA)).toEqual([]);
  });

  it("still reports content that drifts off the canvas", () => {
    // The whole point is to keep this one legible.
    const stray = plate({
      id: "headline",
      transform: { x: -60, y: 400, width: 600, height: 200, rotation: 0,
        opacity: 1, anchorX: 0.5, anchorY: 0.5, zIndex: 3 },
    });
    const warnings = inspectCreativeSafeAreas(documentWith([stray]), REELS_SAFE_AREA);
    expect(warnings).toHaveLength(1);
    expect(warnings[0].code).toBe("out_of_canvas");
  });
});

/**
 * The SARA build reported every scene-5 warning as a false positive, and was
 * right: the rail sat at x=60 in authored coordinates but the scene camera
 * scaled to 0.82 about (0.62, 0.5), putting it at x~263 on screen — well
 * inside the margin. The author had to choose between ignoring the inspector
 * and distorting a correct layout to satisfy it. Both are worse than no check.
 */
describe("inspection judges where an element actually renders", () => {
  const canvas = { width: 1920, height: 1080, fps: 30, background: { kind: "literal", value: "#fff" } };

  const film = (scene: Record<string, unknown>) =>
    ({
      version: 1, id: "doc", title: "Film", canvas,
      designSystem: { colors: {}, typography: {}, spacing: {}, radii: {}, strokes: {}, motion: { presets: {}, sceneTransitions: {} } },
      scenes: [{ id: "s1", name: "S", durationMs: 4000, groups: [], ...scene }],
    }) as unknown as CreativeDocument;

  const rail = {
    id: "rail", name: "rail", type: "shape", shape: "rect",
    fill: { kind: "literal", value: "#fff" },
    transform: { x: 60, y: 300, width: 420, height: 480, rotation: 0, opacity: 1, anchorX: 0.5, anchorY: 0.5, zIndex: 1 },
  };

  const camera = (scaleX: number, scaleY: number, anchorX: number) => ({
    transform: { x: 0, y: 0, scaleX, scaleY, rotation: 0, opacity: 1, anchorX, anchorY: 0.5 },
  });

  it("warns about the authored position when there is no camera", () => {
    const warnings = inspectCreativeSafeAreas(film({ elements: [rail] }), TITLE_SAFE_AREA);
    expect(warnings.some((w) => w.elementId === "rail" && w.code === "outside_safe_area")).toBe(true);
  });

  it("stops warning once the camera brings it inside the margin", () => {
    // 0.82 about anchorX 0.62: x = 1190.4 + (60 - 1190.4) * 0.82 = 263.5, and
    // the title-safe left margin is 192.
    const scene = { elements: [rail], camera: camera(0.82, 0.82, 0.62) };
    const warnings = inspectCreativeSafeAreas(film(scene), TITLE_SAFE_AREA);
    expect(warnings.filter((w) => w.elementId === "rail")).toEqual([]);
  });

  it("warns when a camera pushes a safe element out of frame", () => {
    // The check has to work in both directions, or it is only ever optimistic.
    const centred = {
      ...rail,
      transform: { ...rail.transform, x: 800, y: 400, width: 320, height: 280 },
    };
    // Half-width 160 about centre: the right edge clears the 1728 margin only
    // past 4.8x, so 5.5 is a genuine push-out rather than a near miss.
    const scene = { elements: [centred], camera: camera(5.5, 5.5, 0.5) };
    const warnings = inspectCreativeSafeAreas(film(scene), TITLE_SAFE_AREA);
    expect(warnings.some((w) => w.elementId === "rail")).toBe(true);
  });

  it("composes an owning group's transform as well as the camera", () => {
    const scene = {
      elements: [rail],
      groups: [{
        id: "g", name: "g", elementIds: ["rail"],
        transform: { x: 400, y: 0, scaleX: 1, scaleY: 1, rotation: 0, opacity: 1, anchorX: 0.5, anchorY: 0.5 },
      }],
    };
    expect(inspectCreativeSafeAreas(film(scene), TITLE_SAFE_AREA).filter((w) => w.elementId === "rail")).toEqual([]);
  });

  it("judges an animated camera across the scene, not only at time zero", () => {
    // A camera that starts safe and pulls away still shows the element outside
    // the margin, and the audience sees it there.
    const centred = { ...rail, transform: { ...rail.transform, x: 800, y: 400, width: 320, height: 280 } };
    const scene = {
      elements: [centred],
      camera: {
        transform: { x: 0, y: 0, scaleX: 1, scaleY: 1, rotation: 0, opacity: 1, anchorX: 0.5, anchorY: 0.5 },
        animations: [{
          id: "push", property: "scaleX",
          keyframes: [{ timeMs: 0, value: 1, easing: "linear" }, { timeMs: 4000, value: 3.2, easing: "linear" }],
        }, {
          id: "pushY", property: "scaleY",
          keyframes: [{ timeMs: 0, value: 1, easing: "linear" }, { timeMs: 4000, value: 3.2, easing: "linear" }],
        }],
      },
    };
    expect(inspectCreativeSafeAreas(film(scene), TITLE_SAFE_AREA).some((w) => w.elementId === "rail")).toBe(true);
  });
});

describe("defaultSafeAreaFor", () => {
  it("gives a landscape film title-safe, not a phone's caption rail", () => {
    expect(defaultSafeAreaFor({ width: 1920, height: 1080 })).toBe(TITLE_SAFE_AREA);
  });

  it("keeps reels for portrait and square, which is where they are watched", () => {
    expect(defaultSafeAreaFor({ width: 1080, height: 1920 })).toBe(REELS_SAFE_AREA);
    expect(defaultSafeAreaFor({ width: 1080, height: 1080 })).toBe(REELS_SAFE_AREA);
  });
});
