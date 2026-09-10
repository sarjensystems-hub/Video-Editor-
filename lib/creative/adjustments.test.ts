import { describe, expect, it } from "vitest";
import { adjustmentsToCssFilter, adjustmentsVignetteGradient, hasVisibleAdjustments } from "./adjustments";
import type { CreativeAdjustments } from "./schema";

describe("adjustmentsToCssFilter", () => {
  it("produces nothing when every adjustment sits at its neutral value", () => {
    expect(adjustmentsToCssFilter({})).toBeUndefined();
    expect(adjustmentsToCssFilter({ exposure: 0, contrast: 0, saturation: 0, blurPx: 0 })).toBeUndefined();
  });

  it("raises and lowers exposure around a neutral zero", () => {
    expect(adjustmentsToCssFilter({ exposure: 0.5 })).toBe("brightness(1.5)");
    expect(adjustmentsToCssFilter({ exposure: -0.5 })).toBe("brightness(0.5)");
  });

  it("maps contrast and saturation around neutral zero", () => {
    expect(adjustmentsToCssFilter({ contrast: 0.2 })).toBe("contrast(1.2)");
    expect(adjustmentsToCssFilter({ saturation: -1 })).toBe("saturate(0)");
  });

  it("expresses warmth as a sepia-and-hue pair so it reads as temperature", () => {
    const warm = adjustmentsToCssFilter({ temperature: 0.5 });
    expect(warm).toContain("sepia(");
    const cool = adjustmentsToCssFilter({ temperature: -0.5 });
    expect(cool).toContain("hue-rotate(");
    expect(warm).not.toBe(cool);
  });

  it("combines several adjustments in a stable, deterministic order", () => {
    const a = adjustmentsToCssFilter({ blurPx: 4, exposure: 0.2, saturation: 0.1 });
    const b = adjustmentsToCssFilter({ saturation: 0.1, exposure: 0.2, blurPx: 4 });
    expect(a).toBe(b);
    expect(a).toBe("brightness(1.2) saturate(1.1) blur(4px)");
  });

  it("never emits a negative blur", () => {
    expect(adjustmentsToCssFilter({ blurPx: -3 })).toBeUndefined();
  });
});

describe("vignette and grain", () => {
  it("returns no gradient at zero vignette", () => {
    expect(adjustmentsVignetteGradient({ vignette: 0 })).toBeUndefined();
    expect(adjustmentsVignetteGradient({})).toBeUndefined();
  });

  it("darkens the edges more as vignette rises", () => {
    const light = adjustmentsVignetteGradient({ vignette: 0.2 })!;
    const heavy = adjustmentsVignetteGradient({ vignette: 0.9 })!;
    expect(light).toContain("radial-gradient");
    expect(heavy).toContain("radial-gradient");
    expect(heavy).not.toBe(light);
  });

  it("knows when an adjustment block is worth rendering at all", () => {
    expect(hasVisibleAdjustments(undefined)).toBe(false);
    expect(hasVisibleAdjustments({})).toBe(false);
    expect(hasVisibleAdjustments({ exposure: 0 })).toBe(false);
    expect(hasVisibleAdjustments({ exposure: 0.1 })).toBe(true);
    expect(hasVisibleAdjustments({ vignette: 0.3 })).toBe(true);
    expect(hasVisibleAdjustments({ grain: 0.2 })).toBe(true);
  });
});

describe("adjustment ranges", () => {
  it("clamps values into their documented range rather than trusting the caller", () => {
    expect(adjustmentsToCssFilter({ saturation: 99 as number })).toBe("saturate(2)");
    expect(adjustmentsToCssFilter({ exposure: -99 as number })).toBe("brightness(0)");
  });

  it("treats a fully specified adjustment block deterministically", () => {
    const full: CreativeAdjustments = {
      exposure: 0.15, contrast: 0.1, saturation: -0.2,
      temperature: 0.3, blurPx: 2, vignette: 0.4, grain: 0.1,
    };
    expect(adjustmentsToCssFilter(full)).toBe(adjustmentsToCssFilter({ ...full }));
    expect(hasVisibleAdjustments(full)).toBe(true);
  });
});
