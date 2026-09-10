import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { createEmptyCreativeDocument } from "./defaults";
import { resolveColor } from "./evaluate";
import { resolveGradientCss } from "./gradient";
import type { ColorGradient } from "./schema";

function doc() {
  return createEmptyCreativeDocument({ id: "gradient-fixture" }).designSystem;
}

const stop = (offset: number, color: ColorGradient["stops"][number]["color"]) => ({ offset, color });
const literal = (value: string) => ({ kind: "literal" as const, value });

describe("resolveGradientCss", () => {
  it("builds a linear gradient, defaulting angle to CSS's own top-to-bottom", () => {
    const css = resolveGradientCss(doc(), {
      kind: "linear",
      stops: [stop(0, literal("#ff0000")), stop(1, literal("#0000ff"))],
    });
    expect(css).toBe("linear-gradient(180deg, #ff0000 0.00%, #0000ff 100.00%)");
  });

  it("uses the angle given for a linear gradient", () => {
    const css = resolveGradientCss(doc(), {
      kind: "linear",
      angle: 45,
      stops: [stop(0, literal("#fff")), stop(1, literal("#000"))],
    });
    expect(css).toBe("linear-gradient(45deg, #fff 0.00%, #000 100.00%)");
  });

  it("builds a radial gradient as a fixed circle, not an ellipse that stretches to the box", () => {
    const css = resolveGradientCss(doc(), {
      kind: "radial",
      stops: [stop(0, literal("#fff")), stop(1, literal("#000"))],
    });
    expect(css).toBe("radial-gradient(circle at 50% 50%, #fff 0.00%, #000 100.00%)");
  });

  it("positions a radial gradient's centre", () => {
    const css = resolveGradientCss(doc(), {
      kind: "radial",
      centerX: 0.25,
      centerY: 0.75,
      stops: [stop(0, literal("#fff")), stop(1, literal("#000"))],
    });
    expect(css).toContain("at 25% 75%");
  });

  it("builds a conic gradient, defaulting its start angle to CSS's own 0deg (12 o'clock)", () => {
    const css = resolveGradientCss(doc(), {
      kind: "conic",
      stops: [stop(0, literal("#fff")), stop(1, literal("#000"))],
    });
    expect(css).toBe("conic-gradient(from 0deg at 50% 50%, #fff 0.00%, #000 100.00%)");
  });

  it("uses the angle given for a conic gradient's start", () => {
    const css = resolveGradientCss(doc(), {
      kind: "conic",
      angle: 90,
      stops: [stop(0, literal("#fff")), stop(1, literal("#000"))],
    });
    expect(css).toContain("from 90deg");
  });

  it("resolves a token stop the same way any other colour token resolves", () => {
    const css = resolveGradientCss(doc(), {
      kind: "linear",
      stops: [stop(0, { kind: "token", token: "accent" }), stop(1, literal("#000"))],
    });
    // createNeutralDesignSystem's accent token, pinned so this test would
    // notice if the fixture's token value ever moved.
    expect(css).toContain("#F97316 0.00%");
  });

  it("orders stops by offset regardless of authored order", () => {
    const scrambled = resolveGradientCss(doc(), {
      kind: "linear",
      angle: 0,
      stops: [stop(1, literal("#0000ff")), stop(0, literal("#ff0000")), stop(0.5, literal("#00ff00"))],
    });
    const sorted = resolveGradientCss(doc(), {
      kind: "linear",
      angle: 0,
      stops: [stop(0, literal("#ff0000")), stop(0.5, literal("#00ff00")), stop(1, literal("#0000ff"))],
    });
    expect(scrambled).toBe(sorted);
    expect(scrambled).toBe("linear-gradient(0deg, #ff0000 0.00%, #00ff00 50.00%, #0000ff 100.00%)");
  });

  it("keeps two same-offset stops in their authored order, for a deliberate hard edge", () => {
    const css = resolveGradientCss(doc(), {
      kind: "linear",
      angle: 0,
      stops: [stop(0, literal("#fff")), stop(0.5, literal("#ff0000")), stop(0.5, literal("#0000ff")), stop(1, literal("#000"))],
    });
    expect(css).toBe("linear-gradient(0deg, #fff 0.00%, #ff0000 50.00%, #0000ff 50.00%, #000 100.00%)");
  });

  it("clamps an out-of-range offset rather than emitting a broken percentage", () => {
    const css = resolveGradientCss(doc(), {
      kind: "linear",
      angle: 0,
      stops: [stop(-2, literal("#fff")), stop(9, literal("#000"))],
    });
    expect(css).toBe("linear-gradient(0deg, #fff 0.00%, #000 100.00%)");
  });

  it("throws on a gradient with fewer than two stops, the same invariant validation enforces", () => {
    expect(() =>
      resolveGradientCss(doc(), { kind: "linear", stops: [stop(0, literal("#fff"))] }),
    ).toThrow(/at least two stops/i);
    expect(() => resolveGradientCss(doc(), { kind: "linear", stops: [] })).toThrow(/at least two stops/i);
  });

  it("throws rather than silently dropping a stop pointing at a colour token that does not exist", () => {
    expect(() =>
      resolveGradientCss(doc(), {
        kind: "linear",
        stops: [stop(0, { kind: "token", token: "does-not-exist" }), stop(1, literal("#000"))],
      }),
    ).toThrow(/unknown creative color token/i);
  });

  it("throws if a stop's own colour is itself a gradient", () => {
    // Validation rejects this before a real document can reach here; this
    // guards the invariant independently, the way resolveColor also guards a
    // missing token even though validation checks that too.
    const nested: ColorGradient = {
      kind: "linear",
      stops: [
        {
          offset: 0,
          color: { kind: "gradient", gradient: { kind: "linear", stops: [stop(0, literal("#fff")), stop(1, literal("#000"))] } },
        },
        stop(1, literal("#000")),
      ],
    };
    expect(() => resolveGradientCss(doc(), nested)).toThrow(/cannot itself be a gradient/i);
  });
});

describe("resolveColor delegates a gradient ColorValue to resolveGradientCss", () => {
  it("returns the same CSS resolveGradientCss would, through the shared choke point", () => {
    const gradient: ColorGradient = {
      kind: "linear",
      stops: [stop(0, literal("#111111")), stop(1, literal("#eeeeee"))],
    };
    expect(resolveColor(doc(), { kind: "gradient", gradient })).toBe(resolveGradientCss(doc(), gradient));
  });

  it("still resolves literal and token colours exactly as before gradients existed", () => {
    expect(resolveColor(doc(), { kind: "literal", value: "#123456" })).toBe("#123456");
    expect(resolveColor(doc(), { kind: "token", token: "accent" })).toBe("#F97316");
  });
});

/**
 * Gradients need no new renderer-side code at all: every existing background
 * and fill call site already runs its ColorValue through the shared
 * resolveColor choke point, and teaching that one function to resolve a
 * gradient is enough for both renderers to render one identically. What a
 * renderer must NOT do is grow its own gradient-building logic — that would
 * be exactly the "one renderer decides, the other doesn't" bug this project
 * keeps hitting, at the colour choke point instead of at a resolved property.
 */
describe("both renderers resolve a shape fill through the shared resolveColor choke point", () => {
  const ROOT = resolve(__dirname, "..", "..");
  const CONSUMERS = [
    "components/creative/CreativeScenePreview.tsx",
    "remotion/CreativeComposition.tsx",
  ];

  for (const consumer of CONSUMERS) {
    it(`${consumer} resolves element.fill through resolveColor and builds no gradient CSS of its own`, () => {
      const source = readFileSync(resolve(ROOT, consumer), "utf8");
      expect(source).toContain("resolveColor(document.designSystem, element.fill)");
      expect(source).not.toContain("resolveGradientCss");
    });
  }
});
