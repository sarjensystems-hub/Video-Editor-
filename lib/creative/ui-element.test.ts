import { readFileSync } from "node:fs";
import { resolve as resolvePath } from "node:path";
import { describe, expect, it } from "vitest";
import { createCanonicalCreativeFixture } from "./fixtures";
import { createDefaultTransform } from "./defaults";
import { getCreativeDocumentAssetIds } from "./remotion";
import { applyCreativeTransaction } from "./transactions";
import {
  collectCreativeUiAssetIds,
  countCreativeUiNodes,
  resolveCreativeUiElement,
  resolveCreativeUiPointer,
  resolveCreativeUiScrollY,
} from "./ui-element";
import { validateCreativeDocument } from "./validate";
import type { CreativeDocument, CreativeUiElement, CreativeUiNode } from "./schema";

function uiElement(overrides: Partial<CreativeUiElement> = {}): CreativeUiElement {
  return {
    id: "app-ui",
    name: "Product interface",
    type: "ui",
    viewport: { width: 390, height: 844 },
    background: { kind: "token", token: "background" },
    nodes: [
      {
        id: "card",
        kind: "box",
        frame: { x: 24, y: 120, width: 342, height: 220 },
        background: { kind: "literal", value: "#111111" },
        borderRadius: 24,
        clip: true,
        children: [
          {
            id: "card-title",
            kind: "text",
            frame: { x: 20, y: 20, width: 302, height: 48 },
            text: "Booked in 30 seconds",
            style: { token: "heading" },
          },
          {
            id: "card-thumb",
            kind: "image",
            frame: { x: 20, y: 84, width: 120, height: 120 },
            assetId: "ui-thumb",
            fit: "cover",
          },
        ],
      },
    ],
    transform: createDefaultTransform({ x: 100, y: 200, width: 780, height: 1688, zIndex: 5 }),
    ...overrides,
  } as CreativeUiElement;
}

function documentWithUi(element: CreativeUiElement = uiElement()): CreativeDocument {
  const base = createCanonicalCreativeFixture();
  return {
    ...base,
    scenes: [{ ...base.scenes[0], elements: [...base.scenes[0].elements, element] }],
  };
}

describe("deterministic UI element contract", () => {
  it("validates a complete UI element inside a canonical document", () => {
    const result = validateCreativeDocument(documentWithUi());
    expect(result.issues).toEqual([]);
    expect(result.valid).toBe(true);
  });

  it("keeps documents without UI elements valid and unchanged", () => {
    expect(validateCreativeDocument(createCanonicalCreativeFixture()).valid).toBe(true);
  });

  it("rejects a UI node kind outside the closed vocabulary", () => {
    const element = uiElement({
      nodes: [
        { id: "danger", kind: "iframe", frame: { x: 0, y: 0, width: 10, height: 10 } } as unknown as CreativeUiNode,
      ],
    });
    const result = validateCreativeDocument(documentWithUi(element));
    expect(result.valid).toBe(false);
    expect(result.issues.some((issue) => /UI node kind is not supported/.test(issue.message))).toBe(true);
  });

  it("rejects duplicate node ids anywhere in the tree", () => {
    const element = uiElement({
      nodes: [
        {
          id: "card",
          kind: "box",
          frame: { x: 0, y: 0, width: 100, height: 100 },
          children: [{ id: "card", kind: "box", frame: { x: 0, y: 0, width: 10, height: 10 } }],
        },
      ],
    });
    const result = validateCreativeDocument(documentWithUi(element));
    expect(result.valid).toBe(false);
    expect(result.issues.some((issue) => issue.code === "duplicate_id")).toBe(true);
  });

  it("rejects a viewport that is not a positive bounded integer", () => {
    for (const viewport of [{ width: 0, height: 844 }, { width: 390, height: 99999 }, { width: 390.5, height: 844 }]) {
      const result = validateCreativeDocument(documentWithUi(uiElement({ viewport })));
      expect(result.valid).toBe(false);
      expect(result.issues.some((issue) => issue.path.includes("viewport"))).toBe(true);
    }
  });

  it("rejects a typography token the design system does not define", () => {
    const element = uiElement({
      nodes: [
        {
          id: "copy",
          kind: "text",
          frame: { x: 0, y: 0, width: 100, height: 40 },
          text: "Hello",
          style: { token: "does-not-exist" },
        },
      ],
    });
    const result = validateCreativeDocument(documentWithUi(element));
    expect(result.valid).toBe(false);
    expect(result.issues.some((issue) => issue.code === "missing_reference")).toBe(true);
  });

  it("rejects nesting deeper than the documented limit", () => {
    let node: CreativeUiNode = { id: "leaf", kind: "box", frame: { x: 0, y: 0, width: 10, height: 10 } };
    for (let depth = 0; depth < 7; depth += 1) {
      node = { id: `wrap-${depth}`, kind: "box", frame: { x: 0, y: 0, width: 10, height: 10 }, children: [node] };
    }
    const result = validateCreativeDocument(documentWithUi(uiElement({ nodes: [node] })));
    expect(result.valid).toBe(false);
    expect(result.issues.some((issue) => /nest deeper/.test(issue.message))).toBe(true);
  });

  it("rejects scroll and pointer motion outside the element visible window", () => {
    const scrolled = uiElement({ scroll: { fromY: 0, toY: 400, startMs: 0, endMs: 9000, easing: "ease-in-out" } });
    expect(validateCreativeDocument(documentWithUi(scrolled)).valid).toBe(false);

    const pointed = uiElement({
      pointer: {
        radius: 18,
        color: { kind: "token", token: "accent" },
        keyframes: [{ timeMs: 9000, x: 10, y: 10, pressed: false }],
      },
    });
    expect(validateCreativeDocument(documentWithUi(pointed)).valid).toBe(false);
  });

  it("accepts scroll and pointer motion inside the visible window", () => {
    const element = uiElement({
      scroll: { fromY: 0, toY: 400, startMs: 500, endMs: 4500, easing: "ease-in-out" },
      pointer: {
        radius: 18,
        color: { kind: "token", token: "accent" },
        keyframes: [
          { timeMs: 500, x: 100, y: 200, pressed: false },
          { timeMs: 1500, x: 180, y: 260, pressed: true },
        ],
      },
    });
    expect(validateCreativeDocument(documentWithUi(element)).valid).toBe(true);
  });

  it("scales the fixed viewport to exactly fill the element box", () => {
    const element = uiElement();
    const resolved = resolveCreativeUiElement(documentWithUi(element), element, 0);
    expect(resolved.viewport).toEqual({ width: 390, height: 844 });
    expect(resolved.scaleX).toBeCloseTo(780 / 390, 10);
    expect(resolved.scaleY).toBeCloseTo(1688 / 844, 10);
  });

  it("resolves node geometry, colors and typography from the design system", () => {
    const element = uiElement();
    const document = documentWithUi(element);
    const resolved = resolveCreativeUiElement(document, element, 0);
    const card = resolved.nodes[0];
    expect(card).toMatchObject({ id: "card", kind: "box", x: 24, y: 120, width: 342, height: 220, clip: true });
    expect(card.background).toBe("#111111");
    expect(card.children.map((child) => child.id)).toEqual(["card-title", "card-thumb"]);
    expect(card.children[0].text?.value).toBe("Booked in 30 seconds");
    expect(card.children[0].text?.style.color).toBe(document.designSystem.colors.foreground);
    expect(card.children[1].image).toEqual({ assetId: "ui-thumb", fit: "cover" });
    // Child coordinates stay relative to the parent so a renderer can clip them.
    expect(card.children[0].x).toBe(20);
  });

  it("eases the scroll offset across its window and holds outside it", () => {
    const scroll = { fromY: 0, toY: 400, startMs: 1000, endMs: 3000, easing: "linear" } as const;
    expect(resolveCreativeUiScrollY(scroll, 0)).toBe(0);
    expect(resolveCreativeUiScrollY(scroll, 1000)).toBe(0);
    expect(resolveCreativeUiScrollY(scroll, 2000)).toBe(200);
    expect(resolveCreativeUiScrollY(scroll, 3000)).toBe(400);
    expect(resolveCreativeUiScrollY(scroll, 8000)).toBe(400);
    expect(resolveCreativeUiScrollY(undefined, 1234)).toBe(0);
  });

  it("interpolates pointer position and holds the pressed state discretely", () => {
    const pointer = {
      radius: 18,
      color: { kind: "token", token: "accent" } as const,
      keyframes: [
        { timeMs: 0, x: 0, y: 0, pressed: false },
        { timeMs: 1000, x: 100, y: 200, pressed: true },
        { timeMs: 2000, x: 100, y: 200, pressed: false },
      ],
    };
    expect(resolveCreativeUiPointer(pointer, 0)).toEqual({ x: 0, y: 0, pressed: false });
    expect(resolveCreativeUiPointer(pointer, 500)).toEqual({ x: 50, y: 100, pressed: false });
    expect(resolveCreativeUiPointer(pointer, 1000)).toEqual({ x: 100, y: 200, pressed: true });
    expect(resolveCreativeUiPointer(pointer, 5000)).toEqual({ x: 100, y: 200, pressed: false });
    expect(resolveCreativeUiPointer(undefined, 10)).toBeNull();
  });

  it("counts nodes and collects nested registered asset ids", () => {
    const element = uiElement();
    expect(countCreativeUiNodes(element.nodes)).toBe(3);
    expect(collectCreativeUiAssetIds(element)).toEqual(["ui-thumb"]);
    expect(getCreativeDocumentAssetIds(documentWithUi(element))).toContain("ui-thumb");
    expect(getCreativeDocumentAssetIds(documentWithUi(element))).toContain("fixture-background");
  });

  it("adds a UI element through the closed transaction vocabulary", () => {
    const base = createCanonicalCreativeFixture();
    const result = applyCreativeTransaction(base, {
      summary: "Add product interface panel",
      operations: [{ type: "add_element", sceneId: "scene-1", element: uiElement() }],
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const added = result.document.scenes[0].elements.find((element) => element.id === "app-ui");
    expect(added?.type).toBe("ui");
    // The stored element is a copy, not a reference into the caller's tree.
    expect(added).not.toBe(uiElement());
    expect(validateCreativeDocument(result.document).valid).toBe(true);
  });
});

/**
 * Independent animation of UI children.
 *
 * A `ui` element used to be one atomic object: once five or ten nodes were
 * nested inside it, the only way to choreograph them separately was to delete
 * the element and rebuild everything as native elements — losing the reason to
 * use `ui` at all. Rows staggering, a value scaling while its card holds still,
 * one chip leaving to the left: all of that is this.
 */
describe("UI node timing and animation", () => {
  const track = (property: string, from: number, to: number) => ({
    id: `${property}-track`,
    property,
    keyframes: [
      { timeMs: 0, value: from, easing: "linear" },
      { timeMs: 1000, value: to, easing: "linear" },
    ],
  });

  const uiElement = (nodes: unknown[]) =>
    ({
      id: "panel",
      name: "Panel",
      type: "ui",
      viewport: { width: 800, height: 600 },
      nodes,
      transform: {
        x: 0, y: 0, width: 800, height: 600, rotation: 0,
        opacity: 1, anchorX: 0.5, anchorY: 0.5, zIndex: 1,
      },
    }) as unknown as Parameters<typeof resolveCreativeUiElement>[1];

  const doc = {
    version: 1,
    id: "doc",
    title: "Doc",
    canvas: { width: 1080, height: 1080, fps: 30, background: { kind: "literal", value: "#000" } },
    designSystem: { colors: {}, typography: {}, spacing: {}, radii: {} },
    scenes: [],
  } as unknown as Parameters<typeof resolveCreativeUiElement>[0];

  const row = (id: string, extra: Record<string, unknown> = {}) => ({
    id,
    kind: "box",
    frame: { x: 0, y: 0, width: 400, height: 60 },
    ...extra,
  });

  it("leaves an unanimated node exactly where it was", () => {
    // Every UI element authored before this must render identically.
    const node = resolveCreativeUiElement(doc, uiElement([row("plain")]), 500).nodes[0];
    expect(node.visible).toBe(true);
    expect(node.transform).toBeNull();
    expect(node.x).toBe(0);
    expect(node.opacity).toBe(1);
  });

  it("moves one node without touching its siblings", () => {
    const resolved = resolveCreativeUiElement(
      doc,
      uiElement([row("moving", { animations: [track("x", 0, 200)] }), row("still")]),
      500,
    );
    expect(resolved.nodes[0].x).toBeCloseTo(100, 6);
    expect(resolved.nodes[1].x).toBe(0);
  });

  it("staggers rows by giving each its own track", () => {
    // The shape the brief asked for: row 2 follows row 1 by 180ms.
    const rows = [0, 180, 360].map((delay, index) => ({
      ...row(`row-${index}`),
      animations: [{
        id: "rise",
        property: "y",
        keyframes: [
          { timeMs: delay, value: 40, easing: "linear" },
          { timeMs: delay + 200, value: 0, easing: "linear" },
        ],
      }],
    }));
    const at = (timeMs: number) =>
      resolveCreativeUiElement(doc, uiElement(rows), timeMs).nodes.map((n) => n.y);

    // At 200ms the first row has just landed, the second is a fifth of the way
    // in, and the third has not begun — which is what a stagger looks like.
    const [first, second, third] = at(200);
    expect(first).toBe(0);
    expect(second).toBeCloseTo(36, 6);
    expect(third).toBe(40);

    // And they all arrive, in order, by the time the last one finishes.
    expect(at(560)).toEqual([0, 0, 0]);
  });

  it("scales a node about its own centre rather than its corner", () => {
    const node = resolveCreativeUiElement(
      doc,
      uiElement([row("value", { animations: [track("scaleX", 1, 2), track("scaleY", 1, 2)] })]),
      1000,
    ).nodes[0];
    expect(node.transform).toBe("rotate(0deg) scale(2, 2)");
    expect(node.transformOrigin).toBe("50% 50%");
  });

  it("hides a node outside its timing window", () => {
    const timed = uiElement([row("chip", { timing: { startMs: 400, endMs: 900 } })]);
    expect(resolveCreativeUiElement(doc, timed, 399).nodes[0].visible).toBe(false);
    expect(resolveCreativeUiElement(doc, timed, 400).nodes[0].visible).toBe(true);
    expect(resolveCreativeUiElement(doc, timed, 900).nodes[0].visible).toBe(false);
  });

  it("animates a nested child on its own clock", () => {
    const parent = {
      ...row("card"),
      children: [row("label", { animations: [track("opacity", 0, 1)] })],
    };
    const resolved = resolveCreativeUiElement(doc, uiElement([parent]), 500).nodes[0];
    expect(resolved.children[0].opacity).toBeCloseTo(0.5, 6);
  });

  it("ignores a track for something a node does not own", () => {
    const node = resolveCreativeUiElement(
      doc,
      uiElement([row("odd", { animations: [track("cropX", 0, 1)] })]),
      500,
    ).nodes[0];
    expect(node.transform).toBeNull();
    expect(node.x).toBe(0);
  });
});

describe("both renderers apply UI node motion", () => {
  const ROOT = resolvePath(__dirname, "..", "..");
  for (const consumer of [
    "components/creative/CreativeScenePreview.tsx",
    "remotion/CreativeComposition.tsx",
  ]) {
    it(`${consumer} honours visibility and the node transform`, () => {
      // A row that staggers in the preview and sits still in the export is the
      // mask bug again, one level deeper.
      const source = readFileSync(resolvePath(ROOT, consumer), "utf8");
      expect(source).toContain("node.visible");
      expect(source).toContain("node.transform");
      expect(source).toContain("node.transformOrigin");
    });
  }
});
