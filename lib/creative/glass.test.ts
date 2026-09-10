import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { colorAtAlpha, hasVisibleGlass, resolveGlassCss } from "./glass";
import { CREATIVE_OPERATION_SCHEMA } from "./operation-contract";
import { applyCreativeTransaction } from "./transactions";
import type { CreativeDesignSystem } from "./schema";

const designSystem = {
  colors: { glass: "#88aaff", ink: "#123456" },
  typography: {}, spacing: {}, radii: {}, strokes: {},
  motion: { presets: {}, sceneTransitions: {} },
} as unknown as CreativeDesignSystem;

describe("colorAtAlpha", () => {
  it("parses every hex length into the same rgba", () => {
    expect(colorAtAlpha("#fff", 0.5)).toBe("rgba(255, 255, 255, 0.5)");
    expect(colorAtAlpha("#ffffff", 0.5)).toBe("rgba(255, 255, 255, 0.5)");
    expect(colorAtAlpha("#ffffffcc", 0.5)).toBe("rgba(255, 255, 255, 0.5)");
    expect(colorAtAlpha("#123456", 1)).toBe("rgba(18, 52, 86, 1)");
  });

  it("parses hex itself rather than deferring to the browser", () => {
    // The preview and the render worker are two different Chromium builds; a
    // value they both parse is safer than one they each interpret.
    expect(colorAtAlpha("#88aaff", 0.12)).not.toContain("color-mix");
  });

  it("falls back to color-mix for a colour it cannot parse", () => {
    expect(colorAtAlpha("rebeccapurple", 0.2)).toBe("color-mix(in srgb, rebeccapurple 20.0%, transparent)");
  });

  it("clamps alpha rather than emitting an invalid colour", () => {
    expect(colorAtAlpha("#fff", 5)).toBe("rgba(255, 255, 255, 1)");
    expect(colorAtAlpha("#fff", -1)).toBe("rgba(255, 255, 255, 0)");
  });
});

describe("hasVisibleGlass", () => {
  it("is false for nothing and for a block that changes no pixel", () => {
    expect(hasVisibleGlass(undefined)).toBe(false);
    expect(hasVisibleGlass({ blurPx: 0, tintOpacity: 0, borderOpacity: 0, highlight: 0, shadow: 0 })).toBe(false);
  });

  it("is true as soon as any one control is set", () => {
    expect(hasVisibleGlass({ blurPx: 12 })).toBe(true);
    expect(hasVisibleGlass({ blurPx: 0, shadow: 0.2 })).toBe(true);
  });
});

describe("resolveGlassCss", () => {
  it("resolves nothing when the block would change no pixel", () => {
    expect(resolveGlassCss(designSystem, { blurPx: 0, tintOpacity: 0, borderOpacity: 0, highlight: 0, shadow: 0 }))
      .toBeUndefined();
  });

  it("gives one blur the whole material, from defaults", () => {
    // The defaults are the primitive: this is what makes two panels authored a
    // week apart look like the same glass.
    const css = resolveGlassCss(designSystem, { blurPx: 18 })!;
    expect(css.backdropFilter).toBe("blur(18px) saturate(1.4)");
    expect(css.border).toBe("1px solid rgba(255, 255, 255, 0.18)");
    expect(css.boxShadow).toBe("0 8px 32px rgba(0, 0, 0, 0.18)");
    expect(css.background).toContain("rgba(255, 255, 255, 0.25)");
  });

  it("puts the highlight over the tint, in that order", () => {
    // CSS backgrounds paint first layer on top; a stable order is what keeps
    // the two renderers identical rather than merely similar.
    const css = resolveGlassCss(designSystem, { blurPx: 10, tint: { kind: "token", token: "glass" } })!;
    const [first, second] = css.background.split("), linear-gradient(");
    expect(first).toContain("to bottom");
    expect(second).toContain("rgba(136, 170, 255, 0.12)");
  });

  it("fades the specular out well before the bottom", () => {
    // Glass catches light where it turns, not across its whole face.
    expect(resolveGlassCss(designSystem, { blurPx: 10 })!.background).toContain("45%");
  });

  it("resolves a token tint through the design system", () => {
    const css = resolveGlassCss(designSystem, { blurPx: 8, tint: { kind: "token", token: "ink" }, tintOpacity: 0.4 })!;
    expect(css.background).toContain("rgba(18, 52, 86, 0.4)");
  });

  it("says which token is missing rather than rendering a wrong colour", () => {
    expect(() => resolveGlassCss(designSystem, { blurPx: 8, tint: { kind: "token", token: "ghost" } }))
      .toThrow(/Unknown creative color token: ghost/);
  });

  it("refuses a gradient tint, which would fight the backdrop", () => {
    expect(() => resolveGlassCss(designSystem, {
      blurPx: 8,
      tint: { kind: "gradient", gradient: { kind: "linear", angle: 0, stops: [] } } as never,
    })).toThrow(/cannot be a gradient/);
  });

  it("drops the edge, shadow and radius when they are turned off", () => {
    const css = resolveGlassCss(designSystem, { blurPx: 12, borderOpacity: 0, shadow: 0 })!;
    expect(css.border).toBeUndefined();
    expect(css.boxShadow).toBeUndefined();
    expect(css.borderRadius).toBeUndefined();
  });

  it("emits a radius only when one was asked for", () => {
    expect(resolveGlassCss(designSystem, { blurPx: 12, radius: 24 })!.borderRadius).toBe("24px");
  });

  it("clamps saturation and every opacity rather than emitting nonsense", () => {
    const css = resolveGlassCss(designSystem, {
      blurPx: 12, saturation: 99, tintOpacity: 4, borderOpacity: -2, highlight: 3, shadow: 9,
    })!;
    expect(css.backdropFilter).toBe("blur(12px) saturate(3)");
    expect(css.background).toContain("rgba(255, 255, 255, 1)");
    expect(css.border).toBeUndefined();
  });

  it("still resolves a shadow-only panel with no blur", () => {
    const css = resolveGlassCss(designSystem, { blurPx: 0, shadow: 0.3 })!;
    expect(css.backdropFilter).toBe("saturate(1.4)");
  });
});

/**
 * The rule: when a pure module resolves a value, a test asserts every renderer
 * reads every property it resolves.
 */
describe("both renderers apply the glass this module resolves", () => {
  const ROOT = resolve(__dirname, "..", "..");
  const CONSUMERS = [
    "components/creative/CreativeScenePreview.tsx",
    "remotion/CreativeComposition.tsx",
  ];

  for (const consumer of CONSUMERS) {
    it(`${consumer} applies every resolved property`, () => {
      const source = readFileSync(resolve(ROOT, consumer), "utf8");
      expect(source).toContain("resolveGlassCss(");
      for (const property of ["backdropFilter", "borderRadius", "boxShadow"]) {
        expect(source, `${consumer} never applies glass ${property}`).toContain(property);
      }
      expect(source).toContain("glass.background");
      expect(source).toContain("glass.border");
    });
  }
});

/**
 * Advertised schema, transaction and validator are three descriptions of one
 * contract, and this repo has shipped capabilities that were built, tested and
 * unreachable because only two of the three were ever checked together.
 */
describe("glass is reachable through the advertised contract", () => {
  const film = () => ({
    version: 1,
    id: "doc",
    title: "Film",
    canvas: { width: 1080, height: 1080, fps: 30, background: { kind: "literal", value: "#fff" } },
    designSystem,
    scenes: [{
      id: "scene-1", name: "Scene", durationMs: 3000, groups: [],
      elements: [{
        id: "panel", name: "Panel", type: "shape", shape: "rect",
        fill: { kind: "literal", value: "#ffffff" },
        transform: {
          x: 100, y: 100, width: 400, height: 200, rotation: 0,
          opacity: 1, anchorX: 0.5, anchorY: 0.5, zIndex: 1,
        },
      }],
    }],
  }) as never;

  it("advertises the operation and every control it takes", () => {
    const text = JSON.stringify(CREATIVE_OPERATION_SCHEMA);
    expect(text).toContain('"set_glass"');
    for (const field of [
      "blurPx", "tintOpacity", "borderOpacity", "highlight", "saturation", "shadow",
    ]) {
      expect(text, `${field} is accepted by the engine but not advertised`).toContain(`"${field}"`);
    }
  });

  it("applies through a transaction and leaves a document that validates", () => {
    const result = applyCreativeTransaction(film(), {
      summary: "frost the panel",
      operations: [{
        type: "set_glass", sceneId: "scene-1", elementId: "panel",
        glass: { blurPx: 18, tint: { kind: "token", token: "glass" }, tintOpacity: 0.14, radius: 20 },
      }],
    } as never);

    expect(result.ok, "ok" in result && !result.ok ? JSON.stringify(result.error) : "").toBe(true);
    const element = result.document.scenes[0].elements[0] as unknown as Record<string, unknown>;
    expect(element.glass).toMatchObject({ blurPx: 18, radius: 20 });
  });

  it("clears the surface when the operation omits it", () => {
    const frosted = applyCreativeTransaction(film(), {
      summary: "frost", operations: [{ type: "set_glass", sceneId: "scene-1", elementId: "panel", glass: { blurPx: 18 } }],
    } as never);
    const cleared = applyCreativeTransaction(frosted.document, {
      summary: "unfrost", operations: [{ type: "set_glass", sceneId: "scene-1", elementId: "panel" }],
    } as never);
    expect(cleared.ok).toBe(true);
    // Cleared the way every other optional field on this element clears: the
    // key is left undefined rather than deleted, which serialises away and
    // reads as absent everywhere it matters.
    expect((cleared.document.scenes[0].elements[0] as unknown as { glass?: unknown }).glass).toBeUndefined();
  });

  it("refuses values the resolver would only clamp away silently", () => {
    const result = applyCreativeTransaction(film(), {
      summary: "bad glass",
      operations: [{ type: "set_glass", sceneId: "scene-1", elementId: "panel", glass: { blurPx: -4 } }],
    } as never);
    expect(result.ok).toBe(false);
    expect((result as { ok: false; error: { message: string } }).error.message).toContain("blurPx");
  });
});
