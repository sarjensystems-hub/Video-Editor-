import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { createCanonicalCreativeFixture } from "./fixtures";
import { evaluateElementAtTime } from "./evaluate";
import { creativeElementTransformCss, preserveHierarchyDepth, resolveCameraCss } from "./hierarchy";
import { validateCreativeDocument } from "./validate";

describe("deterministic 2.5D scene depth", () => {
  it("animates depth and 3D rotation", () => {
    const document = createCanonicalCreativeFixture();
    const scene = document.scenes[0];
    const element = scene.elements[0];
    Object.assign(element.transform, { z: -120, rotationY: 8 });
    element.animations = [
      { id: "depth", property: "z", keyframes: [{ timeMs: 0, value: -120, easing: "linear" }, { timeMs: 1000, value: 80, easing: "linear" }] },
      { id: "turn", property: "rotationY", keyframes: [{ timeMs: 0, value: 8, easing: "linear" }, { timeMs: 1000, value: -12, easing: "linear" }] },
    ] as typeof element.animations;
    const evaluated = evaluateElementAtTime(document, scene, element, 500)!;
    expect(evaluated.transform.z).toBe(-20);
    expect(evaluated.transform.rotationY).toBe(-2);
  });

  it("resolves perspective for a neutral camera", () => {
    const css = resolveCameraCss({
      transform: { x: 0, y: 0, scaleX: 1, scaleY: 1, rotation: 0, opacity: 1, anchorX: 0.5, anchorY: 0.5 },
      perspectivePx: 900, perspectiveOriginX: 0.4, perspectiveOriginY: 0.6,
    }, 0);
    expect(css).toMatchObject({ perspective: "900px", perspectiveOrigin: "40% 60%", transformStyle: "preserve-3d" });
  });

  it("keeps legacy elements on the exact 2D transform path", () => {
    expect(creativeElementTransformCss({ rotation: 12, scaleX: 1.1, scaleY: 0.9 })).toEqual({
      transform: "rotate(12deg) scale(1.1, 0.9)",
    });
    expect(creativeElementTransformCss({ rotation: 12, scaleX: 1.1, scaleY: 0.9, z: 20, rotationX: 5 })).toMatchObject({
      transformStyle: "preserve-3d",
      transform: expect.stringContaining("translateZ(20px)"),
    });
  });

  it("preserves depth through a transformed group wrapper", () => {
    expect(preserveHierarchyDepth({ transformOrigin: "50% 50%", transform: "scale(1.1)", opacity: 1 }))
      .toMatchObject({ transformStyle: "preserve-3d" });
  });

  it("uses the shared 3D transform path for composite children in preview and export", () => {
    for (const path of ["components/creative/CreativeScenePreview.tsx", "remotion/CreativeComposition.tsx"]) {
      const source = readFileSync(resolve(process.cwd(), path), "utf8");
      expect(source.match(/creativeElementTransformCss\(transform\)/g)?.length).toBeGreaterThanOrEqual(2);
      expect(source).toContain('overflow: "clip", transformStyle: "preserve-3d"');
    }
  });

  it("rejects malformed scene cameras in the canonical validator", () => {
    const document = createCanonicalCreativeFixture();
    document.scenes[0].camera = {
      transform: { x: 0, y: 0, scaleX: 1, scaleY: 1, rotation: 0, opacity: 1, anchorX: 0.5, anchorY: 0.5 },
      perspectivePx: -1,
      perspectiveOriginX: 2,
    };
    const result = validateCreativeDocument(document);
    expect(result.valid).toBe(false);
    expect(result.issues.map((issue) => issue.path)).toEqual(expect.arrayContaining([
      "scenes[0].camera.perspectivePx",
      "scenes[0].camera.perspectiveOriginX",
    ]));
  });

  it("validates hierarchy blur and group animation payloads", () => {
    const document = createCanonicalCreativeFixture();
    const group = document.scenes[0].groups[0];
    group.transform = {
      x: 0, y: 0, scaleX: 1, scaleY: 1, rotation: 0, opacity: 1, anchorX: 0.5, anchorY: 0.5, blurPx: -1,
    };
    group.animations = [{
      id: "bad-group-track", property: "opacity",
      keyframes: [{ timeMs: 0, value: 1, easing: "linear" }, { timeMs: document.scenes[0].durationMs + 1, value: 0, easing: "linear" }],
    }];
    const result = validateCreativeDocument(document);
    expect(result.valid).toBe(false);
    expect(result.issues.map((issue) => issue.path)).toEqual(expect.arrayContaining([
      "scenes[0].groups[0].transform.blurPx",
      "scenes[0].groups[0].animations[0].keyframes[1].timeMs",
    ]));
  });
});
