import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import {
  createNeutralHierarchyTransform,
  findOwningGroup,
  hierarchyTransformCss,
  isNeutralHierarchyTransform,
  resolveCameraCss,
  resolveGroupCss,
  resolveHierarchyTransform,
  transformingGroups,
} from "./hierarchy";
import type { CreativeGroup, ElementAnimation } from "./schema";

const track = (property: ElementAnimation["property"], from: number, to: number): ElementAnimation => ({
  id: `${property}-track`,
  property,
  keyframes: [
    { timeMs: 0, value: from, easing: "linear" },
    { timeMs: 1000, value: to, easing: "linear" },
  ],
});

describe("resolveHierarchyTransform", () => {
  it("returns the base transform when nothing animates", () => {
    const base = createNeutralHierarchyTransform();
    expect(resolveHierarchyTransform(base, undefined, 500)).toEqual(base);
  });

  it("animates through the same keyframes and easing an element would", () => {
    const base = createNeutralHierarchyTransform();
    const resolved = resolveHierarchyTransform(base, [track("scaleX", 1, 2), track("scaleY", 1, 2)], 500);
    expect(resolved.scaleX).toBeCloseTo(1.5, 6);
    expect(resolved.scaleY).toBeCloseTo(1.5, 6);
  });

  it("clamps opacity and refuses a negative scale", () => {
    const base = createNeutralHierarchyTransform();
    const resolved = resolveHierarchyTransform(base, [track("opacity", 1, 4), track("scaleX", 1, -3)], 1000);
    expect(resolved.opacity).toBe(1);
    expect(resolved.scaleX).toBe(0);
  });

  it("ignores a track for something a camera does not own", () => {
    // The animation vocabulary is shared with elements. An agent reusing a
    // preset that carries a crop track should not have the whole move rejected.
    const base = createNeutralHierarchyTransform();
    expect(() => resolveHierarchyTransform(base, [track("cropX", 0, 1)], 500)).not.toThrow();
    expect(resolveHierarchyTransform(base, [track("cropX", 0, 1)], 500)).toEqual(base);
  });
});

describe("hierarchyTransformCss", () => {
  it("costs nothing when the transform would change nothing", () => {
    // A document with no camera has to render the markup it always rendered.
    expect(hierarchyTransformCss(createNeutralHierarchyTransform())).toBeUndefined();
  });

  it("scales and rotates about the canvas-relative pivot", () => {
    const css = hierarchyTransformCss({
      ...createNeutralHierarchyTransform(),
      scaleX: 1.4,
      scaleY: 1.4,
      anchorX: 0.25,
      anchorY: 0.75,
    })!;
    expect(css.transformOrigin).toBe("25% 75%");
    expect(css.transform).toContain("scale(1.4, 1.4)");
  });

  it("orders the operations translate, rotate, scale", () => {
    // CSS applies transform functions right to left, so this string is the
    // conventional scale-then-rotate-then-translate. Reversing it would
    // translate in scaled units and a push-in would travel the wrong distance.
    const css = hierarchyTransformCss({
      ...createNeutralHierarchyTransform(),
      x: 120,
      rotation: 8,
      scaleX: 2,
      scaleY: 2,
    })!;
    expect(css.transform).toBe("translate(120px, 0px) rotate(8deg) scale(2, 2)");
  });

  it("clamps a pivot outside the canvas rather than emitting broken CSS", () => {
    const css = hierarchyTransformCss({
      ...createNeutralHierarchyTransform(),
      scaleX: 2,
      anchorX: -3,
      anchorY: 9,
    })!;
    expect(css.transformOrigin).toBe("0% 100%");
  });

  it("treats opacity alone as worth a wrapper", () => {
    const css = hierarchyTransformCss({ ...createNeutralHierarchyTransform(), opacity: 0.4 });
    expect(css?.opacity).toBe(0.4);
  });
});

describe("isNeutralHierarchyTransform", () => {
  it("ignores the pivot, which changes nothing on its own", () => {
    // An anchor with no scale or rotation to pivot about is not a change.
    expect(
      isNeutralHierarchyTransform({ ...createNeutralHierarchyTransform(), anchorX: 0.1, anchorY: 0.9 }),
    ).toBe(true);
  });
});

describe("resolveCameraCss", () => {
  it("is undefined without a camera", () => {
    expect(resolveCameraCss(undefined, 0)).toBeUndefined();
  });

  it("resolves a push-in over time", () => {
    const camera = {
      transform: createNeutralHierarchyTransform(),
      animations: [track("scaleX", 1, 1.5), track("scaleY", 1, 1.5)],
    };
    expect(resolveCameraCss(camera, 0)).toBeUndefined();
    expect(resolveCameraCss(camera, 1000)!.transform).toContain("scale(1.5, 1.5)");
  });
});

describe("groups", () => {
  const group = (overrides: Partial<CreativeGroup> = {}): CreativeGroup => ({
    id: "cluster",
    name: "Cluster",
    elementIds: ["orb", "node-1"],
    ...overrides,
  });

  it("leaves an organisational group alone", () => {
    // Every group predating this feature has no transform and must stay inert.
    expect(resolveGroupCss(group(), 0)).toBeUndefined();
  });

  it("resolves a group that carries a transform", () => {
    const moved = group({ transform: { ...createNeutralHierarchyTransform(), x: 40 } });
    expect(resolveGroupCss(moved, 0)!.transform).toContain("translate(40px, 0px)");
  });

  it("finds the group owning an element, and only a transforming one", () => {
    const organisational = group({ id: "labels", elementIds: ["orb"] });
    const moved = group({ id: "cluster", elementIds: ["orb"], transform: createNeutralHierarchyTransform() });
    expect(findOwningGroup([organisational, moved], "orb")?.id).toBe("cluster");
    expect(findOwningGroup([organisational], "orb")).toBeUndefined();
    expect(findOwningGroup([moved], "missing")).toBeUndefined();
  });

  it("skips a hidden group, which renders nothing to transform", () => {
    const hidden = group({ transform: createNeutralHierarchyTransform(), hidden: true });
    expect(transformingGroups([hidden])).toEqual([]);
  });

  it("lists transforming groups in document order", () => {
    const a = group({ id: "a", transform: createNeutralHierarchyTransform() });
    const plain = group({ id: "plain" });
    const b = group({ id: "b", transform: createNeutralHierarchyTransform() });
    expect(transformingGroups([a, plain, b]).map((g) => g.id)).toEqual(["a", "b"]);
  });
});

/**
 * The mask bug was a property this kind of module resolved and only one
 * renderer applied. A camera that pushed in on the preview and sat still in the
 * export would be the same class of defect, wearing a bigger coat.
 */
describe("both renderers apply the whole resolved hierarchy transform", () => {
  const ROOT = resolve(__dirname, "..", "..");
  const CONSUMERS = [
    "components/creative/CreativeScenePreview.tsx",
    "remotion/CreativeComposition.tsx",
  ];

  const resolvedKeys = Object.keys(
    hierarchyTransformCss({ ...createNeutralHierarchyTransform(), scaleX: 2 })!,
  );

  it("resolves the keys this test polices", () => {
    expect(resolvedKeys.sort()).toEqual(["filter", "opacity", "transform", "transformOrigin"]);
  });

  for (const consumer of CONSUMERS) {
    it(`${consumer} applies every resolved property`, () => {
      const source = readFileSync(resolve(ROOT, consumer), "utf8");
      for (const key of resolvedKeys) {
        expect(source, `${consumer} never reads css.${key}`).toContain(`css.${key}`);
      }
    });

    it(`${consumer} applies both the camera and group transforms`, () => {
      // A renderer honouring only one of the two would look correct on most
      // documents and be wrong on exactly the ones this feature is for.
      const source = readFileSync(resolve(ROOT, consumer), "utf8");
      expect(source).toContain("resolveCameraCss");
      expect(source).toContain("resolveGroupCss");
      expect(source).toContain("findOwningGroup");
    });
  }
});
