import { describe, expect, it } from "vitest";
import { CREATIVE_CANVAS_FORMATS, resolveCanvasFormat } from "./canvas-formats";

describe("new creative formats", () => {
  it("offers the four social shapes at their native sizes", () => {
    expect(CREATIVE_CANVAS_FORMATS["16:9"]).toMatchObject({ width: 1920, height: 1080 });
    expect(CREATIVE_CANVAS_FORMATS["9:16"]).toMatchObject({ width: 1080, height: 1920 });
    expect(CREATIVE_CANVAS_FORMATS["4:5"]).toMatchObject({ width: 1080, height: 1350 });
    expect(CREATIVE_CANVAS_FORMATS["1:1"]).toMatchObject({ width: 1080, height: 1080 });
  });

  it("falls back to vertical for anything it does not know", () => {
    expect(resolveCanvasFormat("4:5")).toBe("4:5");
    expect(resolveCanvasFormat("21:9")).toBe("9:16");
    expect(resolveCanvasFormat(undefined)).toBe("9:16");
  });
});
