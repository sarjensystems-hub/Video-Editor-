import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { resolveMaskCss, resolveMotionBlur } from "./mask";

describe("resolveMaskCss", () => {
  it("returns nothing when there is no mask", () => {
    expect(resolveMaskCss(undefined)).toBeUndefined();
  });

  it("builds an elliptical mask centred on its box", () => {
    const css = resolveMaskCss({ kind: "ellipse", x: 0.25, y: 0.25, width: 0.5, height: 0.5 })!;
    expect(css.maskImage).toContain("radial-gradient");
    expect(css.maskImage).toContain("at 50% 50%");
  });

  it("keeps the inside and drops the outside by default, and flips when inverted", () => {
    const normal = resolveMaskCss({ kind: "rect", x: 0, y: 0, width: 1, height: 1 })!;
    const inverted = resolveMaskCss({ kind: "rect", x: 0, y: 0, width: 1, height: 1, invert: true })!;
    expect(normal.maskImage).not.toBe(inverted.maskImage);
    expect(normal.maskImage).toContain("black");
    expect(inverted.maskImage).toContain("transparent");
  });

  it("softens the edge when feathered", () => {
    const hard = resolveMaskCss({ kind: "rect", x: 0.1, y: 0, width: 0.8, height: 1 })!;
    const soft = resolveMaskCss({ kind: "rect", x: 0.1, y: 0, width: 0.8, height: 1, feather: 0.4 })!;
    expect(soft.maskImage).not.toBe(hard.maskImage);
  });

  it("feathers the horizontal and the vertical edges of a rect", () => {
    // A full-width scrim is the case this got wrong: only "to right" was
    // emitted, so the top edge — the one that shows against footage — stayed
    // hard however high feather was set.
    const scrim = resolveMaskCss({ kind: "rect", x: 0, y: 0.6, width: 1, height: 0.4, feather: 0.3 })!;
    expect(scrim.maskImage).toContain("to right");
    expect(scrim.maskImage).toContain("to bottom");
  });

  it("clips a rect vertically, not only horizontally", () => {
    // y and height were computed and then never used on the rect path, which
    // made every rect mask a full-height vertical bar.
    const band = resolveMaskCss({ kind: "rect", x: 0, y: 0.25, width: 1, height: 0.5 })!;
    expect(band.maskImage).toContain("25%");
    expect(band.maskImage).toContain("75%");
  });

  it("intersects the two axes, and unions them when inverted", () => {
    // Keeping the inside means inside-x AND inside-y. Its negation is
    // outside-x OR outside-y, so an inverted rect has to add, not intersect.
    const normal = resolveMaskCss({ kind: "rect", x: 0.2, y: 0.2, width: 0.6, height: 0.6 })!;
    const inverted = resolveMaskCss({ kind: "rect", x: 0.2, y: 0.2, width: 0.6, height: 0.6, invert: true })!;
    expect(normal.maskComposite).toBe("intersect");
    expect(inverted.maskComposite).toBe("add");
  });

  it("leaves an ellipse as a single layer with nothing to composite", () => {
    const css = resolveMaskCss({ kind: "ellipse", x: 0, y: 0, width: 1, height: 1, feather: 0.2 })!;
    expect(css.maskComposite).toBeUndefined();
  });

  it("keeps the horizontal feather it always had, so existing films do not move", () => {
    // The vertical axis is the fix; the horizontal one shipped correct and its
    // stops must not shift underneath documents already authored against them.
    const css = resolveMaskCss({ kind: "rect", x: 0.1, y: 0, width: 0.8, height: 1, feather: 0.4 })!;
    const horizontal = css.maskImage.split(", linear-gradient(to bottom")[0];
    expect(horizontal).toContain("10%");
    expect(horizontal).toContain("26%");
    expect(horizontal).toContain("74%");
    expect(horizontal).toContain("90%");
  });

  it("feathers by the arithmetic the schema documents", () => {
    // The schema comment claimed "a fraction of the shorter axis" while the
    // code did something else, and a caller who trusted it sized a scrim from
    // the wrong model. The documented worked example is pinned here so the
    // comment and the code cannot drift apart again: a mask 0.4 tall with
    // feather 0.3 fades over 0.3 / 2 * 0.4 = 6% of the element box per edge.
    const css = resolveMaskCss({ kind: "rect", x: 0, y: 0.6, width: 1, height: 0.4, feather: 0.3 })!;
    const vertical = css.maskImage.slice(css.maskImage.indexOf("linear-gradient(to bottom"));
    expect(vertical).toBe("linear-gradient(to bottom, transparent 60%, black 66%, black 94%, transparent 100%)");
  });

  it("clamps out-of-range geometry rather than emitting broken CSS", () => {
    const css = resolveMaskCss({ kind: "rect", x: -5, y: 9, width: 12, height: 0 })!;
    expect(css.maskImage).not.toContain("NaN");
    // No negative percentages; hyphens in "linear-gradient" are fine.
    expect(css.maskImage).not.toMatch(/-\d/);
  });

  it("is deterministic for identical input", () => {
    const mask = { kind: "ellipse" as const, x: 0.1, y: 0.2, width: 0.5, height: 0.6, feather: 0.2 };
    expect(resolveMaskCss(mask)).toEqual(resolveMaskCss({ ...mask }));
  });
});

describe("resolveMotionBlur", () => {
  it("returns nothing without a motion blur setting", () => {
    expect(resolveMotionBlur(undefined, 100, 100)).toBeUndefined();
  });

  it("returns nothing for a still element, so stillness costs nothing", () => {
    expect(resolveMotionBlur({ shutterAngle: 180 }, 0, 0)).toBeUndefined();
  });

  it("smears along the direction of travel only", () => {
    const horizontal = resolveMotionBlur({ shutterAngle: 180 }, 60, 0)!;
    expect(horizontal.stdDeviationX).toBeGreaterThan(0);
    expect(horizontal.stdDeviationY).toBe(0);

    const vertical = resolveMotionBlur({ shutterAngle: 180 }, 0, 60)!;
    expect(vertical.stdDeviationY).toBeGreaterThan(0);
    expect(vertical.stdDeviationX).toBe(0);
  });

  it("smears more at a wider shutter angle", () => {
    const narrow = resolveMotionBlur({ shutterAngle: 90 }, 100, 0)!;
    const wide = resolveMotionBlur({ shutterAngle: 360 }, 100, 0)!;
    expect(wide.stdDeviationX).toBeGreaterThan(narrow.stdDeviationX);
  });

  it("respects the pixel cap so a fast move cannot smear into mush", () => {
    const capped = resolveMotionBlur({ shutterAngle: 360, maxBlurPx: 4 }, 10_000, 0)!;
    expect(capped.stdDeviationX).toBe(4);
  });

  it("treats a closed shutter as no blur", () => {
    expect(resolveMotionBlur({ shutterAngle: 0 }, 500, 500)).toBeUndefined();
  });

  it("ignores the sign of velocity, since blur has no direction of travel", () => {
    const forward = resolveMotionBlur({ shutterAngle: 180 }, 80, 0)!;
    const backward = resolveMotionBlur({ shutterAngle: 180 }, -80, 0)!;
    expect(forward).toEqual(backward);
  });
});

/**
 * The editor preview and the Remotion renderer both consume `ResolvedMask`.
 * A still that does not match its own MP4 is the one defect this product
 * cannot afford, so every property the module resolves has to be applied by
 * both — a mask that composites in one and not the other renders a rect as a
 * cross in exactly one of them.
 */
describe("both renderers apply the whole resolved mask", () => {
  const ROOT = resolve(__dirname, "..", "..");
  const CONSUMERS = [
    "components/creative/CreativeScenePreview.tsx",
    "remotion/CreativeComposition.tsx",
  ];

  const resolvedKeys = Object.keys(
    resolveMaskCss({ kind: "rect", x: 0, y: 0, width: 1, height: 1, feather: 0.2 })!,
  );

  it("resolves the keys this test expects to police", () => {
    expect(resolvedKeys).toContain("maskComposite");
    expect(resolvedKeys).toContain("webkitMaskComposite");
  });

  for (const consumer of CONSUMERS) {
    it(`${consumer} reads every resolved property`, () => {
      const source = readFileSync(resolve(ROOT, consumer), "utf8");
      for (const key of resolvedKeys) {
        expect(source, `${consumer} never reads maskCss.${key}`).toContain(`maskCss?.${key}`);
      }
    });
  }
});
