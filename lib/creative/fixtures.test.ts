import { describe, expect, it } from "vitest";
import { createCanonicalCreativeFixture } from "./fixtures";
import { validateCreativeDocument } from "./validate";

describe("canonical creative fixture", () => {
  it("is the valid 1080x1350 eight-second layered V1 social fixture", () => {
    const fixture = createCanonicalCreativeFixture();
    expect(validateCreativeDocument(fixture)).toEqual({ valid: true, issues: [] });
    expect(fixture.canvas).toMatchObject({ width: 1080, height: 1350, fps: 30 });
    expect(fixture.scenes).toHaveLength(1);
    expect(fixture.scenes[0].durationMs).toBe(8000);
  });

  it("keeps essential copy, imagery, accent and logo as individually editable layers", () => {
    const fixture = createCanonicalCreativeFixture();
    const elements = fixture.scenes[0].elements;
    expect(elements.find((element) => element.id === "headline")).toMatchObject({
      type: "text",
      text: "STOP GUESSING.",
      style: { token: "heading" },
    });
    expect(elements.find((element) => element.id === "background-image")).toMatchObject({
      type: "image",
      assetId: "fixture-background",
    });
    expect(elements.find((element) => element.id === "brand-logo")).toMatchObject({
      type: "image",
      assetId: "fixture-logo",
    });
    expect(elements.find((element) => element.id === "accent-line")).toMatchObject({
      type: "shape",
      shape: "rect",
      fill: { kind: "token", token: "accent" },
    });
    expect(fixture.scenes[0].groups).toEqual([
      { id: "copy-lockup", name: "Copy lockup", elementIds: ["headline", "accent-line"] },
    ]);
  });

  it("contains an expanded semantic entrance preset as explicit keyframes", () => {
    const fixture = createCanonicalCreativeFixture();
    const headline = fixture.scenes[0].elements.find((element) => element.id === "headline");
    expect(headline?.animations).toEqual(expect.arrayContaining([
      expect.objectContaining({ id: "preset:rise-in:y", property: "y" }),
      expect.objectContaining({ id: "preset:rise-in:opacity", property: "opacity" }),
    ]));
  });

  it("round-trips through JSON without flattening layers or embedding bytes", () => {
    const fixture = createCanonicalCreativeFixture();
    expect(JSON.parse(JSON.stringify(fixture))).toEqual(fixture);
    expect(JSON.stringify(fixture)).not.toContain("base64");
  });

  it("keeps model-facing premium automotive direction separate from layout", () => {
    const fixture = createCanonicalCreativeFixture();
    expect(fixture.designSystem.mediaDirection).toMatchObject({
      photographicStyle: "cinematic premium automotive photography",
      lighting: "controlled high-contrast workshop lighting",
      negativeSpace: "preserve clean negative space for native typography and UI overlays",
      motionIntensity: "medium",
    });
    expect(fixture.designSystem.mediaDirection?.avoid).toContain("generated typography inside imagery");
  });
});
