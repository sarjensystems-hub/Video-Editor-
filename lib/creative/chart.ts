/**
 * Chart geometry: turning one numeric series into drawable line, area and
 * bar shapes, revealed progressively by drawProgress/fillProgress.
 *
 * This module decides; the renderers apply. Coordinates are normalized to a
 * 0..1 box, y-down like SVG, so a renderer can draw into a
 * `viewBox="0 0 1 1"` that stretches to fill the element's own box whatever
 * its actual pixel size is - the same "resolve in box-relative units, let
 * the renderer scale it" approach hierarchy.ts and mask.ts already use.
 * Stroke width is a renderer concern applied with
 * `vector-effect="non-scaling-stroke"` so a chart's line weight reads the
 * same physical thickness whatever size the element is drawn at; that is
 * why a resolved bar or point never carries one.
 *
 * The generated parts - the series line, the area fill, every point/bar -
 * are individually addressable rather than one opaque picture. Each carries
 * a stable id derived from the element's own id and the point's index in
 * `series`, so a caller can name "point 3 of chart-1" without that point
 * being a stored object anywhere in the document. Editing a value in place
 * does not change its id; inserting or removing a point shifts every later
 * index, the same as it would for any array position.
 */
import type {
  ChartLabelFormat,
  CreativeChartAxes,
  CreativeChartCallout,
  ColorValue,
  CreativeChartElement,
  CreativeChartKind,
  CreativeChartPointEmphasis,
} from "./schema";

const clamp01 = (value: number) => Math.min(1, Math.max(0, value));
const clampToRange = (value: number, min: number, max: number) => Math.min(max, Math.max(min, value));

/** Marker radius as a fraction of the box, before an emphasis scale is applied. */
const BASE_MARKER_RADIUS = 0.018;
/** Fraction of each bar's own slot left as a gap, so bars read as distinct at any series length. */
const BAR_GAP_FRACTION = 0.3;
/** Sentinel index for the interpolated point at a reveal's leading edge - it is not a real series entry. */
const LEAD_POINT_INDEX = -1;

export type ChartGeometryInput = Pick<
  CreativeChartElement,
  "chartKind" | "series" | "axisMin" | "axisMax" | "pointEmphasis" | "staggerPoints"
>;

export interface ChartAxisBounds {
  min: number;
  max: number;
}

export interface ChartPointEmphasis {
  /** Marker radius, normalized like x/y. */
  radius: number;
  color?: ColorValue;
}

export interface ChartPoint {
  id: string;
  /** Index into the series, or -1 for the interpolated point a reveal stopped mid-segment on. */
  index: number;
  value: number;
  x: number;
  y: number;
  /** Present only on a real, indexed point (never the interpolated leading one) that carries emphasis. */
  emphasis?: ChartPointEmphasis;
}

export interface ResolvedChartBar {
  id: string;
  index: number;
  x: number;
  width: number;
  y: number;
  height: number;
  /** Overrides the chart's own fill for this bar; set only when the bar carries emphasis with a colour. */
  fill?: ColorValue;
}

export interface ResolvedChartDonutSegment {
  id: string;
  index: number;
  path: string;
  fill?: ColorValue;
}

export interface ResolvedChartProgressBar {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface ResolvedChartGeometry {
  chartKind: CreativeChartKind;
  /** The points drawProgress has revealed, line and area alike. Empty for "bar". */
  points: ChartPoint[];
  /** SVG path data for the series edge, built from `points`. Empty string when nothing is revealed yet. */
  linePath: string;
  /**
   * SVG path data closing the fill-revealed edge down to the zero baseline.
   * Present only for "area", and only once fillProgress has revealed at
   * least two points - one point has no width to enclose.
   */
  areaPath?: string;
  /** The points fillProgress has revealed, independent of `points`/drawProgress. Present only for "area". */
  fillPoints?: ChartPoint[];
  /** One rect per series value. Present only for "bar". */
  bars?: ResolvedChartBar[];
  /** Ring wedges for a donut chart, already reveal-clipped. */
  donutSegments?: ResolvedChartDonutSegment[];
  /** A normalized horizontal progress bar driven by series[0]. */
  progressBar?: ResolvedChartProgressBar;
}

export function chartPointId(elementId: string, index: number): string {
  return `${elementId}.point.${index}`;
}
export function chartSeriesId(elementId: string): string {
  return `${elementId}.series`;
}
export function chartAreaId(elementId: string): string {
  return `${elementId}.area`;
}
export function chartAxesId(elementId: string): string {
  return `${elementId}.axes`;
}
function chartLeadPointId(elementId: string): string {
  return `${elementId}.point.lead`;
}

/**
 * The value range the chart's y axis actually shows.
 *
 * Explicit axisMin/axisMax are trusted as given - a caller who set them
 * wants that scale, whether it is zoomed into a narrow band or deliberately
 * excludes zero. Left to derive on its own, a bar or area envelopes zero,
 * because a bar not anchored to zero misrepresents its own magnitude and an
 * area needs a baseline to fill down to. A line does not need one and stays
 * tight to the data instead, which is what makes the classic "price chart"
 * reading work - forcing zero into a line tracking a narrow band would flatten
 * the very variation the chart exists to show.
 */
export function resolveChartAxisBounds(
  chart: Pick<ChartGeometryInput, "chartKind" | "series" | "axisMin" | "axisMax">,
): ChartAxisBounds {
  if (chart.chartKind === "progress" && chart.axisMin === undefined && chart.axisMax === undefined) {
    return { min: 0, max: 100 };
  }
  const values = chart.series.length ? chart.series : [0];
  const dataMin = Math.min(...values);
  const dataMax = Math.max(...values);
  let min = chart.axisMin ?? dataMin;
  let max = chart.axisMax ?? dataMax;
  if (
    chart.axisMin === undefined && chart.axisMax === undefined &&
    chart.chartKind !== "line" && chart.chartKind !== "sparkline" && chart.chartKind !== "donut"
  ) {
    min = Math.min(min, 0);
    max = Math.max(max, 0);
  }
  return { min, max };
}

/**
 * A value's position on the y axis: 0..1 and inverted like SVG, so a high
 * value sits near 0, the top. A flat axis - every series value equal, or
 * explicit bounds set equal - has no span to divide by, so it resolves to
 * one flat line through the middle instead of dividing by zero.
 */
function normalizeY(value: number, bounds: ChartAxisBounds): number {
  const span = bounds.max - bounds.min;
  if (span <= 0) return 0.5;
  return 1 - clamp01((value - bounds.min) / span);
}

/** A lone point has no second point to space itself against, so it sits centred. */
function xForIndex(index: number, count: number): number {
  return count <= 1 ? 0.5 : index / (count - 1);
}

function emphasisFor(
  index: number,
  entries: CreativeChartPointEmphasis[] | undefined,
): ChartPointEmphasis | undefined {
  const entry = entries?.find((item) => item.index === index);
  if (!entry) return undefined;
  return { radius: BASE_MARKER_RADIUS * (entry.scale ?? 1), color: entry.color };
}

function fullPoints(elementId: string, chart: ChartGeometryInput, bounds: ChartAxisBounds): ChartPoint[] {
  return chart.series.map((value, index) => ({
    id: chartPointId(elementId, index),
    index,
    value,
    x: xForIndex(index, chart.series.length),
    y: normalizeY(value, bounds),
    emphasis: emphasisFor(index, chart.pointEmphasis),
  }));
}

/**
 * The leading portion of `points` that `progress` has revealed.
 *
 * Reveals by walking the point sequence rather than by arc length, so an
 * evenly-spaced series draws at an even visual rate without the module
 * having to measure path length. The boundary is one interpolated point -
 * carrying the blended value rather than a real series index, and never
 * emphasis, which belongs to real points only - so the leading edge moves
 * smoothly between keyframe-driven progress values instead of jumping node
 * to node.
 */
function revealPoints(elementId: string, points: ChartPoint[], progressRaw: number): ChartPoint[] {
  const progress = clamp01(progressRaw);
  if (points.length === 0 || progress <= 0) return [];
  if (points.length === 1) return [points[0]];

  const reach = progress * (points.length - 1);
  const wholeIndex = Math.min(points.length - 1, Math.floor(reach));
  const revealed = points.slice(0, wholeIndex + 1);
  const frac = reach - wholeIndex;
  if (wholeIndex < points.length - 1 && frac > 0) {
    const from = points[wholeIndex];
    const to = points[wholeIndex + 1];
    revealed.push({
      id: chartLeadPointId(elementId),
      index: LEAD_POINT_INDEX,
      value: from.value + (to.value - from.value) * frac,
      x: from.x + (to.x - from.x) * frac,
      y: from.y + (to.y - from.y) * frac,
    });
  }
  return revealed;
}

function linePathFrom(points: ChartPoint[]): string {
  if (points.length === 0) return "";
  return points.map((point, index) => `${index === 0 ? "M" : "L"}${point.x} ${point.y}`).join(" ");
}

function areaPathFrom(points: ChartPoint[], baselineY: number): string | undefined {
  if (points.length < 2) return undefined;
  const first = points[0];
  const last = points[points.length - 1];
  return [
    `M${first.x} ${baselineY}`,
    ...points.map((point) => `L${point.x} ${point.y}`),
    `L${last.x} ${baselineY}`,
    "Z",
  ].join(" ");
}

/**
 * Every bar grows from the baseline to its full height as drawProgress goes
 * 0..1, rather than revealing bars one at a time - staggering bars
 * individually is the "staggerPoints" primitive the roadmap scopes out of
 * this increment, not a free variant of drawProgress. A negative value
 * grows downward from the baseline instead of up, which falls out of the
 * same min/height arithmetic without a special case.
 */
function staggeredProgress(progressRaw: number, index: number, count: number, amountRaw = 0): number {
  const progress = clamp01(progressRaw);
  const amount = clamp01(amountRaw);
  if (count <= 1 || amount <= 0) return progress;
  // Up to 80% of the master draw window is available for delays; the last
  // item always retains at least 20% of the window to finish its own motion.
  const delayShare = amount * 0.8;
  const delay = (index / (count - 1)) * delayShare;
  return clamp01((progress - delay) / Math.max(0.0001, 1 - delayShare));
}

function polarPoint(angle: number, radius: number): { x: number; y: number } {
  return { x: 0.5 + Math.cos(angle) * radius, y: 0.5 + Math.sin(angle) * radius };
}

function donutPath(start: number, end: number): string {
  const outer = 0.46;
  const inner = 0.28;
  const a = polarPoint(start, outer);
  const b = polarPoint(end, outer);
  const c = polarPoint(end, inner);
  const d = polarPoint(start, inner);
  const span = Math.max(0, end - start);
  const large = span > Math.PI ? 1 : 0;
  return `M${a.x} ${a.y} A${outer} ${outer} 0 ${large} 1 ${b.x} ${b.y} L${c.x} ${c.y} A${inner} ${inner} 0 ${large} 0 ${d.x} ${d.y} Z`;
}

function donutSegmentsFrom(
  elementId: string,
  chart: ChartGeometryInput,
  drawProgress: number,
): ResolvedChartDonutSegment[] {
  const values = chart.series.map((value) => Math.max(0, value));
  const total = values.reduce((sum, value) => sum + value, 0);
  if (total <= 0 || drawProgress <= 0) return [];
  const revealEnd = -Math.PI / 2 + Math.PI * 2 * clamp01(drawProgress);
  let cursor = -Math.PI / 2;
  const segments: ResolvedChartDonutSegment[] = [];
  values.forEach((value, index) => {
    const fullEnd = cursor + (value / total) * Math.PI * 2;
    const visibleEnd = Math.min(fullEnd, revealEnd);
    if (visibleEnd > cursor + 1e-6) {
      const emphasis = chart.pointEmphasis?.find((entry) => entry.index === index);
      segments.push({
        id: chartPointId(elementId, index),
        index,
        path: donutPath(cursor, visibleEnd),
        fill: emphasis?.color,
      });
    }
    cursor = fullEnd;
  });
  return segments;
}

function progressBarFrom(chart: ChartGeometryInput, bounds: ChartAxisBounds, drawProgress: number): ResolvedChartProgressBar {
  const value = chart.series[0] ?? bounds.min;
  const span = bounds.max - bounds.min;
  const ratio = span <= 0 ? 0 : clamp01((value - bounds.min) / span);
  return { x: 0, y: 0.41, width: ratio * clamp01(drawProgress), height: 0.18 };
}

function barsFrom(
  elementId: string,
  chart: ChartGeometryInput,
  bounds: ChartAxisBounds,
  drawProgress: number,
): ResolvedChartBar[] {
  const progress = clamp01(drawProgress);
  const count = chart.series.length;
  const slot = 1 / Math.max(1, count);
  const gap = slot * BAR_GAP_FRACTION;
  const baselineY = normalizeY(clampToRange(0, bounds.min, bounds.max), bounds);

  return chart.series.map((value, index) => {
    const fullY = normalizeY(value, bounds);
    const localProgress = staggeredProgress(progress, index, count, chart.staggerPoints);
    const y = baselineY + (fullY - baselineY) * localProgress;
    const emphasis = chart.pointEmphasis?.find((entry) => entry.index === index);
    return {
      id: chartPointId(elementId, index),
      index,
      x: index * slot + gap / 2,
      width: Math.max(0, slot - gap),
      y: Math.min(y, baselineY),
      height: Math.abs(baselineY - y),
      fill: emphasis?.color,
    };
  });
}

/**
 * The chart's drawable geometry at one moment, already reveal-clipped.
 *
 * `elementId` names the chart whose parts are being addressed, not a track
 * to resolve - drawProgress and fillProgress arrive already resolved by
 * `evaluate.ts` through the ordinary keyframe vocabulary, the same way a
 * hierarchy transform arrives pre-resolved into `hierarchy.ts`. This
 * function only ever turns numbers already decided elsewhere into shapes.
 */
export function resolveChartGeometry(
  elementId: string,
  chart: ChartGeometryInput,
  drawProgress: number,
  fillProgress: number,
): ResolvedChartGeometry {
  const bounds = resolveChartAxisBounds(chart);

  if (chart.chartKind === "donut") {
    return {
      chartKind: chart.chartKind,
      points: [],
      linePath: "",
      donutSegments: donutSegmentsFrom(elementId, chart, drawProgress),
    };
  }

  if (chart.chartKind === "progress") {
    return {
      chartKind: chart.chartKind,
      points: [],
      linePath: "",
      progressBar: progressBarFrom(chart, bounds, drawProgress),
    };
  }

  if (chart.chartKind === "bar") {
    return {
      chartKind: chart.chartKind,
      points: [],
      linePath: "",
      bars: barsFrom(elementId, chart, bounds, drawProgress),
    };
  }

  const points = revealPoints(elementId, fullPoints(elementId, chart, bounds), drawProgress);
  const linePath = linePathFrom(points);

  if (chart.chartKind === "area") {
    const baselineY = normalizeY(clampToRange(0, bounds.min, bounds.max), bounds);
    const fillPoints = revealPoints(elementId, fullPoints(elementId, chart, bounds), fillProgress);
    return {
      chartKind: chart.chartKind,
      points,
      linePath,
      fillPoints,
      areaPath: areaPathFrom(fillPoints, baselineY),
    };
  }

  return { chartKind: chart.chartKind, points, linePath };
}

/* ------------------------------------------------------------------ *
 * Axes, gridlines and labels
 * ------------------------------------------------------------------ */

/**
 * Where a label sits and how it hangs off that point.
 *
 * Positions are normalized to the plot box exactly like point coordinates, so
 * a renderer places one with `left: x*100%` / `top: y*100%`. The anchor says
 * which corner of the text lands there, because the text's own size is a
 * rendering fact this module cannot know.
 *
 * Labels are resolved separately from the SVG geometry for a concrete reason:
 * the chart's viewBox is stretched onto the element box with
 * preserveAspectRatio="none", so text drawn inside it is stretched too - a
 * 600x200 chart would render its labels three times wider than tall. Text has
 * to live in an unstretched overlay, which means it needs positions rather
 * than paths.
 */
export interface ResolvedChartLabel {
  id: string;
  x: number;
  y: number;
  text: string;
  anchor: "start" | "middle" | "end";
  baseline: "top" | "middle" | "bottom";
  /**
   * The CSS translate that hangs the text off (x, y) per its anchor, gap
   * included.
   *
   * Resolved here rather than mapped in each renderer: two hand-written copies
   * of the same three-way map are exactly the shape of drift this project
   * keeps hitting, and a label an inch off in one runtime is invisible from
   * the other.
   */
  translate: string;
  /**
   * 1 for every label except a timed callout mid-fade, so a renderer applies
   * this unconditionally rather than deciding when opacity matters.
   */
  opacity: number;
}

/** A leader line from a callout back to the point it annotates. */
export interface ResolvedChartLeader {
  path: string;
  /** Shares the callout's own resolved opacity, so the line fades with its note. */
  opacity: number;
}

export interface ResolvedChartAxes {
  /** Value axis edge, or "" when not requested. */
  yLinePath: string;
  /** Category axis at the zero line, or "" when not requested. */
  xLinePath: string;
  /** One rule per tick, across the plot. Empty unless gridlines were asked for. */
  gridPaths: string[];
  /** Leader lines from a callout back to the point it annotates. */
  calloutLeaders: ResolvedChartLeader[];
  /** Every piece of chart text, for an unstretched overlay. */
  labels: ResolvedChartLabel[];
}

/** Clearance between a label and the plot edge it hangs off, in CSS pixels. */
const CHART_LABEL_GAP_PX = 6;

function labelTranslate(
  anchor: ResolvedChartLabel["anchor"],
  baseline: ResolvedChartLabel["baseline"],
): string {
  const x = anchor === "start" ? `${CHART_LABEL_GAP_PX}px`
    : anchor === "end" ? `calc(-100% - ${CHART_LABEL_GAP_PX}px)`
    : "-50%";
  const y = baseline === "top" ? `${CHART_LABEL_GAP_PX}px`
    : baseline === "bottom" ? `calc(-100% - ${CHART_LABEL_GAP_PX}px)`
    : "-50%";
  return `${x}, ${y}`;
}

/** Builds a label with its translate already resolved. Every label but a fading callout is fully opaque. */
function chartLabel(
  id: string,
  x: number,
  y: number,
  text: string,
  anchor: ResolvedChartLabel["anchor"],
  baseline: ResolvedChartLabel["baseline"],
  opacity = 1,
): ResolvedChartLabel {
  return { id, x, y, text, anchor, baseline, translate: labelTranslate(anchor, baseline), opacity };
}

/** Where a value sits on the vertical axis, 0 at the top. */
function valueToY(value: number, bounds: ChartAxisBounds): number {
  const span = bounds.max - bounds.min;
  if (span === 0) return 0.5;
  return (bounds.max - value) / span;
}

/**
 * Writes a number the way the chart asked for it.
 *
 * Deterministic and locale-independent: the same series must produce the same
 * label on every machine that renders it, so this does its own formatting
 * rather than reaching for toLocaleString.
 */
export function formatChartValue(
  value: number,
  format: ChartLabelFormat = "plain",
  precision = 0,
): string {
  const places = Math.max(0, Math.min(6, Math.round(precision)));
  if (format === "percent") return `${(value * 100).toFixed(places)}%`;
  if (format === "compact") {
    const units: Array<[number, string]> = [[1e9, "B"], [1e6, "M"], [1e3, "k"]];
    for (const [size, suffix] of units) {
      if (Math.abs(value) >= size) {
        const scaled = value / size;
        // One decimal below ten reads better than "1k" for 1,400.
        return `${scaled.toFixed(Math.abs(scaled) < 10 ? 1 : 0).replace(/\.0$/, "")}${suffix}`;
      }
    }
    return value.toFixed(places);
  }
  return value.toFixed(places);
}

/**
 * A callout's own opacity at `timeMs`, scene-local like the chart's own
 * drawProgress keyframes (see the doc comment on CreativeChartCallout).
 *
 * A callout with no startMs is the shape every callout had before per-callout
 * timing existed, so it is unconditionally opaque here regardless of
 * `timeMs` - the one branch that keeps an already-published film with
 * untimed callouts rendering exactly as it always has.
 *
 * Fade-in and fade-out share one `fadeMs` and are each computed independently
 * against `timeMs`, then combined with min rather than sequenced: a duration
 * too short for both ramps to complete produces a symmetric bump that peaks
 * below full opacity instead of a division that could go negative or NaN, so
 * this never needs the validator to have already rejected a bad combination
 * to stay well-defined.
 */
function resolveCalloutOpacity(callout: CreativeChartCallout, timeMs: number): number {
  if (callout.startMs === undefined) return 1;
  if (timeMs < callout.startMs) return 0;

  const fadeMs = Math.max(0, callout.fadeMs ?? 0);
  const fadeIn = fadeMs > 0 ? clamp01((timeMs - callout.startMs) / fadeMs) : 1;
  if (callout.durationMs === undefined) return fadeIn;

  const endMs = callout.startMs + callout.durationMs;
  if (timeMs >= endMs) return 0;
  const fadeOut = fadeMs > 0 ? clamp01((endMs - timeMs) / fadeMs) : 1;
  return Math.min(fadeIn, fadeOut);
}

/**
 * Axis geometry and every label a chart draws.
 *
 * Takes the geometry rather than recomputing the reveal: value labels and
 * callouts must appear exactly with the points drawProgress has uncovered, and
 * deriving that twice is how the two would drift apart. `timeMs` is
 * scene-local, the same clock `input.callouts[].startMs` is on - see
 * resolveCalloutOpacity - and is otherwise unused: axis/category/value labels
 * are gated by the reveal alone, not by time directly.
 */
export function resolveChartAnnotations(
  elementId: string,
  input: ChartGeometryInput & { axes?: CreativeChartAxes; callouts?: CreativeChartCallout[] },
  geometry: ResolvedChartGeometry,
  timeMs: number,
): ResolvedChartAxes | undefined {
  const axes = input.axes;
  const callouts = input.callouts ?? [];
  if (!axes && !callouts.length) return undefined;

  const bounds = resolveChartAxisBounds(input);
  const format = axes?.format ?? "plain";
  const precision = axes?.precision ?? 0;
  const labels: ResolvedChartLabel[] = [];
  const gridPaths: string[] = [];

  // The category axis sits at zero when zero is in view, and at the nearer
  // bound when it is not, so the baseline never floats off the plot.
  const zeroY = Math.max(0, Math.min(1, valueToY(0, bounds)));

  const tickCount = Math.max(0, Math.round(axes?.yTicks ?? 0));
  if (tickCount >= 2) {
    for (let index = 0; index < tickCount; index += 1) {
      const value = bounds.min + ((bounds.max - bounds.min) * index) / (tickCount - 1);
      const y = valueToY(value, bounds);
      if (axes?.gridlines) gridPaths.push(`M 0 ${y} L 1 ${y}`);
      labels.push(chartLabel(
        `${elementId}--tick-${index}`, 0, y,
        formatChartValue(value, format, precision), "end", "middle",
      ));
    }
  }

  // Category labels are addressed by series index so they line up with bars
  // and points alike, whichever kind this chart is.
  const columnX = (index: number): number => {
    if (geometry.bars?.length) {
      const bar = geometry.bars.find((candidate) => candidate.index === index);
      if (bar) return bar.x + bar.width / 2;
    }
    const count = input.series.length;
    return count <= 1 ? 0.5 : index / (count - 1);
  };

  (axes?.categories ?? []).forEach((text, index) => {
    if (index >= input.series.length || !text) return;
    labels.push(chartLabel(`${elementId}--category-${index}`, columnX(index), 1, text, "middle", "top"));
  });

  if (axes?.valueLabels) {
    // Only what the reveal has actually uncovered: a value printed beside a
    // point that has not been drawn yet gives away the ending.
    for (const point of geometry.points) {
      if (point.index < 0) continue;
      labels.push(chartLabel(
        `${elementId}--value-${point.index}`, point.x, point.y,
        formatChartValue(point.value, format, precision), "middle", "bottom",
      ));
    }
    for (const bar of geometry.bars ?? []) {
      labels.push(chartLabel(
        `${elementId}--value-${bar.index}`, bar.x + bar.width / 2, bar.y,
        formatChartValue(input.series[bar.index] ?? 0, format, precision), "middle", "bottom",
      ));
    }
  }

  const calloutLeaders: ResolvedChartLeader[] = [];
  for (const callout of callouts) {
    if (!Number.isInteger(callout.index) || callout.index < 0 || callout.index >= input.series.length) continue;
    const revealed = geometry.points.some((point) => point.index === callout.index)
      || (geometry.bars ?? []).some((bar) => bar.index === callout.index);
    if (!revealed) continue;
    // Before its own start, or after it has left: nothing to draw. Gated the
    // same way an unrevealed point already is above, rather than pushing an
    // invisible entry a renderer would have to know to skip.
    const opacity = resolveCalloutOpacity(callout, timeMs);
    if (opacity <= 0) continue;

    const anchorX = columnX(callout.index);
    const anchorY = valueToY(input.series[callout.index], bounds);
    const dx = Number.isFinite(callout.dx) ? callout.dx! : 0;
    const dy = Number.isFinite(callout.dy) ? callout.dy! : -0.12;
    const x = anchorX + dx;
    const y = anchorY + dy;

    calloutLeaders.push({ path: `M ${anchorX} ${anchorY} L ${x} ${y}`, opacity });
    labels.push(chartLabel(
      `${elementId}--callout-${callout.index}`, x, y, callout.text,
      dx === 0 ? "middle" : dx > 0 ? "start" : "end",
      dy > 0 ? "top" : "bottom",
      opacity,
    ));
  }

  return {
    yLinePath: axes?.yLine ? "M 0 0 L 0 1" : "",
    xLinePath: axes?.xLine ? `M 0 ${zeroY} L 1 ${zeroY}` : "",
    gridPaths,
    calloutLeaders,
    labels,
  };
}
