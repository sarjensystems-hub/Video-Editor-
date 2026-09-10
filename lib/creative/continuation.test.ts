import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import {
  blendContinuedTransform,
  blendHierarchyTransform,
  findGroupChildMorphSource,
  findGroupContinuationInto,
  inspectGroupContinuations,
  isHeldBackByGroupContinuation,
  resolveContinuedGroupTransform,
  continuationProgress,
  findContinuationInto,
  inspectContinuations,
  sceneOverlapMs,
} from "./continuation";
import { evaluateElementAtTime } from "./evaluate";
import type { CreativeDocument, CreativeElement, CreativeScene } from "./schema";

const transform = (overrides: Record<string, number> = {}) => ({
  x: 0, y: 0, width: 200, height: 200, rotation: 0,
  opacity: 1, anchorX: 0.5, anchorY: 0.5, zIndex: 1,
  ...overrides,
});

const box = (id: string, overrides: Record<string, number> = {}): CreativeElement =>
  ({ id, name: id, type: "shape", shape: "rect", fill: { kind: "literal", value: "#fff" }, transform: transform(overrides) }) as unknown as CreativeElement;

function film(options: {
  transitionMs?: number;
  continuationMs?: number;
  orbAt?: Record<string, number>;
  hubAt?: Record<string, number>;
} = {}): CreativeDocument {
  const { transitionMs = 600, continuationMs = 600 } = options;
  const scenes: CreativeScene[] = [
    {
      id: "scene-1",
      name: "Orb",
      durationMs: 3000,
      elements: [box("orb", options.orbAt ?? { x: 100, y: 100, width: 80, height: 80 })],
      groups: [],
      transitionOut: { kind: "fade", durationMs: transitionMs, easing: "linear" },
    },
    {
      id: "scene-2",
      name: "Hub",
      durationMs: 3000,
      elements: [box("hub", options.hubAt ?? { x: 500, y: 700, width: 400, height: 400 })],
      groups: [],
    },
  ];

  return {
    version: 1,
    id: "doc",
    title: "Film",
    canvas: { width: 1080, height: 1920, fps: 30, background: { kind: "literal", value: "#000" } },
    designSystem: { colors: {}, typography: {}, spacing: {}, radii: {} },
    scenes,
    continuations: [{
      id: "orb-to-hub",
      fromSceneId: "scene-1",
      fromElementId: "orb",
      toSceneId: "scene-2",
      toElementId: "hub",
      durationMs: continuationMs,
      easing: "linear",
    }],
  } as unknown as CreativeDocument;
}

describe("continuationProgress", () => {
  const entry = film().continuations![0];

  it("runs over the head of the incoming scene", () => {
    expect(continuationProgress(entry, 0)).toBe(0);
    expect(continuationProgress(entry, 300)).toBeCloseTo(0.5, 6);
  });

  it("is over once the handoff completes", () => {
    expect(continuationProgress(entry, 600)).toBeNull();
    expect(continuationProgress(entry, 2000)).toBeNull();
  });

  it("has nothing to do with zero duration", () => {
    expect(continuationProgress({ ...entry, durationMs: 0 }, 0)).toBeNull();
  });
});

describe("blendContinuedTransform", () => {
  it("sits exactly on the source at the start, so the handoff is invisible", () => {
    const from = { ...transform({ x: 100, width: 80 }), scaleX: 1, scaleY: 1 };
    const own = { ...transform({ x: 500, width: 400 }), scaleX: 1, scaleY: 1 };
    const blended = blendContinuedTransform(from, own, 0);
    expect(blended.x).toBe(100);
    expect(blended.width).toBe(80);
  });

  it("is fully itself at the end", () => {
    const from = { ...transform({ x: 100, width: 80 }), scaleX: 1, scaleY: 1 };
    const own = { ...transform({ x: 500, width: 400 }), scaleX: 1, scaleY: 1 };
    expect(blendContinuedTransform(from, own, 1)).toEqual(own);
  });

  it("does not interpolate z-order, which has no half-way value", () => {
    const from = { ...transform({ zIndex: 0 }), scaleX: 1, scaleY: 1 };
    const own = { ...transform({ zIndex: 9 }), scaleX: 1, scaleY: 1 };
    expect(blendContinuedTransform(from, own, 0.5).zIndex).toBe(9);
  });
});

describe("evaluating a continued element", () => {
  it("enters exactly where its predecessor finished", () => {
    const document = film();
    const scene2 = document.scenes[1];
    const at0 = evaluateElementAtTime(document, scene2, scene2.elements[0], 0)!;
    expect(at0.transform.x).toBe(100);
    expect(at0.transform.y).toBe(100);
    expect(at0.transform.width).toBe(80);
  });

  it("has arrived at itself by the end of the handoff", () => {
    const document = film();
    const scene2 = document.scenes[1];
    const after = evaluateElementAtTime(document, scene2, scene2.elements[0], 600)!;
    expect(after.transform.x).toBe(500);
    expect(after.transform.y).toBe(700);
    expect(after.transform.width).toBe(400);
  });

  it("is half way across at half way through", () => {
    const document = film();
    const scene2 = document.scenes[1];
    const mid = evaluateElementAtTime(document, scene2, scene2.elements[0], 300)!;
    expect(mid.transform.x).toBeCloseTo(300, 6);
    expect(mid.transform.width).toBeCloseTo(240, 6);
  });

  it("leaves the outgoing element completely alone", () => {
    // It is still on screen through the overlap and already fading under the
    // transition; dragging it too would be two things fighting for one property.
    const document = film();
    const scene1 = document.scenes[0];
    const orb = evaluateElementAtTime(document, scene1, scene1.elements[0], 2999)!;
    expect(orb.transform.x).toBe(100);
    expect(orb.transform.width).toBe(80);
  });

  it("leaves an element with no continuation untouched", () => {
    const document = film();
    delete (document as { continuations?: unknown }).continuations;
    const scene2 = document.scenes[1];
    const at0 = evaluateElementAtTime(document, scene2, scene2.elements[0], 0)!;
    expect(at0.transform.x).toBe(500);
  });
});

describe("findContinuationInto", () => {
  it("finds the continuation feeding an element, and only that one", () => {
    const document = film();
    expect(findContinuationInto(document, "scene-2", "hub")?.id).toBe("orb-to-hub");
    expect(findContinuationInto(document, "scene-1", "orb")).toBeUndefined();
    expect(findContinuationInto(document, "scene-2", "other")).toBeUndefined();
  });
});

describe("sceneOverlapMs", () => {
  it("is the outgoing scene's transition duration", () => {
    expect(sceneOverlapMs(film({ transitionMs: 450 }), "scene-1")).toBe(450);
  });

  it("is zero for the last scene, which has nothing to overlap into", () => {
    expect(sceneOverlapMs(film(), "scene-2")).toBe(0);
  });
});

describe("inspectContinuations", () => {
  it("accepts a continuation that fits inside the overlap", () => {
    expect(inspectContinuations(film({ transitionMs: 600, continuationMs: 600 }))).toEqual([]);
  });

  it("rejects one longer than the overlap, and says which transition to lengthen", () => {
    // The most common mistake and the most invisible: without enough overlap
    // the two elements are never on screen together, and the "morph" is a cut.
    const issues = inspectContinuations(film({ transitionMs: 200, continuationMs: 600 }));
    expect(issues).toHaveLength(1);
    expect(issues[0].message).toContain("overlaps");
    expect(issues[0].message).toContain("lengthen scene-1's transitionOut");
  });

  it("rejects a boundary with no transition at all", () => {
    const document = film();
    delete document.scenes[0].transitionOut;
    expect(inspectContinuations(document)[0].message).toContain("by 0ms");
  });

  it("rejects scenes that are not adjacent", () => {
    const document = film();
    document.continuations![0].toSceneId = "scene-1";
    expect(inspectContinuations(document)[0].message).toContain("immediately after");
  });

  it("rejects an element that is not in the scene named", () => {
    const document = film();
    document.continuations![0].fromElementId = "ghost";
    expect(inspectContinuations(document)[0].message).toContain("ghost is not in scene-1");
  });

  it("rejects a handoff longer than the scene receiving it", () => {
    const document = film({ transitionMs: 5000, continuationMs: 4000 });
    expect(inspectContinuations(document)[0].message).toContain("only 3000ms long");
  });

  it("says nothing about a document with no continuations", () => {
    const document = film();
    delete (document as { continuations?: unknown }).continuations;
    expect(inspectContinuations(document)).toEqual([]);
  });
});

/**
 * Group continuation.
 *
 * The failure this exists for: the SARA film continued a disc while its label
 * stayed a separate element, so "Enterprise Knowledge" and "Sales Intelligence"
 * were both legible during the handoff. Interpolating the group transform alone
 * does not fix that — it moves them together, it does not stop them doubling.
 */
describe("group continuation", () => {
  const neutral = {
    x: 0, y: 0, scaleX: 1, scaleY: 1, rotation: 0, opacity: 1, anchorX: 0.5, anchorY: 0.5,
  };

  function clusters(options: { transitionMs?: number; durationMs?: number; mapped?: boolean } = {}) {
    const { transitionMs = 600, durationMs = 600, mapped = true } = options;
    const document = film({ transitionMs });
    document.scenes[0].elements = [box("disc-a"), box("label-a")];
    document.scenes[1].elements = [box("disc-b"), box("label-b")];
    document.scenes[0].groups = [{
      id: "knowledge", name: "Knowledge", elementIds: ["disc-a", "label-a"],
      transform: { ...neutral, x: 0, scaleX: 1 },
    }];
    document.scenes[1].groups = [{
      id: "sales", name: "Sales", elementIds: ["disc-b", "label-b"],
      transform: { ...neutral, x: 400, scaleX: 2 },
    }];
    delete (document as { continuations?: unknown }).continuations;
    (document as unknown as { groupContinuations: unknown[] }).groupContinuations = [{
      id: "knowledge-to-sales",
      fromSceneId: "scene-1", fromGroupId: "knowledge",
      toSceneId: "scene-2", toGroupId: "sales",
      durationMs, easing: "linear",
      ...(mapped ? { childMapping: [{ fromElementId: "disc-a", toElementId: "disc-b" }] } : {}),
    }];
    return document;
  }

  it("arrives as one object: the group transform blends from the outgoing one", () => {
    const document = clusters();
    const scene2 = document.scenes[1];
    expect(resolveContinuedGroupTransform(document, scene2, "sales", 0)!.x).toBe(0);
    expect(resolveContinuedGroupTransform(document, scene2, "sales", 300)!.x).toBeCloseTo(200, 6);
    expect(resolveContinuedGroupTransform(document, scene2, "sales", 300)!.scaleX).toBeCloseTo(1.5, 6);
  });

  it("hands back nothing once the handoff is over, so the group resolves normally", () => {
    const document = clusters();
    expect(resolveContinuedGroupTransform(document, document.scenes[1], "sales", 600)).toBeUndefined();
  });

  it("holds back an incoming child with no counterpart", () => {
    // This is the fix. "Sales Intelligence" has no predecessor, so it waits
    // rather than fading up beside "Enterprise Knowledge".
    const document = clusters();
    const scene2 = document.scenes[1];
    expect(isHeldBackByGroupContinuation(document, scene2, "label-b", 300)).toBe(true);
    expect(isHeldBackByGroupContinuation(document, scene2, "label-b", 600)).toBe(false);
  });

  it("keeps a mapped child visible throughout, since it has something to hand off from", () => {
    const document = clusters();
    expect(isHeldBackByGroupContinuation(document, document.scenes[1], "disc-b", 300)).toBe(false);
  });

  it("holds every child back when no mapping is given at all", () => {
    // Without a mapping nothing has a declared predecessor, so the whole
    // incoming cluster waits and the outgoing one carries the overlap.
    const document = clusters({ mapped: false });
    const scene2 = document.scenes[1];
    expect(isHeldBackByGroupContinuation(document, scene2, "disc-b", 300)).toBe(true);
    expect(isHeldBackByGroupContinuation(document, scene2, "label-b", 300)).toBe(true);
  });

  it("leaves elements outside a continuing group alone", () => {
    const document = clusters();
    expect(isHeldBackByGroupContinuation(document, document.scenes[0], "disc-a", 300)).toBe(false);
  });

  it("actually removes the element from an evaluated scene", () => {
    // The end-to-end property: both renderers read evaluateElementAtTime, so a
    // held-back child is absent from the frame in each of them.
    const document = clusters();
    const scene2 = document.scenes[1];
    const label = scene2.elements.find((element) => element.id === "label-b")!;
    expect(evaluateElementAtTime(document, scene2, label, 300)).toBeNull();
    expect(evaluateElementAtTime(document, scene2, label, 700)).not.toBeNull();
  });

  it("finds the continuation feeding a group, and only that one", () => {
    const document = clusters();
    expect(findGroupContinuationInto(document, "scene-2", "sales")?.id).toBe("knowledge-to-sales");
    expect(findGroupContinuationInto(document, "scene-1", "knowledge")).toBeUndefined();
  });
});

/**
 * v2: childMapping can carry geometry, not just visibility.
 *
 * The v1 fix stopped a label doubling up during a group handoff by holding
 * unmapped children back. It never made a mapped child actually rearrange —
 * the group wrapper moved as one block and every child sat wherever it was
 * authored the instant the group finished blending. A cluster whose members
 * swap places (a metric card promoted to the lead position, say) still read
 * as a slide of the whole group followed by a snap. morphGeometry is what
 * makes the individual child travel too.
 */
describe("group continuation v2: mapped-child geometry morph", () => {
  const neutral = {
    x: 0, y: 0, scaleX: 1, scaleY: 1, rotation: 0, opacity: 1, anchorX: 0.5, anchorY: 0.5,
  };

  /**
   * disc-a and disc-b sit at different local positions and the group
   * transform itself is left neutral, so a passing assertion can only be
   * explained by the CHILD's own transform moving — not the wrapper around
   * it, which resolveContinuedGroupTransform already covers on its own.
   */
  function morphingClusters(options: { transitionMs?: number; durationMs?: number; morph?: boolean } = {}) {
    const { transitionMs = 600, durationMs = 600, morph = true } = options;
    const document = film({ transitionMs });
    document.scenes[0].elements = [box("disc-a", { x: 0, y: 0, width: 80, height: 80 }), box("label-a")];
    document.scenes[1].elements = [box("disc-b", { x: 300, y: 150, width: 160, height: 160 }), box("label-b")];
    document.scenes[0].groups = [{ id: "knowledge", name: "Knowledge", elementIds: ["disc-a", "label-a"], transform: { ...neutral } }];
    document.scenes[1].groups = [{ id: "sales", name: "Sales", elementIds: ["disc-b", "label-b"], transform: { ...neutral } }];
    delete (document as { continuations?: unknown }).continuations;
    (document as unknown as { groupContinuations: unknown[] }).groupContinuations = [{
      id: "knowledge-to-sales",
      fromSceneId: "scene-1", fromGroupId: "knowledge",
      toSceneId: "scene-2", toGroupId: "sales",
      durationMs, easing: "linear",
      childMapping: [{ fromElementId: "disc-a", toElementId: "disc-b", ...(morph ? { morphGeometry: true } : {}) }],
    }];
    return document;
  }

  it("sits exactly on its predecessor's resolved geometry at the window's start", () => {
    const document = morphingClusters();
    const scene2 = document.scenes[1];
    const discB = scene2.elements.find((element) => element.id === "disc-b")!;
    const at0 = evaluateElementAtTime(document, scene2, discB, 0)!;
    expect(at0.transform.x).toBe(0);
    expect(at0.transform.y).toBe(0);
    expect(at0.transform.width).toBe(80);
  });

  it("is half way between predecessor and self at the window's middle", () => {
    const document = morphingClusters();
    const scene2 = document.scenes[1];
    const discB = scene2.elements.find((element) => element.id === "disc-b")!;
    const mid = evaluateElementAtTime(document, scene2, discB, 300)!;
    expect(mid.transform.x).toBeCloseTo(150, 6);
    expect(mid.transform.y).toBeCloseTo(75, 6);
    expect(mid.transform.width).toBeCloseTo(120, 6);
  });

  it("has arrived at its own authored geometry by the window's end", () => {
    const document = morphingClusters();
    const scene2 = document.scenes[1];
    const discB = scene2.elements.find((element) => element.id === "disc-b")!;
    const end = evaluateElementAtTime(document, scene2, discB, 600)!;
    expect(end.transform.x).toBe(300);
    expect(end.transform.width).toBe(160);
  });

  it("leaves geometry alone when the pair does not opt in - v1's exact behaviour", () => {
    // Still mapped, so still visible (isHeldBackByGroupContinuation is
    // untouched by this feature) - but its own position never left home. The
    // group carries it; without morphGeometry it does not carry itself.
    const document = morphingClusters({ morph: false });
    const scene2 = document.scenes[1];
    const discB = scene2.elements.find((element) => element.id === "disc-b")!;
    const mid = evaluateElementAtTime(document, scene2, discB, 300)!;
    expect(mid.transform.x).toBe(300);
    expect(mid.transform.width).toBe(160);
  });

  it("does not disturb an unmapped sibling's held-back visibility", () => {
    // morphGeometry on one pair must not leak into how a different, unmapped
    // child is judged - label-b has no pair at all and waits exactly as v1.
    const document = morphingClusters();
    const scene2 = document.scenes[1];
    const labelB = scene2.elements.find((element) => element.id === "label-b")!;
    expect(evaluateElementAtTime(document, scene2, labelB, 300)).toBeNull();
    expect(evaluateElementAtTime(document, scene2, labelB, 600)).not.toBeNull();
  });

  it("leaves a continuation with no childMapping at all identical to before this field existed", () => {
    const document = morphingClusters({ morph: false });
    (document as unknown as { groupContinuations: Array<Record<string, unknown>> }).groupContinuations[0].childMapping = undefined;
    const scene2 = document.scenes[1];
    const discB = scene2.elements.find((element) => element.id === "disc-b")!;
    // Unmapped now, so held back rather than rendered at all - the same
    // v1 rule this feature does not touch.
    expect(evaluateElementAtTime(document, scene2, discB, 300)).toBeNull();
  });

  it("gives an explicit continue_element priority over a morphGeometry pair naming the same element", () => {
    // Different easing from the group's own (ease-out vs. the group
    // continuation's linear) so the two paths cannot coincidentally agree -
    // only the explicit continuation's own curve explains the result.
    const document = morphingClusters();
    document.continuations = [{
      id: "disc-direct",
      fromSceneId: "scene-1", fromElementId: "disc-a",
      toSceneId: "scene-2", toElementId: "disc-b",
      durationMs: 600, easing: "ease-out",
    }];
    const scene2 = document.scenes[1];
    const discB = scene2.elements.find((element) => element.id === "disc-b")!;
    const mid = evaluateElementAtTime(document, scene2, discB, 300)!;
    // ease-out(0.5) = 0.75, so x = lerp(0, 300, 0.75) = 225 - not the 150
    // the group continuation's own linear window would have produced.
    expect(mid.transform.x).toBeCloseTo(225, 6);
  });

  describe("findGroupChildMorphSource", () => {
    it("returns the source, and the group's own progress, for an opted-in pair", () => {
      const document = morphingClusters();
      const scene2 = document.scenes[1];
      const found = findGroupChildMorphSource(document, scene2, "disc-b", 300);
      expect(found).toEqual({ fromSceneId: "scene-1", fromElementId: "disc-a", progress: 0.5 });
    });

    it("finds nothing for a mapped pair that left morphGeometry off", () => {
      const document = morphingClusters({ morph: false });
      const scene2 = document.scenes[1];
      expect(findGroupChildMorphSource(document, scene2, "disc-b", 300)).toBeUndefined();
    });

    it("finds nothing once the handoff is over", () => {
      const document = morphingClusters();
      const scene2 = document.scenes[1];
      expect(findGroupChildMorphSource(document, scene2, "disc-b", 600)).toBeUndefined();
    });

    it("finds nothing for an element outside any continuing group", () => {
      const document = morphingClusters();
      const scene1 = document.scenes[0];
      expect(findGroupChildMorphSource(document, scene1, "disc-a", 300)).toBeUndefined();
    });
  });
});

describe("blendHierarchyTransform", () => {
  const neutral = { x: 0, y: 0, scaleX: 1, scaleY: 1, rotation: 0, opacity: 1, anchorX: 0.5, anchorY: 0.5 };

  it("moves the pivot too, so the motion arcs rather than snapping", () => {
    const blended = blendHierarchyTransform(
      { ...neutral, anchorX: 0 },
      { ...neutral, anchorX: 1 },
      0.5,
    );
    expect(blended.anchorX).toBeCloseTo(0.5, 6);
  });
});

describe("inspectGroupContinuations", () => {
  const neutral = { x: 0, y: 0, scaleX: 1, scaleY: 1, rotation: 0, opacity: 1, anchorX: 0.5, anchorY: 0.5 };

  const withGroups = (transitionMs: number, durationMs: number, opts: { transforms?: boolean } = {}) => {
    const { transforms = true } = opts;
    const document = film({ transitionMs });
    document.scenes[0].groups = [{ id: "a", name: "A", elementIds: ["orb"], ...(transforms ? { transform: neutral } : {}) }];
    document.scenes[1].groups = [{ id: "b", name: "B", elementIds: ["hub"], ...(transforms ? { transform: neutral } : {}) }];
    delete (document as { continuations?: unknown }).continuations;
    (document as unknown as { groupContinuations: unknown[] }).groupContinuations = [{
      id: "a-to-b", fromSceneId: "scene-1", fromGroupId: "a",
      toSceneId: "scene-2", toGroupId: "b", durationMs, easing: "linear",
    }];
    return document;
  };

  it("accepts one that fits inside the overlap", () => {
    expect(inspectGroupContinuations(withGroups(600, 600))).toEqual([]);
  });

  it("uses the same overlap rule as continue_element", () => {
    const issues = inspectGroupContinuations(withGroups(200, 600));
    expect(issues[0].message).toContain("overlaps scene-2 by 200ms");
    expect(issues[0].message).toContain("scene-1's transitionOut");
  });

  it("requires a transform on both ends, since that is what carries the motion", () => {
    const issues = inspectGroupContinuations(withGroups(600, 600, { transforms: false }));
    expect(issues[0].message).toContain("set_group_transform");
  });

  it("rejects a mapped child that is not in the group named", () => {
    const document = withGroups(600, 600);
    (document as unknown as { groupContinuations: Array<Record<string, unknown>> })
      .groupContinuations[0].childMapping = [{ fromElementId: "ghost", toElementId: "hub" }];
    expect(inspectGroupContinuations(document)[0].message).toContain("ghost is not in group a");
  });

  it("rejects the same way when the offending pair also asks for morphGeometry", () => {
    // A group's elementIds are scene-scoped, so naming an id from the wrong
    // scene fails membership either way - opting into geometry does not open
    // a second, looser path past the same check.
    const document = withGroups(600, 600);
    (document as unknown as { groupContinuations: Array<Record<string, unknown>> })
      .groupContinuations[0].childMapping = [{ fromElementId: "ghost", toElementId: "hub", morphGeometry: true }];
    expect(inspectGroupContinuations(document)[0].message).toContain("ghost is not in group a");
  });
});

/**
 * The mask and hierarchy bugs were a property this kind of module resolved
 * and only one renderer applied. A morphing group child that rearranged in
 * the editor and snapped in the exported MP4 would be the same class of
 * defect, so the guard is a negative: neither renderer may know childMapping
 * or morphGeometry exist at all. The blend happens exactly once, inside
 * evaluateElementAtTime, and both renderers already read every property of
 * the transform it returns - see "both renderers read resolved adjustments"
 * in evaluate.test.ts and the hierarchy transform guard in hierarchy.test.ts
 * for the same shape of check on this module's neighbours.
 */
describe("both renderers resolve a morphing group child through evaluateElementAtTime, not their own logic", () => {
  const ROOT = resolve(__dirname, "..", "..");
  const CONSUMERS = [
    "components/creative/CreativeScenePreview.tsx",
    "remotion/CreativeComposition.tsx",
  ];

  for (const consumer of CONSUMERS) {
    it(`${consumer} never reads childMapping or morphGeometry itself`, () => {
      const source = readFileSync(resolve(ROOT, consumer), "utf8");
      expect(source).not.toContain("childMapping");
      expect(source).not.toContain("morphGeometry");
    });
  }
});
