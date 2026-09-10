import { describe, expect, it } from "vitest";
import { createCanonicalCreativeFixture } from "./fixtures";
import { buildCompositionTemplateScene, CREATIVE_COMPOSITION_TEMPLATES } from "./composition-templates";
import { validateCreativeDocument } from "./validate";

describe("editable composition templates", () => {
  it("publishes a small deterministic template vocabulary", () => {
    expect(CREATIVE_COMPOSITION_TEMPLATES).toEqual(["hero", "split", "metric-grid"]);
  });

  for (const template of CREATIVE_COMPOSITION_TEMPLATES) {
    it(`${template} creates editable elements that validate inside the current design system`, () => {
      const document = createCanonicalCreativeFixture();
      const scene = buildCompositionTemplateScene(document, template, `scene-${template}`, 2400);
      const candidate = { ...document, scenes: [scene] };
      expect(scene.elements.length).toBeGreaterThan(2);
      expect(scene.elements.every((element) => element.alias?.startsWith(`scene-${template}.`))).toBe(true);
      expect(scene.elements.every((element) => element.tags?.includes("template"))).toBe(true);
      expect(validateCreativeDocument(candidate).valid).toBe(true);
    });
  }
});
