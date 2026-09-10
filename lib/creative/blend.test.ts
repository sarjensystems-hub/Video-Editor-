import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { resolveBlendModeCss } from "./blend";
import { BLEND_MODES } from "./schema";

describe("resolveBlendModeCss", () => {
  it("returns undefined when nothing is set, so an ungraded element costs no style property", () => {
    expect(resolveBlendModeCss(undefined)).toBeUndefined();
  });

  it("returns undefined for 'normal', CSS's own default, rather than emitting a no-op property", () => {
    expect(resolveBlendModeCss("normal")).toBeUndefined();
  });

  it("passes every other mode straight through as the matching CSS keyword", () => {
    for (const mode of BLEND_MODES) {
      if (mode === "normal") continue;
      expect(resolveBlendModeCss(mode)).toBe(mode);
    }
  });
});

/**
 * Blend mode has nothing to compute, but mask and blur have each already
 * shipped once with only one renderer actually applying the resolved value —
 * exactly the class of bug a "both renderers" guard exists to catch, whether
 * or not the resolution itself is interesting.
 */
describe("both renderers apply the resolved blend mode", () => {
  const ROOT = resolve(__dirname, "..", "..");
  const CONSUMERS = [
    "components/creative/CreativeScenePreview.tsx",
    "remotion/CreativeComposition.tsx",
  ];

  for (const consumer of CONSUMERS) {
    it(`${consumer} resolves and applies element.blendMode`, () => {
      const source = readFileSync(resolve(ROOT, consumer), "utf8");
      expect(source).toContain("resolveBlendModeCss(element.blendMode)");
      expect(source).toContain("mixBlendMode:");
    });
  }
});
