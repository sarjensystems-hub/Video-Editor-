import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { formatCounterValue, resolveCounterText, resolveCounterValue } from "./counter";
import { CREATIVE_OPERATION_SCHEMA } from "./operation-contract";
import { applyCreativeTransaction } from "./transactions";
import { createDefaultTransform, createEmptyCreativeDocument } from "./defaults";
import type { CreativeTextCounter } from "./schema";

const counter = (overrides: Partial<CreativeTextCounter> = {}): CreativeTextCounter => ({
  from: 0,
  to: 100,
  startMs: 200,
  durationMs: 800,
  easing: "linear",
  ...overrides,
});

describe("resolveCounterValue", () => {
  it("holds at from before the run starts, at and before startMs itself", () => {
    expect(resolveCounterValue(counter(), 0)).toBe(0);
    expect(resolveCounterValue(counter(), 200)).toBe(0);
  });

  it("reaches exactly to once the run has finished, never overshooting past it", () => {
    expect(resolveCounterValue(counter(), 1000)).toBe(100); // startMs + durationMs
    expect(resolveCounterValue(counter(), 5000)).toBe(100); // long after
  });

  it("is halfway between from and to at the run's own midpoint under linear easing", () => {
    // startMs 200 + half of an 800ms run = 600.
    expect(resolveCounterValue(counter(), 600)).toBeCloseTo(50, 5);
  });

  it("counts down as readily as up - to need not exceed from", () => {
    const down = counter({ from: 100, to: 0 });
    expect(resolveCounterValue(down, 600)).toBeCloseTo(50, 5);
    expect(resolveCounterValue(down, 1000)).toBe(0);
  });

  it("applies the requested easing instead of always interpolating linearly", () => {
    // ease-in starts slow, so at the run's time-midpoint the VALUE is still
    // behind the linear 50% - this is the entire reason to reach for it.
    const eased = resolveCounterValue(counter({ easing: "ease-in" }), 600);
    expect(eased).toBeLessThan(50);
    expect(resolveCounterValue(counter({ easing: "ease-in" }), 200)).toBe(0);
    expect(resolveCounterValue(counter({ easing: "ease-in" }), 1000)).toBe(100);
  });

  it("never divides by zero for a degenerate zero-length run", () => {
    // Validation rejects durationMs <= 0 on a persisted document (see the
    // rejection tests below), but the pure resolver still needs a defined
    // answer rather than NaN if it is ever called directly.
    expect(resolveCounterValue(counter({ durationMs: 0 }), 200)).toBe(0);
    expect(resolveCounterValue(counter({ durationMs: 0 }), 201)).toBe(100);
  });
});

describe("formatCounterValue", () => {
  it("defaults to a plain value rounded to zero decimal places", () => {
    expect(formatCounterValue(counter(), 42.7)).toBe("43");
  });

  it("respects precision", () => {
    expect(formatCounterValue(counter({ precision: 2 }), 42.567)).toBe("42.57");
  });

  it("shares chart.ts's format vocabulary rather than a second implementation of the same problem", () => {
    expect(formatCounterValue(counter({ format: "percent" }), 0.42)).toBe("42%");
    expect(formatCounterValue(counter({ format: "compact" }), 1500)).toBe("1.5k");
  });

  it("wraps the formatted number in prefix and suffix", () => {
    expect(formatCounterValue(counter({ prefix: "$", suffix: "M" }), 4)).toBe("$4M");
  });

  it("omits prefix and suffix entirely when neither is set, rather than printing 'undefined'", () => {
    expect(formatCounterValue(counter(), 7)).toBe("7");
  });
});

describe("resolveCounterText", () => {
  it("composes interpolation and formatting in one call, at start/mid/end", () => {
    const c = counter({ from: 0, to: 1000, format: "compact", suffix: " users" });
    expect(resolveCounterText(c, 0)).toBe("0 users");
    expect(resolveCounterText(c, 1000)).toBe("1k users");
    // Midway through, the count is still climbing - a real intermediate
    // value, not a frozen 0 or the final 1k.
    const mid = resolveCounterText(c, 600);
    expect(mid).not.toBe("0 users");
    expect(mid).not.toBe("1k users");
  });
});

/**
 * Advertised schema, transaction and validator are three descriptions of one
 * contract, and this repo has shipped capabilities that were built, tested and
 * unreachable because only two of the three were ever checked together.
 */
describe("set_counter is reachable through the advertised contract", () => {
  const film = () => {
    const document = createEmptyCreativeDocument({ id: "counter-doc" });
    document.scenes[0].elements = [
      {
        id: "metric",
        name: "Metric",
        type: "text",
        text: "0",
        style: { token: "heading" },
        transform: createDefaultTransform({ width: 600, height: 160 }),
        timing: { startMs: 0, endMs: 5000 },
      },
    ];
    return document;
  };

  it("advertises the operation and every field it takes", () => {
    const text = JSON.stringify(CREATIVE_OPERATION_SCHEMA);
    expect(text).toContain('"set_counter"');
    for (const field of ["from", "to", "startMs", "durationMs", "easing", "format", "precision", "prefix", "suffix"]) {
      expect(text, `${field} is accepted by the engine but not advertised`).toContain(`"${field}"`);
    }
  });

  it("applies through a transaction and leaves a document that validates", () => {
    const result = applyCreativeTransaction(film(), {
      summary: "count the metric up",
      operations: [{
        type: "set_counter", sceneId: "scene-1", elementId: "metric",
        counter: { from: 0, to: 250, startMs: 100, durationMs: 900, easing: "ease-out", suffix: "%" },
      }],
    } as never);
    expect(result.ok, "ok" in result && !result.ok ? JSON.stringify(result.error) : "").toBe(true);
    const element = result.document!.scenes[0].elements[0] as unknown as Record<string, unknown>;
    expect(element.counter).toMatchObject({ from: 0, to: 250, suffix: "%" });
  });

  it("clears the counter when the operation omits it, falling back to the authored text", () => {
    const counted = applyCreativeTransaction(film(), {
      summary: "count up",
      operations: [{
        type: "set_counter", sceneId: "scene-1", elementId: "metric",
        counter: { from: 0, to: 10, startMs: 0, durationMs: 500, easing: "linear" },
      }],
    } as never);
    expect(counted.ok).toBe(true);
    const cleared = applyCreativeTransaction(counted.document!, {
      summary: "stop counting",
      operations: [{ type: "set_counter", sceneId: "scene-1", elementId: "metric" }],
    } as never);
    expect(cleared.ok).toBe(true);
    // Cleared the way every other optional field on this element clears: the
    // key is left undefined rather than deleted, which serialises away and
    // reads as absent everywhere it matters.
    expect((cleared.document!.scenes[0].elements[0] as unknown as { counter?: unknown }).counter).toBeUndefined();
  });

  it("refuses a non-text element, since only text has content for a counter to replace", () => {
    const document = film();
    document.scenes[0].elements.push({
      id: "plate",
      name: "Plate",
      type: "shape",
      shape: "rect",
      fill: { kind: "literal", value: "#000000" },
      transform: createDefaultTransform({ zIndex: 1 }),
    });
    const result = applyCreativeTransaction(document, {
      summary: "bad target",
      operations: [{
        type: "set_counter", sceneId: "scene-1", elementId: "plate",
        counter: { from: 0, to: 1, startMs: 0, durationMs: 500, easing: "linear" },
      }],
    } as never);
    expect(result.ok).toBe(false);
  });

  // The JSON schema and the runtime parser only check that `counter`, when
  // present, is an object - shape-correctness inside it is the document
  // validator's job, the same layering set_glass and set_mask already use.
  // So every rejection below is exercised through the real transaction
  // pipeline rather than by calling a validator function in isolation.
  describe("rejects a malformed counter rather than persisting one the resolver could not render", () => {
    it("a run that outlives the element's own visible window", () => {
      const result = applyCreativeTransaction(film(), {
        summary: "runs too long",
        operations: [{
          type: "set_counter", sceneId: "scene-1", elementId: "metric",
          // The element is visible for 5000ms; this run needs 5100.
          counter: { from: 0, to: 10, startMs: 4900, durationMs: 200, easing: "linear" },
        }],
      } as never);
      expect(result.ok).toBe(false);
    });

    it("a counter missing a required field", () => {
      const result = applyCreativeTransaction(film(), {
        summary: "malformed",
        operations: [{
          type: "set_counter", sceneId: "scene-1", elementId: "metric",
          counter: { from: 0, startMs: 0, durationMs: 500, easing: "linear" }, // no `to`
        }],
      } as never);
      expect(result.ok).toBe(false);
    });

    it("an easing that is neither a named preset nor a cubic-bezier curve", () => {
      const result = applyCreativeTransaction(film(), {
        summary: "bad easing",
        operations: [{
          type: "set_counter", sceneId: "scene-1", elementId: "metric",
          counter: { from: 0, to: 1, startMs: 0, durationMs: 500, easing: "bounce" },
        }],
      } as never);
      expect(result.ok).toBe(false);
    });

    it("a format outside plain/compact/percent", () => {
      const result = applyCreativeTransaction(film(), {
        summary: "bad format",
        operations: [{
          type: "set_counter", sceneId: "scene-1", elementId: "metric",
          counter: { from: 0, to: 1, startMs: 0, durationMs: 500, easing: "linear", format: "scientific" },
        }],
      } as never);
      expect(result.ok).toBe(false);
    });

    it("a precision outside 0-6", () => {
      const result = applyCreativeTransaction(film(), {
        summary: "bad precision",
        operations: [{
          type: "set_counter", sceneId: "scene-1", elementId: "metric",
          counter: { from: 0, to: 1, startMs: 0, durationMs: 500, easing: "linear", precision: 9 },
        }],
      } as never);
      expect(result.ok).toBe(false);
    });

    it("a non-integer or negative startMs", () => {
      const result = applyCreativeTransaction(film(), {
        summary: "bad startMs",
        operations: [{
          type: "set_counter", sceneId: "scene-1", elementId: "metric",
          counter: { from: 0, to: 1, startMs: -50, durationMs: 500, easing: "linear" },
        }],
      } as never);
      expect(result.ok).toBe(false);
    });
  });
});

/**
 * Row #60's whole premise is that preview and Remotion must show the same
 * digits at the same frame. That only holds if both actually call the pure
 * resolver instead of each deciding independently what a counter shows.
 */
describe("both renderers resolve counter text through this module", () => {
  const ROOT = resolve(__dirname, "..", "..");
  const CONSUMERS = [
    "components/creative/CreativeScenePreview.tsx",
    "remotion/CreativeComposition.tsx",
  ];

  for (const consumer of CONSUMERS) {
    it(`${consumer} calls resolveCounterText rather than deciding on its own`, () => {
      const source = readFileSync(resolve(ROOT, consumer), "utf8");
      expect(source).toContain("resolveCounterText(");
    });
  }
});
