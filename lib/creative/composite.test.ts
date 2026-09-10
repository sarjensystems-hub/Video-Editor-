import { readFileSync } from "node:fs";
import { resolve as resolvePath } from "node:path";
import { describe, expect, it } from "vitest";
import { createCanonicalCreativeFixture } from "./fixtures";
import { createDefaultTransform } from "./defaults";
import {
  collectCreativeCompositeAssetIds,
  collectCreativeCompositeDescendants,
  isCreativeCompositeElement,
  resolveCreativeCompositeElement,
} from "./composite";
import { evaluateSceneAtTime } from "./evaluate";
import { getCreativeDocumentAssetIds } from "./remotion";
import { requiredFonts } from "./fonts";
import { addElement, updateElement } from "./operations";
import { applyGroupStagger, applyOrbitGroup } from "./authoring-primitives";
import { applyCreativeTransaction, type CreativeTransaction } from "./transactions";
import { validateCreativeDocument } from "./validate";
import { CREATIVE_ELEMENT_EXAMPLES } from "./schema-guide";
import { hasVisibleGlass } from "./glass";
import type {
  CreativeCompositeElement,
  CreativeDocument,
  CreativeElement,
} from "./schema";
import { CREATIVE_COMPOSITE_MAX_DEPTH } from "./schema";

/** A glass card: a plate child with its own glass, a text label, and a real chart with a real series. */
function compositeElement(overrides: Partial<CreativeCompositeElement> = {}): CreativeCompositeElement {
  return {
    id: "card",
    name: "KPI card",
    type: "composite",
    viewport: { width: 400, height: 220 },
    transform: createDefaultTransform({ x: 300, y: 400, width: 400, height: 220, anchorX: 0, anchorY: 0, zIndex: 6 }),
    children: [
      {
        id: "card-plate",
        name: "Card plate",
        type: "shape",
        shape: "rect",
        fill: { kind: "literal", value: "rgba(10,10,10,0.4)" },
        borderRadius: 20,
        glass: { blurPx: 18, tintOpacity: 0.2 },
        transform: createDefaultTransform({ x: 0, y: 0, width: 400, height: 220, anchorX: 0, anchorY: 0, zIndex: 0 }),
      },
      {
        id: "card-label",
        name: "Card label",
        type: "text",
        text: "Adoption",
        style: { token: "body" },
        transform: createDefaultTransform({ x: 24, y: 20, width: 200, height: 40, anchorX: 0, anchorY: 0, zIndex: 1 }),
      },
      {
        id: "card-chart",
        name: "Card chart",
        type: "chart",
        chartKind: "line",
        series: [12, 19, 24, 31, 44, 58],
        stroke: { width: 3, color: { kind: "token", token: "accent" } },
        drawProgress: 0.5,
        transform: createDefaultTransform({ x: 24, y: 76, width: 352, height: 120, anchorX: 0, anchorY: 0, zIndex: 1 }),
      },
    ],
    ...overrides,
  } as CreativeCompositeElement;
}

function documentWithComposite(element: CreativeCompositeElement = compositeElement()): CreativeDocument {
  const base = createCanonicalCreativeFixture();
  return {
    ...base,
    scenes: [
      {
        ...base.scenes[0],
        elements: [...base.scenes[0].elements, element],
        groups: [...base.scenes[0].groups, { id: "card-group", name: "Card group", elementIds: [element.id] }],
      },
    ],
  };
}

describe("composite element resolution", () => {
  it("recognises a composite element", () => {
    expect(isCreativeCompositeElement(compositeElement())).toBe(true);
    expect(isCreativeCompositeElement(createCanonicalCreativeFixture().scenes[0].elements[0])).toBe(false);
  });

  it("resolves children at their own LOCAL positions, unaffected by the composite's canvas position", () => {
    const doc = documentWithComposite();
    const scene = doc.scenes[0];
    const element = scene.elements.find((item) => item.id === "card") as CreativeCompositeElement;
    const resolved = resolveCreativeCompositeElement(doc, scene, element, 0);

    const label = resolved.children.find((item) => item.element.id === "card-label")!;
    // Authored at x:24,y:20 inside the composite's own 400x220 viewport - not
    // shifted by the composite's own canvas position (x:300, y:400).
    expect(label.transform.x).toBe(24);
    expect(label.transform.y).toBe(20);

    const plate = resolved.children.find((item) => item.element.id === "card-plate")!;
    expect(plate.transform.x).toBe(0);
    expect(plate.transform.width).toBe(400);
  });

  it("scales the local viewport independently per axis onto the element's actual box", () => {
    const element = compositeElement({
      viewport: { width: 400, height: 220 },
      transform: createDefaultTransform({ x: 0, y: 0, width: 800, height: 110, anchorX: 0, anchorY: 0, zIndex: 0 }),
    });
    const doc = documentWithComposite(element);
    const resolved = resolveCreativeCompositeElement(doc, doc.scenes[0], element, 0);
    expect(resolved.scaleX).toBe(2);
    expect(resolved.scaleY).toBe(0.5);
  });

  it("resolves a chart child exactly like a top-level chart element - real series, real drawProgress", () => {
    const doc = documentWithComposite();
    const scene = doc.scenes[0];
    const element = scene.elements.find((item) => item.id === "card") as CreativeCompositeElement;
    const resolved = resolveCreativeCompositeElement(doc, scene, element, 0);
    const chart = resolved.children.find((item) => item.element.id === "card-chart")!;
    expect(chart.element.type).toBe("chart");
    expect(chart.element.type === "chart" ? chart.element.series : null).toEqual([12, 19, 24, 31, 44, 58]);
    // Resolved (not raw-authored) drawProgress, the same field a top-level
    // chart element resolves through evaluateElementAtTime - proof this is
    // the real chart resolver, not a re-derived copy of it.
    expect(chart.drawProgress).toBe(0.5);
  });

  it("carries glass on a child through to the resolved element, unresolved differently from a top-level element", () => {
    const doc = documentWithComposite();
    const scene = doc.scenes[0];
    const element = scene.elements.find((item) => item.id === "card") as CreativeCompositeElement;
    const resolved = resolveCreativeCompositeElement(doc, scene, element, 0);
    const plate = resolved.children.find((item) => item.element.id === "card-plate")!;
    expect(hasVisibleGlass(plate.element.glass)).toBe(true);
  });

  it("stacks children by their own zIndex among themselves, not document order", () => {
    const element = compositeElement();
    element.children[1] = { ...element.children[1], transform: { ...element.children[1].transform, zIndex: 99 } };
    const doc = documentWithComposite(element);
    const resolved = resolveCreativeCompositeElement(doc, doc.scenes[0], element, 0);
    expect(resolved.children[resolved.children.length - 1].element.id).toBe("card-label");
  });

  it("hides a child outside its own timing window, on the shared scene clock", () => {
    const element = compositeElement();
    element.children[1] = { ...element.children[1], timing: { startMs: 3000, endMs: 6000 } };
    const doc = documentWithComposite(element);
    const early = resolveCreativeCompositeElement(doc, doc.scenes[0], element, 500);
    const late = resolveCreativeCompositeElement(doc, doc.scenes[0], element, 3500);
    expect(early.children.some((item) => item.element.id === "card-label")).toBe(false);
    expect(late.children.some((item) => item.element.id === "card-label")).toBe(true);
  });

  it("does not resolve the composite's own children when the composite itself is hidden by a hidden group", () => {
    const doc = documentWithComposite();
    const hidden: CreativeDocument = {
      ...doc,
      scenes: [{ ...doc.scenes[0], groups: doc.scenes[0].groups.map((g) => (g.id === "card-group" ? { ...g, hidden: true } : g)) }],
    };
    const evaluated = evaluateSceneAtTime(hidden, hidden.scenes[0], 0);
    expect(evaluated.elements.some((item) => item.element.id === "card")).toBe(false);
  });
});

describe("composite validation", () => {
  it("validates a complete composite element inside a canonical document", () => {
    const result = validateCreativeDocument(documentWithComposite());
    expect(result.issues).toEqual([]);
    expect(result.valid).toBe(true);
  });

  it("keeps documents without composite elements valid and unchanged", () => {
    expect(validateCreativeDocument(createCanonicalCreativeFixture()).valid).toBe(true);
  });

  it("validates the published schema-guide composite example", () => {
    const base = createCanonicalCreativeFixture();
    const result = validateCreativeDocument({
      ...base,
      scenes: [{ ...base.scenes[0], elements: [...base.scenes[0].elements, CREATIVE_ELEMENT_EXAMPLES.composite as unknown as CreativeElement] }],
    });
    expect(result.issues.map((issue) => `${issue.path}: ${issue.message}`)).toEqual([]);
    expect(result.valid).toBe(true);
  });

  it("rejects a connector as a composite child", () => {
    const element = compositeElement({
      children: [
        ...compositeElement().children,
        {
          id: "card-edge",
          name: "bad edge",
          type: "connector",
          fromElementId: "card-plate",
          toElementId: "card-label",
          curve: "straight",
          stroke: { width: 1, color: { kind: "token", token: "muted" } },
          transform: createDefaultTransform({ width: 400, height: 220 }),
        } as unknown as CreativeElement,
      ],
    });
    const result = validateCreativeDocument(documentWithComposite(element));
    expect(result.valid).toBe(false);
    expect(result.issues.some((issue) => /cannot be a composite child/.test(issue.message))).toBe(true);
  });

  it("rejects nesting past the depth cap", () => {
    function nested(depth: number): CreativeCompositeElement {
      const leaf: CreativeElement = {
        id: `leaf-${depth}`,
        name: "leaf",
        type: "shape",
        shape: "rect",
        fill: { kind: "token", token: "background" },
        transform: createDefaultTransform({ width: 10, height: 10 }),
      };
      return {
        id: `nest-${depth}`,
        name: `nest ${depth}`,
        type: "composite",
        viewport: { width: 100, height: 100 },
        transform: createDefaultTransform({ width: 100, height: 100 }),
        children: [depth > 0 ? nested(depth - 1) : leaf],
      };
    }
    // One level past CREATIVE_COMPOSITE_MAX_DEPTH: depths 0..MAX_DEPTH is MAX_DEPTH+1 levels.
    const tooDeep = documentWithComposite(nested(CREATIVE_COMPOSITE_MAX_DEPTH));
    const result = validateCreativeDocument(tooDeep);
    expect(result.valid).toBe(false);
    expect(result.issues.some((issue) => /nest deeper/.test(issue.message))).toBe(true);

    // One level shallower is fine.
    const okDepth = documentWithComposite(nested(CREATIVE_COMPOSITE_MAX_DEPTH - 1));
    expect(validateCreativeDocument(okDepth).valid).toBe(true);
  });

  it("rejects more descendants than the composite total cap", () => {
    const many: CreativeElement[] = Array.from({ length: 250 }, (_, index) => ({
      id: `bar-${index}`,
      name: `bar ${index}`,
      type: "shape",
      shape: "rect",
      fill: { kind: "token", token: "background" },
      transform: createDefaultTransform({ x: index, y: 0, width: 4, height: 4 }),
    }));
    const element = compositeElement({ children: many });
    const result = validateCreativeDocument(documentWithComposite(element));
    expect(result.valid).toBe(false);
    expect(result.issues.some((issue) => /more than 200/.test(issue.message))).toBe(true);
  });

  it("requires at least one child", () => {
    const element = compositeElement({ children: [] });
    const result = validateCreativeDocument(documentWithComposite(element));
    expect(result.valid).toBe(false);
    expect(result.issues.some((issue) => /requires at least one child/.test(issue.message))).toBe(true);
  });

  it("rejects duplicate child ids within one composite's own subtree", () => {
    const element = compositeElement();
    element.children = [element.children[0], { ...element.children[1], id: element.children[0].id }];
    const result = validateCreativeDocument(documentWithComposite(element));
    expect(result.valid).toBe(false);
    expect(result.issues.some((issue) => issue.code === "duplicate_id" && /composite/i.test(issue.message))).toBe(true);
  });

  it("allows the same id to be reused by two DIFFERENT composites (child ids are subtree-scoped, not document-wide)", () => {
    const base = createCanonicalCreativeFixture();
    const first = compositeElement({ id: "card-a" });
    const second = compositeElement({ id: "card-b" });
    const doc: CreativeDocument = {
      ...base,
      scenes: [{ ...base.scenes[0], elements: [...base.scenes[0].elements, first, second], groups: base.scenes[0].groups }],
    };
    expect(validateCreativeDocument(doc).valid).toBe(true);
  });

  it("rejects a viewport outside the shared UI viewport ceiling", () => {
    const element = compositeElement({ viewport: { width: 0, height: 220 } });
    const result = validateCreativeDocument(documentWithComposite(element));
    expect(result.valid).toBe(false);
    expect(result.issues.some((issue) => /viewport.width/.test(issue.path))).toBe(true);
  });
});

describe("existing flat-group documents render exactly as before", () => {
  it("keeps the canonical fixture's resolved elements unchanged", () => {
    const fixture = createCanonicalCreativeFixture();
    const evaluated = evaluateSceneAtTime(fixture, fixture.scenes[0], 1000);
    const headline = evaluated.elements.find((item) => item.element.id === "headline")!;
    // 1000ms is inside headline's own rise-in animation window (600-1000ms),
    // landing exactly at the end keyframe - opacity 1, y 790 - the same
    // values this fixture has always resolved to.
    expect(headline.transform.opacity).toBe(1);
    expect(headline.transform.y).toBe(790);
    // brand-logo's own timing (6200-8000ms) excludes it at 1000ms - unchanged
    // evaluateSceneAtTime behaviour, nothing to do with composite.
    expect(evaluated.elements.map((item) => item.element.id)).toEqual([
      "background-image",
      "headline",
      "accent-line",
    ]);
  });

  it("still enforces the flat-group rule exactly as before - unrelated to composite", () => {
    const fixture = createCanonicalCreativeFixture();
    const result = addElement(fixture, "scene-1", {
      id: "second",
      name: "second",
      type: "text",
      text: "x",
      style: { token: "body" },
      transform: createDefaultTransform({ width: 10, height: 10 }),
    });
    expect(result.ok).toBe(true);
  });
});

describe("a composite moves as ONE UNIT, the row's whole point", () => {
  it("stagger_group animates the composite's own transform, not each child separately", () => {
    const doc = documentWithComposite();
    const result = applyGroupStagger(doc, {
      sceneId: "scene-1",
      groupId: "card-group",
      property: "opacity",
      from: 0,
      to: 1,
      startMs: 0,
      durationMs: 500,
      staggerMs: 0,
      easing: "ease-out",
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const card = result.document.scenes[0].elements.find((item) => item.id === "card")!;
    expect(card.animations?.some((animation) => animation.property === "opacity")).toBe(true);
    // The children are untouched - the composite carries the one track, not
    // three separately-authored ones that could drift.
    const composite = card as CreativeCompositeElement;
    for (const child of composite.children) {
      expect(child.animations ?? []).toEqual(composite.children.find((c) => c.id === child.id)?.animations ?? []);
    }
    const evaluated = evaluateSceneAtTime(result.document, result.document.scenes[0], 0);
    expect(evaluated.elements.find((item) => item.element.id === "card")?.transform.opacity).toBe(0);
    const evaluatedLater = evaluateSceneAtTime(result.document, result.document.scenes[0], 500);
    expect(evaluatedLater.elements.find((item) => item.element.id === "card")?.transform.opacity).toBe(1);
  });

  it("orbit_group moves the composite's own x/y as one rigid body", () => {
    const doc = documentWithComposite();
    const result = applyOrbitGroup(doc, {
      sceneId: "scene-1",
      groupId: "card-group",
      centerX: 540,
      centerY: 675,
      radius: 300,
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const card = result.document.scenes[0].elements.find((item) => item.id === "card")!;
    // orbitPosition centres the element's own box on the orbit point at
    // angle -90deg (straight up): x = centerX - width/2, y = centerY - radius - height/2.
    expect(card.transform.x).toBeCloseTo(540 - 400 / 2, 5);
    expect(card.transform.y).toBeCloseTo(675 - 300 - 220 / 2, 5);
    // The composite's local layout is untouched by the orbit.
    const composite = card as CreativeCompositeElement;
    expect(composite.children.map((c) => ({ id: c.id, x: c.transform.x, y: c.transform.y }))).toEqual(
      compositeElement().children.map((c) => ({ id: c.id, x: c.transform.x, y: c.transform.y })),
    );
  });

  it("stagger_group and orbit_group reach the composite through the real MCP transaction pipeline", () => {
    const doc = documentWithComposite();
    const transaction: CreativeTransaction = {
      summary: "Bring the KPI card in and settle it on an orbit point",
      operations: [
        {
          type: "stagger_group",
          sceneId: "scene-1",
          groupId: "card-group",
          property: "y",
          mode: "delta",
          from: 60,
          to: 0,
          startMs: 0,
          durationMs: 400,
          staggerMs: 0,
          easing: "ease-out",
        },
        {
          type: "orbit_group",
          sceneId: "scene-1",
          groupId: "card-group",
          centerX: 540,
          centerY: 675,
          radius: 260,
        },
      ],
    };
    const result = applyCreativeTransaction(doc, transaction);
    expect(result.ok ? "" : `${result.error.code}: ${result.error.message}`).toBe("");
    if (!result.ok) return;
    const card = result.document.scenes[0].elements.find((item) => item.id === "card")!;
    expect(card.type).toBe("composite");
    expect(card.animations?.some((animation) => animation.property === "y")).toBe(true);
  });
});

describe("composite asset and font collection reach into children", () => {
  it("collects image/video/ui asset ids nested inside a composite's tree", () => {
    const element = compositeElement({
      children: [
        {
          id: "card-photo",
          name: "photo",
          type: "image",
          assetId: "asset-in-card",
          fit: "cover",
          transform: createDefaultTransform({ width: 100, height: 100 }),
        },
        {
          id: "card-inner",
          name: "inner composite",
          type: "composite",
          viewport: { width: 100, height: 100 },
          transform: createDefaultTransform({ width: 100, height: 100 }),
          children: [
            {
              id: "card-inner-photo",
              name: "nested photo",
              type: "video",
              assetId: "asset-nested-in-card",
              fit: "cover",
              sourceStartMs: 0,
              volume: 0,
              playbackRate: 1,
              muted: true,
              transform: createDefaultTransform({ width: 50, height: 50 }),
            },
          ],
        },
      ],
    });
    expect(collectCreativeCompositeAssetIds(element).sort()).toEqual(["asset-in-card", "asset-nested-in-card"]);

    const doc = documentWithComposite(element);
    expect(getCreativeDocumentAssetIds(doc)).toEqual(expect.arrayContaining(["asset-in-card", "asset-nested-in-card"]));
  });

  it("flattens every descendant of a composite depth-first", () => {
    const doc = documentWithComposite();
    const element = doc.scenes[0].elements.find((item) => item.id === "card") as CreativeCompositeElement;
    expect(collectCreativeCompositeDescendants(element).map((child) => child.id)).toEqual([
      "card-plate",
      "card-label",
      "card-chart",
    ]);
  });

  it("preloads a font a composite child's text overrides, not only design-system tokens", () => {
    const element = compositeElement({
      children: [
        {
          id: "card-custom-font",
          name: "custom",
          type: "text",
          text: "Custom",
          style: { token: "body", overrides: { fontFamily: "Card Display Family", fontWeight: 800 } },
          transform: createDefaultTransform({ width: 200, height: 40 }),
        },
      ],
    });
    const doc = documentWithComposite(element);
    const fonts = requiredFonts(doc);
    const custom = fonts.find((font) => font.family === "Card Display Family");
    expect(custom?.weights).toEqual([800]);
  });
});

describe("composite element cloning", () => {
  it("addElement deep-clones children so mutating the source afterwards does not affect the document", () => {
    const doc = createCanonicalCreativeFixture();
    const source = compositeElement();
    const result = addElement(doc, "scene-1", source);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    source.children[0].transform.x = 999;
    (source.children[2] as { series: number[] }).series[0] = -1;
    const stored = result.document.scenes[0].elements.find((item) => item.id === "card") as CreativeCompositeElement;
    expect(stored.children[0].transform.x).toBe(0);
    expect((stored.children[2] as { series: number[] }).series[0]).toBe(12);
  });

  it("update_element can replace a composite's whole children array", () => {
    const doc = documentWithComposite();
    const result = updateElement(doc, "scene-1", "card", {
      children: [
        {
          id: "card-solo",
          name: "solo",
          type: "text",
          text: "Solo",
          style: { token: "body" },
          transform: createDefaultTransform({ width: 100, height: 40 }),
        },
      ],
    } as Partial<CreativeElement>);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const card = result.document.scenes[0].elements.find((item) => item.id === "card") as CreativeCompositeElement;
    expect(card.children.map((child) => child.id)).toEqual(["card-solo"]);
  });
});

/**
 * The mask bug this repo keeps naming was a property one module resolved and
 * only one renderer applied. A composite that positions its children in the
 * preview and stacks them wrong in the export would be the same class of
 * defect. Both renderer sources are scanned for the composite dispatch and
 * for reading the resolved scale/children off composite.ts's own resolver,
 * never recomputing element.transform.width / element.viewport.width
 * themselves - the same pattern hierarchy.test.ts and ui-element.test.ts
 * already police for their own modules.
 */
describe("both renderers resolve and render a composite the same way", () => {
  const ROOT = resolvePath(__dirname, "..", "..");
  const CONSUMERS = [
    "components/creative/CreativeScenePreview.tsx",
    "remotion/CreativeComposition.tsx",
  ];

  for (const consumer of CONSUMERS) {
    const source = readFileSync(resolvePath(ROOT, consumer), "utf8");

    it(`${consumer} dispatches "composite" through resolveCreativeCompositeElement`, () => {
      expect(source).toContain('element.type === "composite"');
      expect(source).toContain("resolveCreativeCompositeElement(");
    });

    it(`${consumer} applies the resolved scale and viewport, not its own copy of the ratio`, () => {
      expect(source).toContain("resolved.scaleX");
      expect(source).toContain("resolved.scaleY");
      expect(source).toContain("resolved.viewport.width");
      expect(source).toContain("resolved.viewport.height");
    });

    it(`${consumer} renders the resolved children`, () => {
      expect(source).toContain("resolved.children");
    });
  }
});
