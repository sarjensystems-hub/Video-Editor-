import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import {
  alignToReference,
  resamplePolygon,
  resolveShapeMorphProgress,
  resolveShapeOutline,
} from "./shape-morph";
import { CREATIVE_OPERATION_SCHEMA } from "./operation-contract";
import { applyCreativeTransaction } from "./transactions";
import { validateCreativeDocument } from "./validate";
import { createDefaultTransform, createEmptyCreativeDocument } from "./defaults";
import type { CreativeShapeMorph, CreativeShapeOutlinePoint } from "./schema";

const morph = (overrides: Partial<CreativeShapeMorph> = {}): CreativeShapeMorph => ({
  from: { points: [{ x: 0, y: 0 }, { x: 1, y: 0 }, { x: 1, y: 1 }, { x: 0, y: 1 }] },
  to: { points: [{ x: 0.5, y: 0 }, { x: 1, y: 0.5 }, { x: 0.5, y: 1 }, { x: 0, y: 0.5 }] },
  startMs: 200,
  durationMs: 800,
  easing: "linear",
  ...overrides,
});

/**
 * A 3-4-5 right triangle: perimeter 12 split into three whole-number edges
 * (4, 3, 5), chosen specifically so every arc-length step below lands on a
 * value that can be checked by hand instead of trusted on faith.
 */
const TRIANGLE: CreativeShapeOutlinePoint[] = [{ x: 0, y: 0 }, { x: 4, y: 0 }, { x: 4, y: 3 }];

describe("resamplePolygon", () => {
  it("leaves an already-correct count completely untouched", () => {
    // DESIGN DECISION 2 is explicit that only the SHORTER list is padded -
    // resampling an already-matching outline would still relocate every
    // vertex to a new evenly-spaced position, silently distorting an outline
    // an author already sent at the exact count they wanted.
    const square = [{ x: 0, y: 0 }, { x: 1, y: 0 }, { x: 1, y: 1 }, { x: 0, y: 1 }];
    expect(resamplePolygon(square, 4)).toEqual(square);
  });

  it("pads a triangle to six points at the exact arc-length positions, not merely six points somewhere", () => {
    // The number of points changing without tearing the shape is the whole
    // point of this rule - checked here against hand-computed coordinates,
    // not just "still a valid-looking polygon". Perimeter is 4+3+5=12, so the
    // six samples fall at arc length 0, 2, 4, 6, 8, 10 - two of which (0 and
    // 4) land exactly on original vertices, and the rest split an edge.
    const resampled = resamplePolygon(TRIANGLE, 6);
    expect(resampled).toHaveLength(6);
    const expected: CreativeShapeOutlinePoint[] = [
      { x: 0, y: 0 }, // arc 0: vertex 0 itself
      { x: 2, y: 0 }, // arc 2: halfway along the length-4 bottom edge
      { x: 4, y: 0 }, // arc 4: vertex 1 itself
      { x: 4, y: 2 }, // arc 6: 2/3 up the length-3 right edge
      { x: 3.2, y: 2.4 }, // arc 8: 1/5 along the length-5 hypotenuse back to vertex 0
      { x: 1.6, y: 1.2 }, // arc 10: 3/5 along that same hypotenuse
    ];
    expected.forEach((point, index) => {
      expect(resampled[index].x, `point ${index} x`).toBeCloseTo(point.x, 9);
      expect(resampled[index].y, `point ${index} y`).toBeCloseTo(point.y, 9);
    });
  });

  it("keeps vertex 0 exactly anchored regardless of target count", () => {
    // Arc length 0 always falls in the first segment at t=0, which is what
    // lets a resampled outline still be compared to the original one - and
    // is what alignToReference below treats as a real, searchable vertex.
    expect(resamplePolygon(TRIANGLE, 9)[0]).toEqual({ x: 0, y: 0 });
  });

  it("collapses to one repeated point for a degenerate zero-perimeter outline instead of dividing by zero", () => {
    const coincident = [{ x: 5, y: 5 }, { x: 5, y: 5 }, { x: 5, y: 5 }];
    expect(resamplePolygon(coincident, 5)).toEqual(Array.from({ length: 5 }, () => ({ x: 5, y: 5 })));
  });
});

describe("alignToReference", () => {
  const square = [{ x: 0, y: 0 }, { x: 1, y: 0 }, { x: 1, y: 1 }, { x: 0, y: 1 }];

  it("un-rotates an outline that describes the identical shape starting at a different vertex", () => {
    // This is the artifact DESIGN DECISION 3 exists to remove: authored with
    // no relation to `square` other than starting one corner later, a naive
    // index-by-index lerp would slide every point a quarter of the way
    // around the box. The aligned result must be square's own points again.
    const shiftedStart = [{ x: 1, y: 0 }, { x: 1, y: 1 }, { x: 0, y: 1 }, { x: 0, y: 0 }];
    expect(alignToReference(square, shiftedStart)).toEqual(square);
  });

  it("also reverses winding when that pairing moves less than any same-direction rotation", () => {
    // Same four corners, traversed the opposite way around - no cyclic shift
    // of this list alone can ever match `square`, which is exactly why the
    // search has to try the reversed winding too, not just rotations of it.
    const reversedWinding = [{ x: 0, y: 0 }, { x: 0, y: 1 }, { x: 1, y: 1 }, { x: 1, y: 0 }];
    expect(alignToReference(square, reversedWinding)).toEqual(square);
  });

  it("leaves an outline that is already the closest pairing untouched, ties included", () => {
    // Shift 0 with no reversal is tried first, so a points list that already
    // matches (or ties) must come back exactly as given rather than an
    // equal-cost alternative the search happened to also find.
    expect(alignToReference(square, square)).toEqual(square);
  });
});

describe("resolveShapeMorphProgress", () => {
  it("holds at 0 (pure from) at and before startMs, never negative", () => {
    expect(resolveShapeMorphProgress(morph(), 0)).toBe(0);
    expect(resolveShapeMorphProgress(morph(), 200)).toBe(0);
  });

  it("reaches exactly 1 (pure to) once the run finishes, never overshooting", () => {
    expect(resolveShapeMorphProgress(morph(), 1000)).toBe(1); // startMs + durationMs
    expect(resolveShapeMorphProgress(morph(), 9000)).toBe(1); // long after
  });

  it("is exactly halfway through the run's own midpoint under linear easing", () => {
    expect(resolveShapeMorphProgress(morph(), 600)).toBeCloseTo(0.5, 9); // 200 + half of 800
  });

  it("applies the requested easing instead of always interpolating linearly", () => {
    const eased = resolveShapeMorphProgress(morph({ easing: "ease-in" }), 600);
    expect(eased).toBeLessThan(0.5);
  });

  it("never divides by zero for a degenerate zero-length run", () => {
    // Validation rejects durationMs <= 0 on a persisted document (see the
    // rejection tests below); the pure resolver still needs a defined answer
    // rather than NaN if it is ever called directly.
    expect(resolveShapeMorphProgress(morph({ durationMs: 0 }), 200)).toBe(0);
    expect(resolveShapeMorphProgress(morph({ durationMs: 0 }), 201)).toBe(1);
  });
});

describe("resolveShapeOutline: geometry at t=0, midpoint and t=1", () => {
  // A square becoming a diamond, equal point counts, linear easing so the
  // midpoint is a plain average - real geometry an eye could check on a
  // frame, not just a property of the numbers.
  const squareToDiamond = morph({ startMs: 0, durationMs: 1000, easing: "linear" });

  it("shows exactly `from`, unmodified, before the run starts", () => {
    const outline = resolveShapeOutline(squareToDiamond, 0);
    expect(outline.points).toEqual([{ x: 0, y: 0 }, { x: 1, y: 0 }, { x: 1, y: 1 }, { x: 0, y: 1 }]);
    expect(outline.path).toBe("M0 0 L1 0 L1 1 L0 1 Z");
  });

  it("is the plain per-vertex average at the run's own midpoint", () => {
    const outline = resolveShapeOutline(squareToDiamond, 500);
    const expected = [{ x: 0.25, y: 0 }, { x: 1, y: 0.25 }, { x: 0.75, y: 1 }, { x: 0, y: 0.75 }];
    expected.forEach((point, index) => {
      expect(outline.points[index].x, `point ${index} x`).toBeCloseTo(point.x, 9);
      expect(outline.points[index].y, `point ${index} y`).toBeCloseTo(point.y, 9);
    });
  });

  it("shows exactly `to`, settled, once the run has finished", () => {
    const outline = resolveShapeOutline(squareToDiamond, 1000);
    expect(outline.points).toEqual([{ x: 0.5, y: 0 }, { x: 1, y: 0.5 }, { x: 0.5, y: 1 }, { x: 0, y: 0.5 }]);
  });
});

describe("resolveShapeOutline: a shape describing itself does not spin through its own morph", () => {
  // The end-to-end version of the alignToReference test above: from and to
  // are the exact same square, `to` merely starting one corner later. If
  // alignment were not wired into resolveShapeOutline itself, this would
  // visibly rotate at every frame despite morphing "into" an identical shape.
  const inertMorph = morph({
    from: { points: [{ x: 0, y: 0 }, { x: 1, y: 0 }, { x: 1, y: 1 }, { x: 0, y: 1 }] },
    to: { points: [{ x: 1, y: 0 }, { x: 1, y: 1 }, { x: 0, y: 1 }, { x: 0, y: 0 }] },
    startMs: 0,
    durationMs: 1000,
  });
  const square = [{ x: 0, y: 0 }, { x: 1, y: 0 }, { x: 1, y: 1 }, { x: 0, y: 1 }];

  it.each([0, 250, 500, 750, 1000])("stays exactly on the square at localMs %i", (localMs) => {
    expect(resolveShapeOutline(inertMorph, localMs).points).toEqual(square);
  });
});

describe("resolveShapeOutline: a point-count mismatch resamples without tearing", () => {
  // `from` is the same 3-4-5 triangle resamplePolygon's own test already
  // proved resamples to these six exact points. `to` is that identical
  // six-point outline translated by a fixed (10, 10) - so alignment has a
  // provably correct answer (shift 0, no reversal: translating every vertex
  // by the same amount can never be beaten by pairing a vertex against a
  // DIFFERENT one of an asymmetric shape) and the whole pipeline's result is
  // fully hand-checkable, not just "six points and no exception".
  const resampledTriangle: CreativeShapeOutlinePoint[] = [
    { x: 0, y: 0 }, { x: 2, y: 0 }, { x: 4, y: 0 }, { x: 4, y: 2 }, { x: 3.2, y: 2.4 }, { x: 1.6, y: 1.2 },
  ];
  const translated = resampledTriangle.map((point) => ({ x: point.x + 10, y: point.y + 10 }));
  const triangleToHexagon = morph({
    from: { points: TRIANGLE },
    to: { points: translated },
    startMs: 0,
    durationMs: 1000,
    easing: "linear",
  });

  it("has six points throughout - the shorter outline padded up, never the longer one shrunk", () => {
    for (const localMs of [0, 400, 1000]) {
      expect(resolveShapeOutline(triangleToHexagon, localMs).points).toHaveLength(6);
    }
  });

  it("starts at the resampled triangle exactly", () => {
    const outline = resolveShapeOutline(triangleToHexagon, 0);
    resampledTriangle.forEach((point, index) => {
      expect(outline.points[index].x, `point ${index} x`).toBeCloseTo(point.x, 9);
      expect(outline.points[index].y, `point ${index} y`).toBeCloseTo(point.y, 9);
    });
  });

  it("ends at the authored hexagon exactly, in its own authored order", () => {
    const outline = resolveShapeOutline(triangleToHexagon, 1000);
    translated.forEach((point, index) => {
      expect(outline.points[index].x, `point ${index} x`).toBeCloseTo(point.x, 9);
      expect(outline.points[index].y, `point ${index} y`).toBeCloseTo(point.y, 9);
    });
  });

  it("moves each vertex along a straight (10, 10) line, so the midpoint is +5 on both axes", () => {
    const outline = resolveShapeOutline(triangleToHexagon, 500);
    resampledTriangle.forEach((point, index) => {
      expect(outline.points[index].x, `point ${index} x`).toBeCloseTo(point.x + 5, 9);
      expect(outline.points[index].y, `point ${index} y`).toBeCloseTo(point.y + 5, 9);
    });
  });
});

/**
 * Row #52's whole premise is that preview and Remotion draw the identical
 * outline at the identical frame. That only holds if both actually call the
 * pure resolver instead of each deciding the geometry independently - the
 * same property chart.test.ts and hierarchy.test.ts already police for their
 * own modules.
 */
describe("both renderers apply the geometry this module resolves", () => {
  const ROOT = resolve(__dirname, "..", "..");
  const CONSUMERS = [
    "components/creative/CreativeScenePreview.tsx",
    "remotion/CreativeComposition.tsx",
  ];

  for (const consumer of CONSUMERS) {
    it(`${consumer} calls resolveShapeOutline and draws its resolved path`, () => {
      const source = readFileSync(resolve(ROOT, consumer), "utf8");
      expect(source).toContain("resolveShapeOutline(");
      expect(source).toContain("outline.path");
    });

    it(`${consumer} gates the morph branch on element.morph before the plain rect/ellipse fallback`, () => {
      const source = readFileSync(resolve(ROOT, consumer), "utf8");
      const gateIndex = source.indexOf("if (element.morph)");
      // The exact rect/ellipse fallback this feature must not have touched -
      // present verbatim, and only reached once the morph branch above it
      // has already returned.
      const fallbackIndex = source.indexOf('element.shape === "ellipse" ? "50%" : element.borderRadius ?? 0');
      expect(gateIndex, `${consumer} never checks element.morph`).toBeGreaterThan(-1);
      expect(fallbackIndex, `${consumer} lost its original rect/ellipse fallback`).toBeGreaterThan(-1);
      expect(gateIndex, `${consumer} checks element.morph after already falling back`).toBeLessThan(fallbackIndex);
    });
  }
});

/**
 * Advertised schema, transaction and validator are three descriptions of one
 * contract - this repo has shipped capabilities that were built, tested and
 * unreachable because only two of the three were ever checked together.
 */
describe("set_shape_morph is reachable through the advertised contract", () => {
  const film = () => {
    const document = createEmptyCreativeDocument({ id: "morph-doc" });
    document.scenes[0].elements = [
      {
        id: "plate",
        name: "Plate",
        type: "shape",
        shape: "rect",
        fill: { kind: "literal", value: "#000000" },
        transform: createDefaultTransform({ width: 400, height: 400 }),
        timing: { startMs: 0, endMs: 5000 },
      },
    ];
    return document;
  };

  it("advertises the operation and every field it takes", () => {
    const text = JSON.stringify(CREATIVE_OPERATION_SCHEMA);
    expect(text).toContain('"set_shape_morph"');
    for (const field of ["from", "to", "points", "startMs", "durationMs", "easing"]) {
      expect(text, `${field} is accepted by the engine but not advertised`).toContain(`"${field}"`);
    }
  });

  it("applies through a transaction and leaves a document that validates", () => {
    const result = applyCreativeTransaction(film(), {
      summary: "morph the plate",
      operations: [{ type: "set_shape_morph", sceneId: "scene-1", elementId: "plate", morph: morph() }],
    } as never);
    expect(result.ok, "ok" in result && !result.ok ? JSON.stringify(result.error) : "").toBe(true);
    const element = result.document!.scenes[0].elements[0] as unknown as { morph?: CreativeShapeMorph };
    expect(element.morph?.to.points).toEqual(morph().to.points);
  });

  it("clears the morph when the operation omits it, falling back to the plain rect/ellipse", () => {
    const morphed = applyCreativeTransaction(film(), {
      summary: "morph",
      operations: [{ type: "set_shape_morph", sceneId: "scene-1", elementId: "plate", morph: morph() }],
    } as never);
    expect(morphed.ok).toBe(true);
    const cleared = applyCreativeTransaction(morphed.document!, {
      summary: "stop morphing",
      operations: [{ type: "set_shape_morph", sceneId: "scene-1", elementId: "plate" }],
    } as never);
    expect(cleared.ok).toBe(true);
    // Cleared the way every other optional field on this element clears: left
    // undefined rather than deleted, which serialises away and reads as
    // absent everywhere it matters - see set_counter/set_glass/set_mask.
    expect((cleared.document!.scenes[0].elements[0] as unknown as { morph?: unknown }).morph).toBeUndefined();
  });

  it("refuses a non-shape element, since only a shape has an outline to morph", () => {
    const document = film();
    document.scenes[0].elements.push({
      id: "title",
      name: "Title",
      type: "text",
      text: "Hi",
      style: { token: "heading" },
      transform: createDefaultTransform({ zIndex: 1 }),
    });
    const result = applyCreativeTransaction(document, {
      summary: "bad target",
      operations: [{ type: "set_shape_morph", sceneId: "scene-1", elementId: "title", morph: morph() }],
    } as never);
    expect(result.ok).toBe(false);
  });

  /**
   * A shape that never sets `morph` must be indistinguishable from a shape
   * authored before this feature existed. Checked at the document validator,
   * which is exactly where a stray requirement on the new field would first
   * show up as an unexpected issue on documents that never touch it.
   */
  it("a shape with no morph field is valid, with no issue naming morph at all", () => {
    const document = film();
    const result = validateCreativeDocument(document);
    expect(result.valid).toBe(true);
    expect(result.issues.filter((issue) => issue.path.includes("morph"))).toEqual([]);
  });

  describe("rejects a degenerate outline rather than persisting one the resolver could not walk", () => {
    it("fewer than three points", () => {
      const result = applyCreativeTransaction(film(), {
        summary: "degenerate outline",
        operations: [{
          type: "set_shape_morph", sceneId: "scene-1", elementId: "plate",
          morph: morph({ to: { points: [{ x: 0, y: 0 }, { x: 1, y: 1 }] } }),
        }],
      } as never);
      expect(result.ok).toBe(false);
    });

    it("a non-finite coordinate", () => {
      const result = applyCreativeTransaction(film(), {
        summary: "non-finite point",
        operations: [{
          type: "set_shape_morph", sceneId: "scene-1", elementId: "plate",
          morph: morph({
            from: { points: [{ x: 0, y: 0 }, { x: Number.NaN, y: 1 }, { x: 1, y: 1 }] },
          }),
        }],
      } as never);
      expect(result.ok).toBe(false);
    });

    it("an infinite coordinate", () => {
      const result = applyCreativeTransaction(film(), {
        summary: "infinite point",
        operations: [{
          type: "set_shape_morph", sceneId: "scene-1", elementId: "plate",
          morph: morph({
            to: { points: [{ x: 0, y: 0 }, { x: Number.POSITIVE_INFINITY, y: 1 }, { x: 1, y: 1 }] },
          }),
        }],
      } as never);
      expect(result.ok).toBe(false);
    });

    it("a run that outlives the element's own visible window", () => {
      const result = applyCreativeTransaction(film(), {
        summary: "runs too long",
        operations: [{
          type: "set_shape_morph", sceneId: "scene-1", elementId: "plate",
          // The element is visible for 5000ms; this run needs 5100.
          morph: morph({ startMs: 4900, durationMs: 200 }),
        }],
      } as never);
      expect(result.ok).toBe(false);
    });

    it("an easing that is neither a named preset nor a cubic-bezier curve", () => {
      const result = applyCreativeTransaction(film(), {
        summary: "bad easing",
        operations: [{
          type: "set_shape_morph", sceneId: "scene-1", elementId: "plate",
          morph: morph({ easing: "bounce" as never }),
        }],
      } as never);
      expect(result.ok).toBe(false);
    });
  });
});
