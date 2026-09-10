import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import {
  chartAreaId,
  chartAxesId,
  chartPointId,
  chartSeriesId,
  resolveChartAxisBounds,
  resolveChartAnnotations,
  resolveChartGeometry,
  formatChartValue,
  type ChartGeometryInput,
} from "./chart";

const lineChart = (overrides: Partial<ChartGeometryInput> = {}): ChartGeometryInput => ({
  chartKind: "line",
  series: [0, 10, 20, 30, 40],
  ...overrides,
});

describe("resolveChartAxisBounds", () => {
  it("stays tight to the data for a line, even when zero is outside it", () => {
    expect(resolveChartAxisBounds({ chartKind: "line", series: [3, 7, 1, 9] })).toEqual({ min: 1, max: 9 });
  });

  it("envelopes zero for area and bar so a fill/bar always has a baseline", () => {
    expect(resolveChartAxisBounds({ chartKind: "area", series: [3, 7, 1, 9] })).toEqual({ min: 0, max: 9 });
    expect(resolveChartAxisBounds({ chartKind: "bar", series: [-3, -7, -1] })).toEqual({ min: -7, max: 0 });
  });

  it("trusts explicit bounds as given, without forcing zero into view", () => {
    expect(resolveChartAxisBounds({ chartKind: "area", series: [40, 60, 55], axisMin: 40, axisMax: 60 })).toEqual({
      min: 40,
      max: 60,
    });
  });

  it("does not envelope zero once the caller has set even one bound explicitly", () => {
    // Setting axisMin alone is a deliberate choice to exclude part of the
    // range; auto-deriving the other bound should not second-guess it back
    // toward zero.
    expect(resolveChartAxisBounds({ chartKind: "area", series: [3, 7, 9], axisMin: 1 })).toEqual({ min: 1, max: 9 });
  });
});

describe("resolveChartGeometry: line, drawProgress 0/0.5/1", () => {
  const chart = lineChart();

  it("draws nothing at drawProgress 0", () => {
    const geometry = resolveChartGeometry("chart-1", chart, 0, 0);
    expect(geometry.points).toEqual([]);
    expect(geometry.linePath).toBe("");
  });

  it("reveals exactly the first half of the points at drawProgress 0.5", () => {
    const geometry = resolveChartGeometry("chart-1", chart, 0.5, 0.5);
    expect(geometry.points.map((p) => p.index)).toEqual([0, 1, 2]);
    expect(geometry.points.map((p) => p.x)).toEqual([0, 0.25, 0.5]);
    expect(geometry.points.map((p) => p.y)).toEqual([1, 0.75, 0.5]);
    expect(geometry.linePath).toBe("M0 1 L0.25 0.75 L0.5 0.5");
  });

  it("reveals every point at drawProgress 1", () => {
    const geometry = resolveChartGeometry("chart-1", chart, 1, 1);
    expect(geometry.points).toHaveLength(5);
    expect(geometry.points.map((p) => p.index)).toEqual([0, 1, 2, 3, 4]);
    expect(geometry.linePath).toBe("M0 1 L0.25 0.75 L0.5 0.5 L0.75 0.25 L1 0");
  });

  it("interpolates a leading point mid-segment, carrying the blended value and no emphasis", () => {
    const geometry = resolveChartGeometry("chart-1", chart, 0.3, 0.3);
    // reach = 0.3 * 4 = 1.2: two whole points plus 20% of the way to the third.
    expect(geometry.points).toHaveLength(3);
    const lead = geometry.points[2];
    expect(lead.index).toBe(-1);
    expect(lead.id).toBe("chart-1.point.lead");
    expect(lead.x).toBeCloseTo(0.3, 6);
    expect(lead.y).toBeCloseTo(0.7, 6);
    expect(lead.value).toBeCloseTo(12, 6);
    expect(lead.emphasis).toBeUndefined();
  });
});

describe("resolveChartGeometry: a single-point series", () => {
  const chart = lineChart({ series: [42], axisMin: 0, axisMax: 100 });

  it("draws nothing at drawProgress 0, even though there is only one point to show", () => {
    const geometry = resolveChartGeometry("chart-1", chart, 0, 0);
    expect(geometry.points).toEqual([]);
    expect(geometry.linePath).toBe("");
  });

  it("centres the lone point and draws it as a bare moveto once progress is positive", () => {
    const geometry = resolveChartGeometry("chart-1", chart, 1, 1);
    expect(geometry.points).toHaveLength(1);
    expect(geometry.points[0]).toMatchObject({ id: "chart-1.point.0", index: 0, value: 42, x: 0.5 });
    expect(geometry.points[0].y).toBeCloseTo(0.58, 6);
    const match = geometry.linePath.match(/^M0\.5 (-?[\d.]+)$/);
    expect(match, `${geometry.linePath} is not a bare moveto`).not.toBeNull();
    expect(Number(match![1])).toBeCloseTo(0.58, 6);
  });
});

describe("resolveChartGeometry: a flat series (max equals min)", () => {
  it("does not divide by zero - every point sits on one flat line through the middle", () => {
    const chart = lineChart({ series: [5, 5, 5, 5] });
    const geometry = resolveChartGeometry("chart-1", chart, 1, 1);
    expect(geometry.points).toHaveLength(4);
    for (const point of geometry.points) {
      expect(point.y).toBe(0.5);
      expect(Number.isNaN(point.y)).toBe(false);
    }
  });

  it("also guards an explicitly flat axis, even over a series that does vary", () => {
    const chart = lineChart({ series: [1, 2, 3, 4], axisMin: 5, axisMax: 5 });
    const geometry = resolveChartGeometry("chart-1", chart, 1, 1);
    expect(geometry.points.every((point) => point.y === 0.5)).toBe(true);
  });
});

describe("resolveChartGeometry: negative values", () => {
  it("places a line's negative points correctly against explicit bounds", () => {
    const chart = lineChart({ series: [-10, -2, -8, -1], axisMin: -10, axisMax: 0 });
    const geometry = resolveChartGeometry("chart-1", chart, 1, 1);
    expect(geometry.points.map((p) => p.y)).toEqual([1, 0.2, 0.8, 0.1].map((v) => expect.closeTo(v, 6)));
  });

  it("grows a negative bar downward from the baseline instead of upward", () => {
    const chart: ChartGeometryInput = { chartKind: "bar", series: [10, -5], axisMin: -10, axisMax: 10 };

    const empty = resolveChartGeometry("chart-1", chart, 0, 0).bars!;
    expect(empty[0]).toMatchObject({ y: 0.5, height: 0 });
    expect(empty[1]).toMatchObject({ y: 0.5, height: 0 });

    const half = resolveChartGeometry("chart-1", chart, 0.5, 0.5).bars!;
    expect(half[0].y).toBeCloseTo(0.25, 6);
    expect(half[0].height).toBeCloseTo(0.25, 6);
    expect(half[1].y).toBeCloseTo(0.5, 6);
    expect(half[1].height).toBeCloseTo(0.125, 6);

    const full = resolveChartGeometry("chart-1", chart, 1, 1).bars!;
    // The positive bar rises from the middle baseline to the top of the box.
    expect(full[0].y).toBeCloseTo(0, 6);
    expect(full[0].height).toBeCloseTo(0.5, 6);
    // The negative bar hangs below the same baseline instead.
    expect(full[1].y).toBeCloseTo(0.5, 6);
    expect(full[1].height).toBeCloseTo(0.25, 6);
  });
});

describe("resolveChartGeometry: bar chart", () => {
  it("has no meaningful linePath/points - bars carry their own geometry", () => {
    const chart: ChartGeometryInput = { chartKind: "bar", series: [1, 2, 3] };
    const geometry = resolveChartGeometry("chart-1", chart, 1, 1);
    expect(geometry.points).toEqual([]);
    expect(geometry.linePath).toBe("");
    expect(geometry.bars).toHaveLength(3);
  });

  it("spaces bars evenly with a gap, in document order", () => {
    const chart: ChartGeometryInput = { chartKind: "bar", series: [1, 1, 1, 1] };
    const bars = resolveChartGeometry("chart-1", chart, 1, 1).bars!;
    expect(bars.map((bar) => bar.id)).toEqual(["chart-1.point.0", "chart-1.point.1", "chart-1.point.2", "chart-1.point.3"]);
    // Each bar's slot is 0.25 wide; a positive gap fraction narrows it and
    // centres it inside that slot.
    expect(bars[0].width).toBeLessThan(0.25);
    expect(bars[0].x).toBeCloseTo((0.25 - bars[0].width) / 2, 6);
    expect(bars[1].x).toBeCloseTo(0.25 + (0.25 - bars[1].width) / 2, 6);
  });
});

describe("resolveChartGeometry: area fillProgress reveals independently of drawProgress", () => {
  const chart: ChartGeometryInput = { chartKind: "area", series: [0, 10, 20, 30, 40] };

  it("lets the line finish drawing while the fill lags behind", () => {
    const geometry = resolveChartGeometry("chart-1", chart, 1, 0.5);
    // The line (drawProgress 1) reaches the last point.
    expect(geometry.linePath).toContain("L1 0");
    // The fill (fillProgress 0.5) only encloses the first three points; point
    // 3 (x 0.75) is not among them, even though 0.75 also happens to be
    // point 1's own y value and so is not itself a safe substring to check.
    expect(geometry.fillPoints).toHaveLength(3);
    expect(geometry.areaPath).toBeDefined();
    expect(geometry.areaPath).not.toContain("L0.75");
    expect(geometry.areaPath).toContain("L0.5 0.5");
  });

  it("lets the fill lead the line the other way", () => {
    const geometry = resolveChartGeometry("chart-1", chart, 0.25, 1);
    expect(geometry.points).toHaveLength(2); // drawProgress 0.25 over 4 segments = reach 1.0
    expect(geometry.fillPoints).toHaveLength(5);
  });

  it("has no area for a single revealed point - nothing to enclose", () => {
    const geometry = resolveChartGeometry("chart-1", chart, 0.01, 0);
    expect(geometry.fillPoints).toEqual([]);
    expect(geometry.areaPath).toBeUndefined();
  });

  it("mirrors drawProgress when fillProgress is not set independently", () => {
    // evaluate.ts resolves this default; here we just confirm the module
    // treats an explicitly-equal fillProgress the same as an implicit mirror.
    const geometry = resolveChartGeometry("chart-1", chart, 0.5, 0.5);
    expect(geometry.fillPoints).toEqual(geometry.points);
  });
});

describe("resolveChartGeometry: point emphasis", () => {
  it("marks only the emphasised line point, scaling its radius", () => {
    const chart: ChartGeometryInput = {
      chartKind: "line",
      series: [1, 2, 3],
      axisMin: 0,
      axisMax: 3,
      pointEmphasis: [{ index: 1, scale: 2, color: { kind: "literal", value: "#ff0000" } }],
    };
    const geometry = resolveChartGeometry("chart-1", chart, 1, 1);
    expect(geometry.points[0].emphasis).toBeUndefined();
    expect(geometry.points[2].emphasis).toBeUndefined();
    expect(geometry.points[1].emphasis).toBeDefined();
    expect(geometry.points[1].emphasis!.color).toEqual({ kind: "literal", value: "#ff0000" });

    const unscaled = resolveChartGeometry("chart-1", { ...chart, pointEmphasis: [{ index: 1 }] }, 1, 1);
    expect(geometry.points[1].emphasis!.radius).toBeCloseTo(unscaled.points[1].emphasis!.radius * 2, 6);
    expect(unscaled.points[1].emphasis!.radius).toBeGreaterThan(0);
  });

  it("only honours colour on a bar, as a fill override, ignoring scale", () => {
    const chart: ChartGeometryInput = {
      chartKind: "bar",
      series: [5, 8, 3],
      pointEmphasis: [{ index: 1, color: { kind: "token", token: "accent" } }],
    };
    const bars = resolveChartGeometry("chart-1", chart, 1, 1).bars!;
    expect(bars[0].fill).toBeUndefined();
    expect(bars[2].fill).toBeUndefined();
    expect(bars[1].fill).toEqual({ kind: "token", token: "accent" });
  });
});

describe("chart part ids: deterministic and derived from position, not value", () => {
  it("builds ids from the element id and the point's index", () => {
    expect(chartPointId("chart-1", 3)).toBe("chart-1.point.3");
    expect(chartSeriesId("chart-1")).toBe("chart-1.series");
    expect(chartAreaId("chart-1")).toBe("chart-1.area");
    expect(chartAxesId("chart-1")).toBe("chart-1.axes");
  });

  it("keeps a point's id stable when its value changes, and different when the element does", () => {
    const before = resolveChartGeometry("chart-1", lineChart({ series: [0, 10, 20, 30, 40] }), 1, 1);
    const after = resolveChartGeometry("chart-1", lineChart({ series: [0, 10, 99, 30, 40] }), 1, 1);
    expect(after.points[2].id).toBe(before.points[2].id);
    expect(after.points[2].id).toBe("chart-1.point.2");

    const otherElement = resolveChartGeometry("chart-2", lineChart(), 1, 1);
    expect(otherElement.points[2].id).not.toBe(before.points[2].id);
  });
});

/**
 * The mask and hierarchy bugs were a property this kind of module resolved
 * and only one renderer applied. A chart that drew correctly in the editor
 * and sat inert - or half-drawn - in the exported MP4 would be the same
 * class of defect.
 */
describe("both renderers apply the geometry this module resolves", () => {
  const ROOT = resolve(__dirname, "..", "..");
  const CONSUMERS = [
    "components/creative/CreativeScenePreview.tsx",
    "remotion/CreativeComposition.tsx",
  ];

  for (const consumer of CONSUMERS) {
    it(`${consumer} calls resolveChartGeometry and applies every resolved shape`, () => {
      const source = readFileSync(resolve(ROOT, consumer), "utf8");
      expect(source).toContain("resolveChartGeometry(");
      expect(source).toContain("geometry.linePath");
      expect(source).toContain("geometry.areaPath");
      expect(source).toContain("geometry.bars");
      expect(source, `${consumer} never renders an emphasised point's marker`).toContain("point.emphasis");
    });

    it(`${consumer} resolves drawProgress and fillProgress before drawing`, () => {
      const source = readFileSync(resolve(ROOT, consumer), "utf8");
      expect(source).toContain("drawProgress");
      expect(source).toContain("fillProgress");
    });

    it(`${consumer} applies every axis and label shape the module resolves`, () => {
      const source = readFileSync(resolve(ROOT, consumer), "utf8");
      expect(source).toContain("resolveChartAnnotations(");
      for (const shape of ["yLinePath", "xLinePath", "gridPaths", "calloutLeaders", "annotations.labels"]) {
        expect(source, `${consumer} never draws ${shape}`).toContain(shape);
      }
    });

    it(`${consumer} places labels outside the stretched viewBox`, () => {
      // Drawn inside the chart's own SVG, text is stretched by the same
      // non-uniform factor as the plot. The overlay must position from the
      // resolved coordinates and apply the resolved translate rather than
      // mapping the anchor itself.
      const source = readFileSync(resolve(ROOT, consumer), "utf8");
      expect(source).toContain("label.translate");
      expect(source).toContain("${label.x * 100}%");
      expect(source).toContain("${label.y * 100}%");
      expect(source, "label typography must resolve through the design system")
        .toContain("resolveTextStyle(document.designSystem, style)");
    });

    /**
     * Row #69: a callout's own opacity is resolved once in chart.ts from a
     * scene-local `timeMs` this renderer hands in - if either renderer forgot
     * to pass it, or forgot to apply the opacity it got back, a timed callout
     * would show at the wrong moment (or never fade) in exactly one runtime,
     * the same class of drift `drawProgress` parity already guards against.
     */
    it(`${consumer} resolves callout timing on the scene-local clock and applies the opacity chart.ts returns`, () => {
      const source = readFileSync(resolve(ROOT, consumer), "utf8");
      expect(source, `${consumer} must hand resolveChartAnnotations the scene-local time a timed callout is on`)
        .toContain("resolveChartAnnotations(element.id, element, geometry, timeMs)");
      expect(source, `${consumer} never applies a callout label's own fade`).toContain("label.opacity");
      expect(source, `${consumer} never fades a callout's leader with its own note`).toContain("leader.opacity");
    });
  }
});

describe("formatChartValue", () => {
  it("writes plain numbers at the precision asked for", () => {
    expect(formatChartValue(1234.567, "plain", 0)).toBe("1235");
    expect(formatChartValue(1234.567, "plain", 2)).toBe("1234.57");
  });

  it("abbreviates large numbers, keeping a decimal only where it reads better", () => {
    expect(formatChartValue(1400, "compact")).toBe("1.4k");
    expect(formatChartValue(12_000, "compact")).toBe("12k");
    expect(formatChartValue(3_400_000, "compact")).toBe("3.4M");
    expect(formatChartValue(2_000_000_000, "compact")).toBe("2B");
    expect(formatChartValue(950, "compact")).toBe("950");
  });

  it("writes a fraction as a percentage", () => {
    expect(formatChartValue(0.427, "percent", 1)).toBe("42.7%");
  });

  it("formats identically wherever it runs", () => {
    // Locale-dependent formatting would put a different label in the preview
    // than in the render, on a machine with a different locale.
    expect(formatChartValue(1234567.89, "plain", 2)).toBe("1234567.89");
  });
});

describe("resolveChartAnnotations", () => {
  const annotate = (
    input: Partial<ChartGeometryInput> & { axes?: unknown; callouts?: unknown } = {},
    drawProgress = 1,
    // Scene-local, per #69. Defaulted to 0 rather than made to matter: every
    // existing call below authors an untimed callout, so the exact value is
    // irrelevant to it and the tests read the same as before that field
    // existed.
    timeMs = 0,
  ) => {
    const chart = { chartKind: "line" as const, series: [0, 50, 100], ...input } as never;
    const geometry = resolveChartGeometry("chart-1", chart, drawProgress, drawProgress);
    return resolveChartAnnotations("chart-1", chart, geometry, timeMs);
  };

  it("resolves nothing when nothing was asked for", () => {
    expect(annotate()).toBeUndefined();
  });

  it("spaces ticks across the bounds and labels each one", () => {
    const axes = annotate({ axes: { yTicks: 3, gridlines: true } })!;
    const ticks = axes.labels.filter((label) => label.id.includes("--tick-"));
    expect(ticks.map((tick) => tick.text)).toEqual(["0", "50", "100"]);
    // Highest value at the top: y runs 0 at the top to 1 at the bottom.
    expect(ticks.map((tick) => tick.y)).toEqual([1, 0.5, 0]);
    expect(axes.gridPaths).toEqual(["M 0 1 L 1 1", "M 0 0.5 L 1 0.5", "M 0 0 L 1 0"]);
  });

  it("draws no ticks when fewer than two were asked for", () => {
    expect(annotate({ axes: { yTicks: 1 } })!.labels).toHaveLength(0);
  });

  it("puts the category axis at zero when zero is in view", () => {
    const inView = annotate({ series: [-50, 0, 100], chartKind: "bar", axes: { xLine: true } })!;
    // Bounds are -50..100, so zero sits a third of the way down.
    expect(inView.xLinePath).toBe("M 0 0.6666666666666666 L 1 0.6666666666666666");
  });

  it("keeps the category axis on the plot when zero is outside the bounds", () => {
    const above = annotate({ series: [200, 300], axes: { xLine: true } })!;
    expect(above.xLinePath).toBe("M 0 1 L 1 1");
  });

  it("labels categories under each column, ignoring extras", () => {
    const axes = annotate({ axes: { categories: ["Jan", "Feb", "Mar", "Apr"] } })!;
    const categories = axes.labels.filter((label) => label.id.includes("--category-"));
    expect(categories.map((label) => label.text)).toEqual(["Jan", "Feb", "Mar"]);
    expect(categories.map((label) => label.x)).toEqual([0, 0.5, 1]);
    expect(categories.every((label) => label.baseline === "top")).toBe(true);
  });

  it("centres a bar's category label on the bar, not on a point", () => {
    const axes = annotate({ chartKind: "bar", axes: { categories: ["a", "b", "c"] } })!;
    const xs = axes.labels.filter((label) => label.id.includes("--category-")).map((label) => label.x);
    // Bars occupy columns, so the first label cannot sit on the left edge.
    expect(xs[0]).toBeGreaterThan(0);
    expect(xs[2]).toBeLessThan(1);
  });

  it("only labels values the reveal has uncovered", () => {
    // Printing a value beside a point that has not been drawn gives away the
    // ending of the animation.
    const half = annotate({ axes: { valueLabels: true } }, 0.5)!;
    const shown = half.labels.filter((label) => label.id.includes("--value-"));
    expect(shown.map((label) => label.text)).toEqual(["0", "50"]);

    const full = annotate({ axes: { valueLabels: true } }, 1)!;
    expect(full.labels.filter((label) => label.id.includes("--value-"))).toHaveLength(3);
  });

  it("writes value labels in the chart's own format", () => {
    const axes = annotate({ series: [1400, 2600], axes: { valueLabels: true, format: "compact" } })!;
    expect(axes.labels.filter((l) => l.id.includes("--value-")).map((l) => l.text)).toEqual(["1.4k", "2.6k"]);
  });

  it("anchors a callout to its point and draws a leader back to it", () => {
    const axes = annotate({ callouts: [{ index: 1, text: "peak", dx: 0.1, dy: -0.2 }] })!;
    const callout = axes.labels.find((label) => label.id.includes("--callout-"))!;
    expect(callout.text).toBe("peak");
    expect(callout.x).toBeCloseTo(0.6, 10);
    expect(callout.y).toBeCloseTo(0.3, 10);
    expect(callout.anchor).toBe("start");
    // No timing at all - the pre-#69 shape - so fully opaque regardless of
    // the nowMs this was resolved at.
    expect(callout.opacity).toBe(1);
    // Built from the same numbers the label reports, so the leader always
    // lands on the note it belongs to, and shares the note's own opacity.
    expect(axes.calloutLeaders).toEqual([{ path: `M 0.5 0.5 L ${callout.x} ${callout.y}`, opacity: 1 }]);
  });

  it("holds a callout back until its point is revealed", () => {
    expect(annotate({ callouts: [{ index: 2, text: "end" }] }, 0.2)!.labels).toHaveLength(0);
    expect(annotate({ callouts: [{ index: 2, text: "end" }] }, 1)!.labels).toHaveLength(1);
  });

  it("ignores a callout pointing outside the series rather than throwing", () => {
    expect(annotate({ callouts: [{ index: 9, text: "nowhere" }] })!.labels).toHaveLength(0);
  });

  /**
   * Row #69: a callout used to be all-or-nothing with the chart itself - once
   * its point was revealed it was on screen for good. These give it its own
   * scene-local schedule, the same clock the chart's own drawProgress
   * keyframes are on (see the CreativeChartCallout doc comment for why scene-
   * local and not apply_text_animation's element-local clock).
   */
  describe("per-callout timing", () => {
    // startMs 1000, up 500ms, held to 3000, down 500ms - every case below is
    // a named point on this one schedule so the arithmetic reads as a shape,
    // not four unrelated numbers.
    const timed = { index: 1, text: "peak", startMs: 1000, durationMs: 2000, fadeMs: 500 };

    it("hides a timed callout before its own startMs, even with its point already revealed", () => {
      // drawProgress 1 means the point itself is fully revealed - the ONLY
      // reason this is absent is the callout's own clock, not the reveal.
      expect(annotate({ callouts: [timed] }, 1, 999)!.labels).toHaveLength(0);
    });

    it("shows a timed callout at full opacity once its fade-in has finished", () => {
      // 1600 is past startMs(1000)+fadeMs(500) and well short of the
      // fade-out window opening at 2500.
      const axes = annotate({ callouts: [timed] }, 1, 1600)!;
      const callout = axes.labels.find((label) => label.id.includes("--callout-"))!;
      expect(callout.opacity).toBe(1);
      expect(axes.calloutLeaders[0].opacity).toBe(1);
    });

    it("fades a callout in over fadeMs rather than snapping straight to visible", () => {
      // Exactly halfway through the 500ms fade-in that starts at startMs.
      const axes = annotate({ callouts: [timed] }, 1, 1250)!;
      const callout = axes.labels.find((label) => label.id.includes("--callout-"))!;
      expect(callout.opacity).toBeCloseTo(0.5, 5);
      // The leader is the callout's own note pointing at its data - it has to
      // fade with the text, not sit there solid while the label is half gone.
      expect(axes.calloutLeaders[0].opacity).toBeCloseTo(0.5, 5);
    });

    it("fades a callout back out before durationMs ends, then removes it", () => {
      // durationMs 2000 from startMs 1000 ends at 3000; fadeMs 500 opens the
      // fade-out at 2500, so 2750 is its own halfway point.
      const midFadeOut = annotate({ callouts: [timed] }, 1, 2750)!;
      const fading = midFadeOut.labels.find((label) => label.id.includes("--callout-"))!;
      expect(fading.opacity).toBeCloseTo(0.5, 5);

      // At and after the end instant, the callout has left for good.
      expect(annotate({ callouts: [timed] }, 1, 3000)!.labels).toHaveLength(0);
      expect(annotate({ callouts: [timed] }, 1, 60_000)!.labels).toHaveLength(0);
    });

    it("holds a callout with startMs but no durationMs for the rest of the chart's window", () => {
      // No exit configured is "appear and never leave", distinct from
      // "appear" - a far-future nowMs must still show it, at full opacity.
      const openEnded = annotate({ callouts: [{ index: 1, text: "peak", startMs: 1000 }] }, 1, 999_999)!;
      expect(openEnded.labels).toHaveLength(1);
      expect(openEnded.labels[0].opacity).toBe(1);
    });

    it("renders an untimed callout identically at every nowMs - the pre-#69 shape is exempt, not a special case of it", () => {
      // The whole point of making every timing field optional: a film
      // authored before this field existed has to keep rendering
      // pixel-identical after the upgrade, at any time the chart is on screen.
      const untimed = { index: 1, text: "peak", dx: 0.1, dy: -0.2 };
      for (const nowMs of [0, 1, 500, 60_000, -100]) {
        const axes = annotate({ callouts: [untimed] }, 1, nowMs)!;
        expect(axes.labels, `nowMs ${nowMs}`).toHaveLength(1);
        expect(axes.labels[0].opacity, `nowMs ${nowMs}`).toBe(1);
        expect(axes.calloutLeaders[0].opacity, `nowMs ${nowMs}`).toBe(1);
      }
    });
  });

  it("gives every label a stable, addressable id", () => {
    const axes = annotate({ axes: { yTicks: 2, categories: ["a", "b", "c"], valueLabels: true } })!;
    const ids = axes.labels.map((label) => label.id);
    expect(new Set(ids).size, "label ids must be unique").toBe(ids.length);
    expect(ids.every((id) => id.startsWith("chart-1--"))).toBe(true);
  });

  it("survives a flat series without dividing by a zero span", () => {
    const axes = annotate({ series: [7, 7, 7], axes: { yTicks: 3, valueLabels: true } })!;
    expect(axes.labels.every((label) => Number.isFinite(label.y))).toBe(true);
  });
});
