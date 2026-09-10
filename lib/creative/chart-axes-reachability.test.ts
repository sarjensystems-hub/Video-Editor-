import { describe, expect, it } from "vitest";
import { CREATIVE_OPERATION_SCHEMA } from "./operation-contract";
import { applyCreativeTransaction } from "./transactions";
import { validateCreativeDocument } from "./validate";
import type { CreativeDocument } from "./schema";

/**
 * Axes are only worth building if an agent can actually reach them.
 *
 * Three descriptions of one contract have to agree: the advertised schema, the
 * transaction that applies the change, and the validator that accepts the
 * result. This repo has shipped a capability that was built, tested and
 * unreachable four times, every time because only two of the three were
 * checked together.
 */

function chartFilm(): CreativeDocument {
  return {
    version: 1,
    id: "doc",
    title: "Film",
    canvas: { width: 1080, height: 1080, fps: 30, background: { kind: "literal", value: "#fff" } },
    designSystem: {
      colors: { ink: "#111" },
      typography: {
        caption: {
          fontFamily: "Inter", fontSize: 20, fontWeight: 400, lineHeight: 1.2,
          letterSpacing: 0, align: "left", color: { kind: "literal", value: "#111" },
        },
      },
      spacing: {},
      radii: {},
      strokes: {},
      motion: { presets: {}, sceneTransitions: {} },
    },
    scenes: [{
      id: "scene-1",
      name: "Scene",
      durationMs: 3000,
      groups: [],
      elements: [{
        id: "chart-1",
        name: "Revenue",
        type: "chart",
        chartKind: "bar",
        series: [10, 40, 90],
        stroke: { width: 2, color: { kind: "token", token: "ink" } },
        transform: {
          x: 100, y: 100, width: 600, height: 300, rotation: 0,
          opacity: 1, anchorX: 0.5, anchorY: 0.5, zIndex: 1,
        },
      }],
    }],
  } as unknown as CreativeDocument;
}

const AXES_OPERATION = {
  type: "set_chart_axes",
  sceneId: "scene-1",
  elementId: "chart-1",
  axes: {
    yTicks: 3, gridlines: true, yLine: true, xLine: true,
    categories: ["Q1", "Q2", "Q3"], valueLabels: true,
    format: "compact", precision: 0,
  },
  callouts: [{ index: 2, text: "best quarter", dx: 0.05, dy: -0.15 }],
  labelStyle: { token: "caption" },
} as const;

describe("chart axes are reachable through the advertised contract", () => {
  it("advertises the operation and every field it takes", () => {
    const text = JSON.stringify(CREATIVE_OPERATION_SCHEMA);
    expect(text).toContain('"set_chart_axes"');
    // additionalProperties is false, so a field missing from the schema is
    // rejected rather than merely undocumented.
    for (const field of [
      "yTicks", "gridlines", "yLine", "xLine", "categories",
      "valueLabels", "precision", "callouts", "labelStyle",
      // Per-callout timing, roadmap #69.
      "startMs", "durationMs", "fadeMs",
    ]) {
      expect(text, `${field} is accepted by the engine but not advertised`).toContain(`"${field}"`);
    }
  });

  it("applies through a transaction and leaves a document that validates", () => {
    const result = applyCreativeTransaction(chartFilm(), { summary: "set chart axes", operations: [AXES_OPERATION] } as never);
    expect(result.ok, "ok" in result && !result.ok ? JSON.stringify(result.error) : "").toBe(true);

    const document = (result as { ok: true; document: CreativeDocument }).document;
    const chart = document.scenes[0].elements[0] as unknown as Record<string, unknown>;
    expect(chart.axes).toMatchObject({ yTicks: 3, categories: ["Q1", "Q2", "Q3"] });
    expect(chart.callouts).toHaveLength(1);

    expect(validateCreativeDocument(document).issues).toEqual([]);
  });

  it("refuses labels with no typography to draw them in", () => {
    // Chart text has no element of its own to inherit a style from, so this
    // would otherwise render nothing and read as a layout bug.
    const { labelStyle: _dropped, ...withoutStyle } = AXES_OPERATION;
    const result = applyCreativeTransaction(chartFilm(), { summary: "set chart axes", operations: [withoutStyle] } as never);

    // The transaction validates its own result, so the edit is refused whole
    // rather than landing a chart whose labels would silently not draw.
    expect(result.ok).toBe(false);
    expect((result as { ok: false; error: { message: string } }).error.message).toContain("labelStyle");
    expect(result.document.scenes[0].elements[0]).not.toHaveProperty("axes");
  });

  it("refuses a callout pointing past the end of the series", () => {
    const result = applyCreativeTransaction(chartFilm(), {
      summary: "set chart axes",
      operations: [{ ...AXES_OPERATION, callouts: [{ index: 7, text: "nowhere" }] }],
    } as never);
    expect(result.ok).toBe(false);
    expect((result as { ok: false; error: { message: string } }).error.message).toContain("callouts");
  });

  it("refuses to set axes on something that is not a chart", () => {
    const document = chartFilm();
    (document.scenes[0].elements[0] as unknown as { type: string }).type = "shape";
    const result = applyCreativeTransaction(document, { summary: "set chart axes", operations: [AXES_OPERATION] } as never);
    expect(result.ok).toBe(false);
  });
});

/**
 * Row #69: a callout's startMs/durationMs/fadeMs are new fields on the same
 * shape AXES_OPERATION already exercises, so this reuses that fixture rather
 * than inventing a second one - the chart is `chart-1` in a 3000ms scene-1,
 * with no timing of its own, so its own visible window is the full [0, 3000).
 */
describe("per-callout timing is reachable through the advertised contract", () => {
  it("applies through a transaction and leaves a document that validates", () => {
    const result = applyCreativeTransaction(chartFilm(), {
      summary: "set chart axes",
      operations: [{ ...AXES_OPERATION, callouts: [{ index: 2, text: "best quarter", dx: 0.05, dy: -0.15, startMs: 500, durationMs: 2000, fadeMs: 200 }] }],
    } as never);
    expect(result.ok, "ok" in result && !result.ok ? JSON.stringify(result.error) : "").toBe(true);

    const document = (result as { ok: true; document: CreativeDocument }).document;
    const chart = document.scenes[0].elements[0] as unknown as Record<string, unknown>;
    expect(chart.callouts).toMatchObject([{ startMs: 500, durationMs: 2000, fadeMs: 200 }]);
    expect(validateCreativeDocument(document).issues).toEqual([]);
  });

  it("refuses a callout starting at or after the chart's own visible window ends", () => {
    const result = applyCreativeTransaction(chartFilm(), {
      summary: "set chart axes",
      // The chart's own window is [0, 3000) - 3000 is one ms past the end.
      operations: [{ ...AXES_OPERATION, callouts: [{ index: 2, text: "late", startMs: 3000 }] }],
    } as never);
    expect(result.ok).toBe(false);
    expect((result as { ok: false; error: { message: string } }).error.message).toContain("startMs");
  });

  it("refuses a callout whose run would outlast the chart's own visible window", () => {
    // Starts inside the window but 200ms of duration pushes the end past it -
    // the same run-must-fit shape set_counter's own window check follows,
    // against the chart element's window rather than the callout's own.
    const result = applyCreativeTransaction(chartFilm(), {
      summary: "set chart axes",
      operations: [{ ...AXES_OPERATION, callouts: [{ index: 2, text: "late", startMs: 2900, durationMs: 200 }] }],
    } as never);
    expect(result.ok).toBe(false);
  });

  it("refuses durationMs with no startMs to measure it from", () => {
    const result = applyCreativeTransaction(chartFilm(), {
      summary: "set chart axes",
      operations: [{ ...AXES_OPERATION, callouts: [{ index: 2, text: "peak", durationMs: 500 }] }],
    } as never);
    expect(result.ok).toBe(false);
    expect((result as { ok: false; error: { message: string } }).error.message).toContain("durationMs");
  });

  it("refuses fadeMs with no startMs to measure it from", () => {
    const result = applyCreativeTransaction(chartFilm(), {
      summary: "set chart axes",
      operations: [{ ...AXES_OPERATION, callouts: [{ index: 2, text: "peak", fadeMs: 300 }] }],
    } as never);
    expect(result.ok).toBe(false);
    expect((result as { ok: false; error: { message: string } }).error.message).toContain("fadeMs");
  });

  it("refuses a fade longer than the run it belongs to", () => {
    // The same rule an audio clip's fadeInMs/fadeOutMs already follow: a
    // fade that outlasts its own duration would never reach full opacity.
    const result = applyCreativeTransaction(chartFilm(), {
      summary: "set chart axes",
      operations: [{ ...AXES_OPERATION, callouts: [{ index: 2, text: "peak", startMs: 0, durationMs: 500, fadeMs: 600 }] }],
    } as never);
    expect(result.ok).toBe(false);
    expect((result as { ok: false; error: { message: string } }).error.message).toContain("fadeMs");
  });

  it("keeps an untimed callout on the same shape it always had, alongside a timed one", () => {
    // Sparse by design: a caller times the callouts that need it and leaves
    // the rest exactly as they were, in the same array.
    const result = applyCreativeTransaction(chartFilm(), {
      summary: "set chart axes",
      operations: [{
        ...AXES_OPERATION,
        callouts: [
          { index: 0, text: "start" },
          { index: 2, text: "best quarter", startMs: 500, durationMs: 2000 },
        ],
      }],
    } as never);
    expect(result.ok, "ok" in result && !result.ok ? JSON.stringify(result.error) : "").toBe(true);
    const document = (result as { ok: true; document: CreativeDocument }).document;
    expect(validateCreativeDocument(document).issues).toEqual([]);
  });
});
