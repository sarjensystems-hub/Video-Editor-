import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { resolveConnectorGeometry } from "./connector";
import type { CreativeDocument, CreativeElement, CreativeScene } from "./schema";

const transform = (overrides: Record<string, number> = {}) => ({
  x: 0, y: 0, width: 100, height: 100, rotation: 0,
  opacity: 1, anchorX: 0.5, anchorY: 0.5, zIndex: 1,
  ...overrides,
});

const box = (id: string, overrides: Record<string, number> = {}): CreativeElement =>
  ({
    id, name: id, type: "shape", shape: "rect",
    fill: { kind: "literal", value: "#fff" },
    transform: transform(overrides),
  }) as unknown as CreativeElement;

const edge = (overrides: Record<string, unknown> = {}): CreativeElement =>
  ({
    id: "edge", name: "edge", type: "connector",
    fromElementId: "a", toElementId: "b",
    curve: "straight",
    stroke: { width: 4, color: { kind: "literal", value: "#000" } },
    transform: transform(),
    ...overrides,
  }) as unknown as CreativeElement;

function film(options: {
  elements?: CreativeElement[];
  groups?: CreativeScene["groups"];
} = {}): CreativeDocument {
  const elements = options.elements ?? [
    box("a", { x: 100, y: 100, width: 100, height: 100 }),
    box("b", { x: 500, y: 500, width: 100, height: 100 }),
    edge(),
  ];
  return {
    version: 1,
    id: "doc",
    title: "Film",
    canvas: { width: 1080, height: 1920, fps: 30, background: { kind: "literal", value: "#000" } },
    designSystem: { colors: {}, typography: {}, spacing: {}, radii: {} },
    scenes: [{ id: "scene-1", name: "Scene", durationMs: 3000, elements, groups: options.groups ?? [] }],
  } as unknown as CreativeDocument;
}

const connectorOf = (document: CreativeDocument) =>
  document.scenes[0].elements.find((element) => element.id === "edge") as never;

describe("endpoints are derived, never authored", () => {
  it("attaches to the centre of each element", () => {
    const geometry = resolveConnectorGeometry(film(), connectorOf(film()), 0)!;
    expect(geometry.from).toEqual({ x: 150, y: 150 });
    expect(geometry.to).toEqual({ x: 550, y: 550 });
  });

  it("follows an endpoint when it moves, which is the entire point", () => {
    // A line between two boxes used to be a manually rotated rectangle that
    // broke the moment either box moved.
    const moved = film({
      elements: [
        box("a", { x: 100, y: 100, width: 100, height: 100 }),
        box("b", { x: 900, y: 200, width: 100, height: 100 }),
        edge(),
      ],
    });
    expect(resolveConnectorGeometry(moved, connectorOf(moved), 0)!.to).toEqual({ x: 950, y: 250 });
  });

  it("keeps the centre fixed under rotation, and moves it under scale", () => {
    // Rotating about a centred anchor cannot move the centre; scaling about an
    // off-centre anchor must.
    const rotated = film({
      elements: [
        box("a", { x: 100, y: 100, width: 200, height: 100, rotation: 37 }),
        box("b", { x: 500, y: 500 }),
        edge(),
      ],
    });
    expect(resolveConnectorGeometry(rotated, connectorOf(rotated), 0)!.from).toEqual({ x: 200, y: 150 });

    const scaled = film({
      elements: [
        box("a", { x: 100, y: 100, width: 200, height: 100, anchorX: 0, anchorY: 0 }),
        box("b", { x: 500, y: 500 }),
        edge(),
      ],
    });
    const point = resolveConnectorGeometry(scaled, connectorOf(scaled), 0)!.from;
    expect(point).toEqual({ x: 200, y: 150 });
  });
});

describe("curves", () => {
  const geometryFor = (curve: string) => {
    const document = film({
      elements: [
        box("a", { x: 100, y: 100, width: 100, height: 100 }),
        box("b", { x: 500, y: 500, width: 100, height: 100 }),
        edge({ curve }),
      ],
    });
    return resolveConnectorGeometry(document, connectorOf(document), 0)!;
  };

  it("draws a straight line as a single segment", () => {
    expect(geometryFor("straight").path).toBe("M 150 150 L 550 550");
  });

  it("routes an orthogonal edge through right angles at the midpoint", () => {
    expect(geometryFor("orthogonal").path).toBe("M 150 150 L 350 150 L 350 550 L 550 550");
  });

  it("draws a smooth edge as a cubic bezier", () => {
    expect(geometryFor("smooth").path).toMatch(/^M 150 150 C /);
  });

  it("starts and ends every curve at the endpoints it reported", () => {
    for (const curve of ["straight", "smooth", "orthogonal"]) {
      const geometry = geometryFor(curve);
      expect(geometry.path, curve).toContain(`M ${geometry.from.x} ${geometry.from.y}`);
      expect(geometry.path, curve).toMatch(new RegExp(`${geometry.to.x} ${geometry.to.y}$`));
    }
  });
});

describe("a connector with nothing to connect does not draw", () => {
  it("returns null when an endpoint is missing from the scene", () => {
    const document = film({
      elements: [box("a", { x: 100, y: 100 }), edge()],
    });
    expect(resolveConnectorGeometry(document, connectorOf(document), 0)).toBeNull();
  });

  it("returns null when an endpoint's group is hidden", () => {
    const document = film({
      groups: [{ id: "g", name: "g", elementIds: ["b"], hidden: true }] as never,
    });
    expect(resolveConnectorGeometry(document, connectorOf(document), 0)).toBeNull();
  });

  it("refuses to use another connector as an endpoint", () => {
    const document = film({
      elements: [
        box("a", { x: 100, y: 100 }),
        edge({ id: "other", fromElementId: "a", toElementId: "a" }),
        edge({ toElementId: "other" }),
      ],
    });
    expect(resolveConnectorGeometry(document, connectorOf(document), 0)).toBeNull();
  });
});

describe("group transforms move the edge with the node", () => {
  it("composes an endpoint's owning group transform into the endpoint", () => {
    // The endpoint element is moved by its group's wrapper, so an edge that
    // ignored the group would detach from the node it points at.
    const grouped = film({
      groups: [
        {
          id: "g",
          name: "g",
          elementIds: ["b"],
          transform: { x: 200, y: 0, rotation: 0, scaleX: 1, scaleY: 1, anchorX: 0.5, anchorY: 0.5, opacity: 1 },
        },
      ] as never,
    });
    const geometry = resolveConnectorGeometry(grouped, connectorOf(grouped), 0)!;
    expect(geometry.to).toEqual({ x: 750, y: 550 });
    expect(geometry.from).toEqual({ x: 150, y: 150 });
  });
});

/**
 * The rule this repo keeps relearning: when a pure module resolves a value, a
 * test asserts that every renderer reads every property it resolves.
 *
 * Connectors shipped with no test file at all, so nothing held the two
 * renderers together. maskComposite drifted exactly this way — resolved by the
 * module, applied by only one renderer, suite green throughout.
 */
describe("both renderers apply the geometry this module resolves", () => {
  const ROOT = resolve(__dirname, "..", "..");
  const CONSUMERS = [
    "components/creative/CreativeScenePreview.tsx",
    "remotion/CreativeComposition.tsx",
  ];

  for (const consumer of CONSUMERS) {
    it(`${consumer} draws the resolved path`, () => {
      const source = readFileSync(resolve(ROOT, consumer), "utf8");
      expect(source).toContain("resolveConnectorGeometry(");
      expect(source).toContain("geometry.path");
    });

    it(`${consumer} applies the stroke and the draw-on reveal`, () => {
      const source = readFileSync(resolve(ROOT, consumer), "utf8");
      expect(source, "stroke colour must resolve through the design system").toContain(
        "resolveColor(document.designSystem, element.stroke.color)",
      );
      expect(source).toContain("element.stroke.width");
      // pathLength={1} normalizes the path so the dash offset is the reveal,
      // whatever the path's real length is.
      expect(source, "draw-on must be applied, not just resolved").toContain("strokeDashoffset");
    });
  }

  it("renders identically in both, because the markup is the same", () => {
    const [preview, remotion] = CONSUMERS.map((consumer) =>
      readFileSync(resolve(ROOT, consumer), "utf8"),
    );
    const attributesOf = (source: string) => {
      const start = source.indexOf("function ConnectorVisual");
      expect(start, "ConnectorVisual must exist in both renderers").toBeGreaterThan(-1);
      const next = source.indexOf("\nfunction ", start + 1);
      const body = source.slice(start, next === -1 ? source.length : next);
      return [...body.matchAll(/(\w+)=\{/g)].map((match) => match[1]).sort();
    };
    expect(attributesOf(preview)).toEqual(attributesOf(remotion));
  });
});
