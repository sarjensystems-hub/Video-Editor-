import { readFileSync } from "node:fs";
import { resolve as resolvePath } from "node:path";
import { describe, expect, it } from "vitest";
import { createDefaultTransform, createEmptyCreativeDocument } from "./defaults";
import type { CreativeElement } from "./schema";
import {
  evaluateElementAtTime,
  evaluateSceneAtTime,
  getCreativeDurationMs,
  resolveColor,
  resolveTextStyle,
} from "./evaluate";

function element(): CreativeElement {
  return {
    id: "headline",
    name: "Headline",
    type: "text",
    text: "Hello",
    style: { token: "heading" },
    timing: { startMs: 500, endMs: 2000 },
    transform: createDefaultTransform({ x: 100, y: 200, width: 600, height: 120, opacity: 1, zIndex: 2 }),
    animations: [
      {
        id: "move",
        property: "y",
        keyframes: [
          { timeMs: 500, value: 240, easing: "linear" },
          { timeMs: 1500, value: 200, easing: "linear" },
        ],
      },
      {
        id: "opacity",
        property: "opacity",
        keyframes: [
          { timeMs: 500, value: 0, easing: "ease-out" },
          { timeMs: 1000, value: 1, easing: "ease-out" },
        ],
      },
      {
        id: "scale",
        property: "scaleX",
        keyframes: [
          { timeMs: 500, value: 0.8, easing: "linear" },
          { timeMs: 1500, value: 1, easing: "linear" },
        ],
      },
    ],
  };
}

describe("creative frame evaluator", () => {
  it("respects visibility windows and hidden state", () => {
    const doc = createEmptyCreativeDocument({ id: "eval" });
    const scene = doc.scenes[0];
    const source = element();

    expect(evaluateElementAtTime(doc, scene, source, 499)).toBeNull();
    expect(evaluateElementAtTime(doc, scene, source, 500)).not.toBeNull();
    expect(evaluateElementAtTime(doc, scene, source, 1999)).not.toBeNull();
    expect(evaluateElementAtTime(doc, scene, source, 2000)).toBeNull();
    expect(evaluateElementAtTime(doc, scene, { ...source, hidden: true }, 1000)).toBeNull();
  });

  it("interpolates explicit keyframes and preserves base transform values", () => {
    const doc = createEmptyCreativeDocument({ id: "eval" });
    const scene = doc.scenes[0];
    const evaluated = evaluateElementAtTime(doc, scene, element(), 1000);

    expect(evaluated).not.toBeNull();
    expect(evaluated?.transform.x).toBe(100);
    expect(evaluated?.transform.y).toBe(220);
    expect(evaluated?.transform.opacity).toBe(1);
    expect(evaluated?.transform.scaleX).toBeCloseTo(0.9, 5);
    expect(evaluated?.transform.scaleY).toBe(1);
    expect(evaluated?.transform.width).toBe(600);
  });

  it("clamps animation values to the first and last keyframes", () => {
    const doc = createEmptyCreativeDocument({ id: "eval" });
    const scene = doc.scenes[0];
    const source = element();

    const atStart = evaluateElementAtTime(doc, scene, source, 500);
    const afterAnimation = evaluateElementAtTime(doc, scene, source, 1800);

    expect(atStart?.transform.y).toBe(240);
    expect(atStart?.transform.opacity).toBe(0);
    expect(afterAnimation?.transform.y).toBe(200);
    expect(afterAnimation?.transform.scaleX).toBe(1);
  });

  it("sorts visible elements by z-index then original array order and hides group members", () => {
    const doc = createEmptyCreativeDocument({ id: "eval" });
    const scene = doc.scenes[0];
    scene.durationMs = 3000;
    const one = { ...element(), id: "one", timing: undefined, animations: undefined, transform: createDefaultTransform({ zIndex: 2 }) } as CreativeElement;
    const two = { ...element(), id: "two", timing: undefined, animations: undefined, transform: createDefaultTransform({ zIndex: 1 }) } as CreativeElement;
    const three = { ...element(), id: "three", timing: undefined, animations: undefined, transform: createDefaultTransform({ zIndex: 2 }) } as CreativeElement;
    scene.elements = [one, two, three];
    scene.groups = [{ id: "hidden", name: "Hidden", elementIds: ["three"], hidden: true }];

    const evaluated = evaluateSceneAtTime(doc, scene, 1000);
    expect(evaluated.elements.map((item) => item.element.id)).toEqual(["two", "one"]);
  });

  it("resolves color and typography tokens deterministically", () => {
    const doc = createEmptyCreativeDocument({ id: "eval" });
    expect(resolveColor(doc.designSystem, { kind: "token", token: "accent" })).toBe("#F97316");
    expect(resolveColor(doc.designSystem, { kind: "literal", value: "#123456" })).toBe("#123456");

    const style = resolveTextStyle(doc.designSystem, {
      token: "heading",
      overrides: { fontSize: 84, color: { kind: "token", token: "accent" } },
    });
    expect(style.fontSize).toBe(84);
    expect(style.color).toBe("#F97316");
    expect(style.fontFamily).toBe(doc.designSystem.typography.heading.fontFamily);
  });

  it("calculates document duration with transition overlaps", () => {
    const doc = createEmptyCreativeDocument({ id: "eval" });
    doc.scenes[0].durationMs = 3000;
    doc.scenes[0].transitionOut = { kind: "fade", durationMs: 500, easing: "linear" };
    doc.scenes.push({ id: "scene-2", name: "Scene 2", durationMs: 2000, elements: [], groups: [] });

    expect(getCreativeDurationMs(doc)).toBe(4500);
  });
});

/**
 * Animatable blur.
 *
 * The reference films the brief was chasing use blur as a compositional device
 * rather than a grade — focus pulls, depth stacking, glass interstitials. It
 * was already in `adjustments` and could only be set, never moved.
 */
describe("animated blur", () => {
  const withBlur = (animations: unknown[], adjustments?: Record<string, number>) => {
    const document = createEmptyCreativeDocument({ id: "blur-doc", title: "Blur" });
    const scene = document.scenes[0];
    const el = {
      ...element(),
      id: "plate",
      // The shared fixture is only visible from 500ms; this is about blur, not
      // visibility, so it runs for the whole scene.
      timing: undefined,
      adjustments,
      animations,
    } as unknown as CreativeElement;
    return (timeMs: number) => evaluateElementAtTime(document, scene, el, timeMs);
  };

  const track = [{
    id: "focus-pull",
    property: "blurPx",
    keyframes: [
      { timeMs: 0, value: 30, easing: "linear" },
      { timeMs: 1000, value: 0, easing: "linear" },
    ],
  }];

  it("resolves blur at a moment rather than only at authoring", () => {
    const at = withBlur(track);
    expect(at(0)!.adjustments?.blurPx).toBe(30);
    expect(at(500)!.adjustments?.blurPx).toBeCloseTo(15, 6);
    expect(at(1000)!.adjustments?.blurPx).toBe(0);
  });

  it("keeps the rest of the grade the element was authored with", () => {
    const at = withBlur(track, { saturation: -0.4, vignette: 0.2 });
    const resolved = at(500)!.adjustments!;
    expect(resolved.saturation).toBe(-0.4);
    expect(resolved.vignette).toBe(0.2);
    expect(resolved.blurPx).toBeCloseTo(15, 6);
  });

  it("refuses a negative blur", () => {
    const at = withBlur([{
      id: "bad",
      property: "blurPx",
      keyframes: [
        { timeMs: 0, value: 0, easing: "linear" },
        { timeMs: 1000, value: -50, easing: "linear" },
      ],
    }]);
    expect(at(1000)!.adjustments?.blurPx).toBe(0);
  });

  it("hands back the authored block untouched when nothing animates it", () => {
    // An element that never animates its grade must keep exactly what it had,
    // so nothing downstream sees a spurious change.
    const authored = { saturation: 0.1 };
    const at = withBlur([], authored);
    expect(at(500)!.adjustments).toBe(authored);
  });

  it("has no adjustments at all when the element was authored without any", () => {
    const at = withBlur([]);
    expect(at(500)!.adjustments).toBeUndefined();
  });
});

describe("both renderers read resolved adjustments, not authored ones", () => {
  const ROOT = resolvePath(__dirname, "..", "..");
  for (const consumer of [
    "components/creative/CreativeScenePreview.tsx",
    "remotion/CreativeComposition.tsx",
  ]) {
    it(`${consumer} does not read element.adjustments`, () => {
      // Reading the authored block renders an animated blur as its starting
      // value, in whichever renderer forgot — a still that disagrees with its
      // own MP4, which is the one defect this product cannot afford.
      const source = readFileSync(resolvePath(ROOT, consumer), "utf8");
      expect(source).not.toContain("adjustments={element.adjustments}");
    });
  }
});
