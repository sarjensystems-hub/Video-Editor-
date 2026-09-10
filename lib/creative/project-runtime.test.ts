import { describe, expect, it } from "vitest";
import { validateCreativeDocument } from "./validate";
import { createCanonicalCreativeFixture } from "./fixtures";
import {
  createSeedCreativeDocument,
  getNextRevisionSequence,
  normalizeCreativeProjectTitle,
  prepareCreativeProjectTransaction,
} from "./project-runtime";

describe("creative project runtime helpers", () => {
  it("calculates the next revision sequence", () => {
    expect(getNextRevisionSequence(undefined)).toBe(1);
    expect(getNextRevisionSequence(null)).toBe(1);
    expect(getNextRevisionSequence(7)).toBe(8);
  });

  it("normalizes project titles deterministically", () => {
    expect(normalizeCreativeProjectTitle("   ")).toBe("Untitled creative");
    expect(normalizeCreativeProjectTitle("  Premium workshop reel  ")).toBe("Premium workshop reel");
    expect(normalizeCreativeProjectTitle("x".repeat(200))).toHaveLength(140);
  });

  // roadmap #66. A new project used to arrive as a complete car-care advert
  // that the caller had to find and delete, with nothing saying it was there.
  it("seeds a new project with one empty scene and no art direction", () => {
    const document = createSeedCreativeDocument("project-1");

    expect(document.id).toBe("project-1");
    expect(document.scenes).toHaveLength(1);
    const [scene] = document.scenes;
    expect(scene.id).toBe("scene-1");
    expect(scene.durationMs).toBe(5000);
    expect(scene.elements).toEqual([]);
    expect(scene.groups).toEqual([]);

    // mediaDirection is read as art direction by anything generating imagery
    // for this project, so a seeded one is not a harmless placeholder.
    expect(document.designSystem.mediaDirection).toBeUndefined();

    // And it has to be a document the engine will accept, or the first edit
    // fails on something the caller never authored.
    expect(validateCreativeDocument(document).valid).toBe(true);
  });

  it("prepares a valid transaction without mutating the source document", () => {
    const document = createCanonicalCreativeFixture();
    const result = prepareCreativeProjectTransaction(document, {
      summary: "Agent headline edit",
      operations: [{ type: "set_text", sceneId: "scene-1", elementId: "headline", text: "FIND THE RIGHT PEOPLE." }],
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const headline = result.document.scenes[0].elements.find((item) => item.id === "headline");
    expect(headline?.type === "text" ? headline.text : null).toBe("FIND THE RIGHT PEOPLE.");
    const original = document.scenes[0].elements.find((item) => item.id === "headline");
    expect(original?.type === "text" ? original.text : null).toBe("STOP GUESSING.");
  });
});