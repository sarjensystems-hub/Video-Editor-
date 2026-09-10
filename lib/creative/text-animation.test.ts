import { describe, expect, it } from "vitest";
import {
  estimateTextLayout,
  resolveTextUnitState,
  groupTextUnitsByLine,
  splitTextUnits,
  textAnimationTotalMs,
} from "./text-animation";
import type { CreativeTextAnimation } from "./schema";

const anim = (o: Partial<CreativeTextAnimation> = {}): CreativeTextAnimation => ({
  granularity: "word",
  mode: "rise",
  startMs: 0,
  durationMs: 400,
  staggerMs: 100,
  easing: "ease-out",
  distance: 40,
  ...o,
});

describe("splitTextUnits", () => {
  it("keeps the whole string as one unit for block granularity", () => {
    expect(splitTextUnits("STOP GUESSING.\nSTART KNOWING.", "block").map((u) => u.text))
      .toEqual(["STOP GUESSING.\nSTART KNOWING."]);
  });

  it("splits on explicit line breaks for line granularity", () => {
    const units = splitTextUnits("STOP GUESSING.\nSTART KNOWING.", "line");
    expect(units.map((u) => u.text)).toEqual(["STOP GUESSING.", "START KNOWING."]);
    expect(units.map((u) => u.lineIndex)).toEqual([0, 1]);
  });

  it("splits into words and records which line each came from", () => {
    const units = splitTextUnits("STOP GUESSING.\nSTART KNOWING.", "word");
    expect(units.map((u) => u.text)).toEqual(["STOP", "GUESSING.", "START", "KNOWING."]);
    expect(units.map((u) => u.lineIndex)).toEqual([0, 0, 1, 1]);
    expect(units.map((u) => u.index)).toEqual([0, 1, 2, 3]);
  });

  it("splits into characters and keeps spaces attached rather than animating them alone", () => {
    const units = splitTextUnits("AB C", "character");
    expect(units.map((u) => u.text)).toEqual(["A", "B", " ", "C"]);
    expect(units).toHaveLength(4);
  });

  it("handles empty and whitespace-only text without producing phantom units", () => {
    expect(splitTextUnits("", "word")).toEqual([]);
    expect(splitTextUnits("   ", "word")).toEqual([]);
    expect(splitTextUnits("", "character")).toEqual([]);
  });
});

describe("resolveTextUnitState", () => {
  it("holds units hidden before their staggered start", () => {
    const s = resolveTextUnitState(anim(), 2, 4, 0);
    expect(s.opacity).toBe(0);
    expect(s.translateY).toBe(40);
  });

  it("staggers each unit by the stagger interval", () => {
    // Unit 2 starts at 200ms and finishes at 600ms.
    expect(resolveTextUnitState(anim(), 2, 4, 199).opacity).toBe(0);
    expect(resolveTextUnitState(anim(), 2, 4, 600).opacity).toBe(1);
    expect(resolveTextUnitState(anim(), 2, 4, 400).opacity).toBeGreaterThan(0);
    expect(resolveTextUnitState(anim(), 2, 4, 400).opacity).toBeLessThan(1);
  });

  it("settles every unit at rest once the whole run has finished", () => {
    const a = anim();
    const total = textAnimationTotalMs(a, 4);
    for (let i = 0; i < 4; i += 1) {
      const s = resolveTextUnitState(a, i, 4, total);
      expect(s.opacity).toBe(1);
      expect(s.translateY).toBe(0);
      expect(s.translateX).toBe(0);
      expect(s.scale).toBe(1);
    }
  });

  it("respects a delayed start for the whole run", () => {
    const a = anim({ startMs: 1_000 });
    expect(resolveTextUnitState(a, 0, 4, 900).opacity).toBe(0);
    expect(resolveTextUnitState(a, 0, 4, 1_400).opacity).toBe(1);
  });

  it("moves along the axis the mode implies", () => {
    expect(resolveTextUnitState(anim({ mode: "rise" }), 0, 1, 0).translateY).toBe(40);
    expect(resolveTextUnitState(anim({ mode: "fall" }), 0, 1, 0).translateY).toBe(-40);
    expect(resolveTextUnitState(anim({ mode: "slide-left" }), 0, 1, 0).translateX).toBe(40);
    expect(resolveTextUnitState(anim({ mode: "slide-right" }), 0, 1, 0).translateX).toBe(-40);
    expect(resolveTextUnitState(anim({ mode: "fade" }), 0, 1, 0).translateY).toBe(0);
  });

  it("scales rather than translates for scale and punch modes", () => {
    expect(resolveTextUnitState(anim({ mode: "scale" }), 0, 1, 0).scale).toBeLessThan(1);
    // A punch overshoots above rest before settling.
    const punch = resolveTextUnitState(anim({ mode: "punch" }), 0, 1, 0);
    expect(punch.scale).toBeGreaterThan(1);
    expect(resolveTextUnitState(anim({ mode: "punch" }), 0, 1, 400).scale).toBe(1);
  });

  it("wipes a mask reveal from fully clipped to fully open", () => {
    expect(resolveTextUnitState(anim({ mode: "mask-reveal" }), 0, 1, 0).clipPercent).toBe(100);
    expect(resolveTextUnitState(anim({ mode: "mask-reveal" }), 0, 1, 400).clipPercent).toBe(0);
    expect(resolveTextUnitState(anim({ mode: "fade" }), 0, 1, 0).clipPercent).toBe(0);
  });

  it("opens tracking from wide to the styled value", () => {
    expect(resolveTextUnitState(anim({ mode: "tracking" }), 0, 1, 0).letterSpacingDelta).toBe(40);
    expect(resolveTextUnitState(anim({ mode: "tracking" }), 0, 1, 400).letterSpacingDelta).toBe(0);
  });

  it("reports the full run length including stagger", () => {
    expect(textAnimationTotalMs(anim(), 4)).toBe(700); // 3 * 100 stagger + 400 duration
    expect(textAnimationTotalMs(anim({ startMs: 500 }), 1)).toBe(900);
    expect(textAnimationTotalMs(anim(), 0)).toBe(0);
  });
});

describe("estimateTextLayout", () => {
  const style = { fontFamily: "Inter", fontSize: 64, fontWeight: 700, lineHeight: 1.1, letterSpacing: 0 };

  it("reports a single line that fits its box", () => {
    const r = estimateTextLayout("SHORT", style, { width: 900, height: 300 }, undefined);
    expect(r.lineCount).toBe(1);
    expect(r.fontSize).toBe(64);
    expect(r.overflows).toBe(false);
  });

  it("wraps long text into multiple estimated lines", () => {
    const r = estimateTextLayout(
      "FIND THE RIGHT PEOPLE FOR YOUR CAR TODAY AND TOMORROW",
      style, { width: 600, height: 600 }, undefined,
    );
    expect(r.lineCount).toBeGreaterThan(1);
  });

  it("flags overflow when the text cannot fit the box height", () => {
    const r = estimateTextLayout(
      "FIND THE RIGHT PEOPLE FOR YOUR CAR TODAY AND TOMORROW AND EVERY DAY AFTER THAT",
      style, { width: 400, height: 120 }, undefined,
    );
    expect(r.overflows).toBe(true);
  });

  it("shrinks the font to fit rather than overflowing when asked", () => {
    const box = { width: 400, height: 120 };
    const text = "FIND THE RIGHT PEOPLE FOR YOUR CAR TODAY AND TOMORROW";
    const shrunk = estimateTextLayout(text, style, box, { mode: "shrink", minFontSize: 12 });
    expect(shrunk.fontSize).toBeLessThan(64);
    expect(shrunk.overflows).toBe(false);
  });

  it("never shrinks below the minimum and still reports the overflow", () => {
    const r = estimateTextLayout(
      "FIND THE RIGHT PEOPLE FOR YOUR CAR".repeat(12),
      style, { width: 200, height: 80 }, { mode: "shrink", minFontSize: 40 },
    );
    expect(r.fontSize).toBe(40);
    expect(r.overflows).toBe(true);
  });

  it("is deterministic for the same inputs", () => {
    const box = { width: 500, height: 200 };
    const a = estimateTextLayout("BETTER CAR CARE", style, box, { mode: "shrink", minFontSize: 10 });
    const b = estimateTextLayout("BETTER CAR CARE", style, box, { mode: "shrink", minFontSize: 10 });
    expect(a).toEqual(b);
  });
});

describe("groupTextUnitsByLine", () => {
  it("keeps an authored line break as a line break for word granularity", () => {
    const units = splitTextUnits("STOP GUESSING.\nSTART KNOWING.", "word");
    const lines = groupTextUnitsByLine(units);
    expect(lines).toHaveLength(2);
    expect(lines[0].map((u) => u.text)).toEqual(["STOP", "GUESSING."]);
    expect(lines[1].map((u) => u.text)).toEqual(["START", "KNOWING."]);
    // Stagger indices stay global so the cascade runs across lines.
    expect(lines[1].map((u) => u.index)).toEqual([2, 3]);
  });

  it("drops empty lines rather than leaving holes in the array", () => {
    const lines = groupTextUnitsByLine(splitTextUnits("A\n\nB", "word"));
    expect(lines).toHaveLength(2);
  });
});
