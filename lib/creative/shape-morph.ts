/**
 * Deterministic vector shape morph: turns a `CreativeShapeMorph`'s `from`/`to`
 * outlines and an element-local moment into the one resolved polygon both
 * renderers draw. Pure module, called identically by
 * CreativeScenePreview.tsx and remotion/CreativeComposition.tsx - the same
 * "resolve once, apply everywhere" arrangement chart.ts and connector.ts
 * already use for their own geometry, and counter.ts already uses for this
 * feature's own timing shape.
 *
 * The four decisions behind this module are documented on CreativeShapeMorph
 * in schema.ts, next to the schema they constrain. This file is the resolver
 * those decisions describe:
 *
 *  1. Representation - a normalized point list, not an SVG path with curves.
 *  2. Point-count mismatch - resamplePolygon walks the shorter outline's own
 *     perimeter at even arc-length steps to pad it up to the longer count.
 *  3. Winding/start-point alignment - alignToReference searches every cyclic
 *     shift and both winding directions for the pairing that moves least.
 *  4. Timing - resolveShapeMorphProgress runs on the element-local clock
 *     CreativeTextCounter already uses, not a scene-local one.
 */
import { applyCreativeEasing } from "./evaluate";
import type { CreativeShapeMorph, CreativeShapeOutline, CreativeShapeOutlinePoint } from "./schema";

export interface ResolvedShapeOutline {
  /** The resolved outline at this moment, one point per (post-resample) vertex. */
  points: CreativeShapeOutlinePoint[];
  /** SVG path data for `points`, closed with Z. Empty only when there are no points at all. */
  path: string;
}

const EPSILON = 1e-9;

function squaredDistance(a: CreativeShapeOutlinePoint, b: CreativeShapeOutlinePoint): number {
  const dx = a.x - b.x;
  const dy = a.y - b.y;
  return dx * dx + dy * dy;
}

function segmentLength(a: CreativeShapeOutlinePoint, b: CreativeShapeOutlinePoint): number {
  return Math.hypot(a.x - b.x, a.y - b.y);
}

/**
 * Resamples a closed polygon to exactly `count` vertices by walking evenly
 * spaced arc-length steps around its own perimeter (treating the last point
 * as connected back to the first, the same closure CreativeMask's polygon
 * kind already assumes).
 *
 * Arc-length, not "insert points evenly by index", because index-based
 * insertion would bunch new vertices onto whichever original edge happens to
 * come first rather than spreading them across the shape's actual outline -
 * padding a long thin triangle would pile every new point onto its shortest
 * edge. Walking by distance instead means a long edge gains proportionally
 * more of the new vertices than a short one, which is what keeps the padded
 * outline reading as the same shape rather than a lopsided one.
 *
 * A no-op when `points` already has exactly `count` vertices: resampling an
 * already-correct list would still move every vertex to a new evenly-spaced
 * position (this shape's own edges are not evenly spaced in general), and
 * "the longer list is left completely untouched" is DESIGN DECISION 2's own
 * rule, not just an optimisation.
 */
export function resamplePolygon(
  points: CreativeShapeOutlinePoint[],
  count: number,
): CreativeShapeOutlinePoint[] {
  if (points.length === count) return points.map((point) => ({ ...point }));
  if (points.length === 0 || count <= 0) return [];
  if (points.length === 1) return Array.from({ length: count }, () => ({ ...points[0] }));

  const segments = points.map((point, index) => {
    const next = points[(index + 1) % points.length];
    return { from: point, to: next, length: segmentLength(point, next) };
  });
  const perimeter = segments.reduce((sum, segment) => sum + segment.length, 0);

  // Every source vertex coincides with every other - there is no perimeter to
  // walk, so every resampled vertex collapses to that one point rather than
  // dividing by zero.
  if (perimeter <= EPSILON) {
    return Array.from({ length: count }, () => ({ ...points[0] }));
  }

  const resampled: CreativeShapeOutlinePoint[] = [];
  for (let index = 0; index < count; index += 1) {
    // k=0 always lands exactly on points[0]: target is 0, which the first
    // segment always covers, at t=0. That anchor is what lets a resampled
    // outline still be compared meaningfully to the un-resampled one in a
    // test, and it is what alignToReference below treats as a real vertex 0
    // to search rotations from.
    const target = (index / count) * perimeter;
    let walked = 0;
    let placed = false;
    for (const segment of segments) {
      if (target <= walked + segment.length + EPSILON) {
        const t = segment.length <= EPSILON ? 0 : (target - walked) / segment.length;
        resampled.push({
          x: segment.from.x + (segment.to.x - segment.from.x) * t,
          y: segment.from.y + (segment.to.y - segment.from.y) * t,
        });
        placed = true;
        break;
      }
      walked += segment.length;
    }
    // Floating-point rounding can leave the very last step just past the
    // measured perimeter; falling back to the last segment's end keeps this
    // total rather than throwing away a vertex.
    if (!placed) {
      const last = segments[segments.length - 1];
      resampled.push({ ...last.to });
    }
  }
  return resampled;
}

/**
 * Rotates and, if it scores lower, reverses `points` to whichever cyclic
 * starting shift and winding direction stays closest to `reference`, point
 * for point. `reference` and `points` must already be the same length - the
 * caller resamples first.
 *
 * Exhaustive rather than heuristic: with `points.length` typically a handful
 * to a few dozen vertices, trying every one of the `2 * n` (shift x winding)
 * candidates and keeping the minimum total squared displacement costs
 * nothing worth optimising away, and unlike a heuristic it cannot pick a
 * pairing that merely looks reasonable while missing the actual best one -
 * which matters here because the whole point is eliminating a visible
 * rotation artifact, not reducing it.
 *
 * Ties keep the earliest candidate found (`points` itself, at shift 0) since
 * only a strictly lower cost replaces the current best, so an outline that is
 * already the closest pairing to `reference` - including one that is already
 * identical to it - is returned completely unchanged.
 */
export function alignToReference(
  reference: CreativeShapeOutlinePoint[],
  points: CreativeShapeOutlinePoint[],
): CreativeShapeOutlinePoint[] {
  const count = points.length;
  if (count < 2 || reference.length !== count) return points.map((point) => ({ ...point }));

  const reversed = [...points].reverse();
  let bestCost = Infinity;
  let bestOrder = points;
  let bestShift = 0;
  for (const order of [points, reversed]) {
    for (let shift = 0; shift < count; shift += 1) {
      let cost = 0;
      for (let index = 0; index < count; index += 1) {
        cost += squaredDistance(reference[index], order[(index + shift) % count]);
      }
      if (cost < bestCost) {
        bestCost = cost;
        bestOrder = order;
        bestShift = shift;
      }
    }
  }
  return Array.from({ length: count }, (_, index) => ({ ...bestOrder[(index + bestShift) % count] }));
}

/**
 * How far through the morph at `localMs`, measured from the start of the
 * owning element's own visible window - DESIGN DECISION 4 on
 * CreativeShapeMorph. Clamped exactly like counter.ts's resolveCounterValue:
 * read before startMs it is 0 (pure `from`), and once the run has finished it
 * holds at 1 (pure `to`) rather than overshooting past it.
 */
export function resolveShapeMorphProgress(morph: CreativeShapeMorph, localMs: number): number {
  if (localMs <= morph.startMs) return 0;
  if (morph.durationMs <= 0 || localMs >= morph.startMs + morph.durationMs) return 1;
  const raw = (localMs - morph.startMs) / morph.durationMs;
  return applyCreativeEasing(morph.easing, raw);
}

function pathFrom(points: CreativeShapeOutlinePoint[]): string {
  if (points.length === 0) return "";
  return `${points.map((point, index) => `${index === 0 ? "M" : "L"}${point.x} ${point.y}`).join(" ")} Z`;
}

/**
 * The shape's resolved outline at `localMs`: progress, resample and
 * alignment composed into the one polygon a renderer draws. Both outlines are
 * resampled to `max(from.length, to.length)` (DESIGN DECISION 2), `to` is
 * then aligned onto the resampled `from` (DESIGN DECISION 3), and the result
 * is lerped point by point at the eased progress.
 *
 * `from`'s own points are never reordered - only resampled up in count when
 * it is the shorter list - so this function is deterministic given
 * `morph` alone: the same document renders the same outline on every machine
 * that resolves it, which is the entire point of a shared pure module.
 */
export function resolveShapeOutline(morph: CreativeShapeMorph, localMs: number): ResolvedShapeOutline {
  const progress = resolveShapeMorphProgress(morph, localMs);
  const count = Math.max(morph.from.points.length, morph.to.points.length);
  const fromPoints = resamplePolygon(morph.from.points, count);
  const toResampled = resamplePolygon(morph.to.points, count);
  const toPoints = alignToReference(fromPoints, toResampled);

  const points = fromPoints.map((point, index) => ({
    x: point.x + (toPoints[index].x - point.x) * progress,
    y: point.y + (toPoints[index].y - point.y) * progress,
  }));
  return { points, path: pathFrom(points) };
}

/** Re-exported for tests and any caller that only needs the outline shape, not the morph timing. */
export type { CreativeShapeOutline };
