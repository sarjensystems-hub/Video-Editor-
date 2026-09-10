import { describe, expect, it } from "vitest";
import { createCanonicalCreativeFixture } from "./fixtures";
import { getCreativeDurationMs } from "./evaluate";
import {
  buildCreativeDirectorPrompt,
  buildCreativeDirectorRepairPrompt,
  parseCreativeDirectorTransaction,
} from "./director";

describe("creative director", () => {
  it("parses a model-planned transaction against the current document", () => {
    const document = createCanonicalCreativeFixture();
    const result = parseCreativeDirectorTransaction(document, JSON.stringify({
      summary: "Make the headline more premium",
      operations: [{ type: "set_text", sceneId: "scene-1", elementId: "headline", text: "THE RIGHT CARE FOR YOUR CAR." }],
    }));
    expect(result.summary).toMatch(/premium/i);
    expect(result.operations[0].type).toBe("set_text");
  });

  it("rejects unknown operation kinds and missing layer references", () => {
    const document = createCanonicalCreativeFixture();
    expect(() => parseCreativeDirectorTransaction(document, JSON.stringify({ summary: "Bad", operations: [{ type: "execute_shell", command: "rm -rf /" }] }))).toThrow(/unsupported/i);
    expect(() => parseCreativeDirectorTransaction(document, JSON.stringify({ summary: "Bad id", operations: [{ type: "set_text", sceneId: "scene-1", elementId: "missing", text: "x" }] }))).toThrow(/not found/i);
  });

  it("rejects malformed operation fields before the transaction engine sees undefined ids", () => {
    const document = createCanonicalCreativeFixture();
    expect(() => parseCreativeDirectorTransaction(document, JSON.stringify({
      summary: "Wrong field casing",
      operations: [{ type: "set_text", scene_id: "scene-1", element_id: "headline", text: "x" }],
    }))).toThrow(/sceneId/i);
  });

  it("rejects malformed transform scalars before final document validation", () => {
    const document = createCanonicalCreativeFixture();
    expect(() => parseCreativeDirectorTransaction(document, JSON.stringify({
      summary: "Calm the reset",
      operations: [{
        type: "update_element",
        sceneId: "scene-1",
        elementId: "background-image",
        patch: { transform: { x: "100" } },
      }],
    }))).toThrow(/operation update_element patch\.transform\.x must be a finite number/i);
  });

  it("rejects out-of-range transform anchors before final document validation", () => {
    const document = createCanonicalCreativeFixture();
    expect(() => parseCreativeDirectorTransaction(document, JSON.stringify({
      summary: "Keep the logo anchored",
      operations: [{
        type: "update_element",
        sceneId: "scene-1",
        elementId: "background-image",
        patch: { transform: { ...document.scenes[0].elements[0].transform, anchorX: 100 } },
      }],
    }))).toThrow(/operation update_element patch\.transform\.anchorX must be between zero and one/i);
  });

  it("rejects broad scene element replacement so layer edits use dedicated operations", () => {
    const document = createCanonicalCreativeFixture();
    const elements = document.scenes[0].elements.map((element) => ({
      ...element,
      transform: element.id === "headline"
        ? { ...element.transform, rotation: null }
        : element.transform,
    }));
    expect(() => parseCreativeDirectorTransaction(document, JSON.stringify({
      summary: "Retiming without flattening layers",
      operations: [{
        type: "update_scene",
        sceneId: "scene-1",
        patch: { durationMs: 8200, elements },
      }],
    }))).toThrow(/update_scene patch\.elements is not allowed.*dedicated element operations/i);
  });

  it("preserves the failing operation index in transaction validation errors", () => {
    const document = createCanonicalCreativeFixture();
    expect(() => parseCreativeDirectorTransaction(document, JSON.stringify({
      summary: "Move headline visibility",
      operations: [{
        type: "set_timing",
        sceneId: "scene-1",
        elementId: "headline",
        timing: { startMs: 700, endMs: 7600 },
      }],
    }))).toThrow(/Operation 0: .*Keyframe time must be ordered and inside the visible window/i);
  });

  it("diagnoses malformed Director JSON without echoing creative content", () => {
    const raw = '{"summary":"SECRET_COPY","operations":[{"type":"set_text"';
    let message = "";
    try {
      parseCreativeDirectorTransaction(createCanonicalCreativeFixture(), raw);
    } catch (error) {
      message = error instanceof Error ? error.message : String(error);
    }

    expect(message).toMatch(/invalid JSON/i);
    expect(message).toMatch(/length=\d+/i);
    expect(message).toMatch(/startsWithObject=true/i);
    expect(message).toMatch(/endsWithObject=false/i);
    expect(message).toMatch(/parseError=/i);
    expect(message).not.toContain("SECRET_COPY");
  });

  it("builds a prompt with exact field and temporal invariants", () => {
    const prompt = buildCreativeDirectorPrompt(createCanonicalCreativeFixture(), "Make the composition calmer and more premium");
    expect(prompt).toMatch(/CreativeDocument/i);
    expect(prompt).toMatch(/transaction/i);
    expect(prompt).toMatch(/headline/);
    expect(prompt).toMatch(/sceneId/);
    expect(prompt).toMatch(/elementId/);
    expect(prompt).toMatch(/update_scene.*patch/i);
    expect(prompt).toMatch(/update_scene.*must not.*elements.*groups/i);
    expect(prompt).toMatch(/set_timing.*timing/i);
    expect(prompt).toMatch(/element timing.*scene duration/i);
    expect(prompt).toMatch(/change an element.*timing.*keyframe/i);
    expect(prompt).toMatch(/transaction.*validated.*final candidate/i);
    expect(prompt).toMatch(/intermediate.*temporarily invalid/i);
    expect(prompt).not.toMatch(/each operation.*validated.*independently/i);
    expect(prompt).toMatch(/preserve.*total duration/i);
    expect(prompt).not.toMatch(/write react|write ffmpeg/i);
  });

  it("reports and preserves the overlap-aware rendered duration", () => {
    const base = createCanonicalCreativeFixture();
    const document = {
      ...base,
      scenes: [
        { ...base.scenes[0], durationMs: 8000 },
        {
          ...base.scenes[0],
          id: "scene-2",
          name: "Second scene",
          durationMs: 2000,
          transitionOut: undefined,
          groups: [],
          elements: [],
        },
      ],
    };
    const prompt = buildCreativeDirectorPrompt(document, "Keep the overall duration exactly the same");
    const renderedDuration = getCreativeDurationMs(document);
    const rawSceneDurationSum = document.scenes.reduce((sum, scene) => sum + scene.durationMs, 0);

    expect(renderedDuration).not.toBe(rawSceneDurationSum);
    expect(prompt).toContain(`\"currentTotalDurationMs\":${renderedDuration}`);
    expect(prompt).not.toContain(`\"currentTotalDurationMs\":${rawSceneDurationSum}`);
    expect(prompt).toMatch(/transition.*overlap/i);
    expect(prompt).toMatch(/explicit target.*duration/i);
    expect(prompt).not.toMatch(/sum of all scene durationMs values.*equal the current total duration/i);
  });

  it("builds a repair prompt from the exact validation failure", () => {
    const prompt = buildCreativeDirectorRepairPrompt(
      createCanonicalCreativeFixture(),
      "Make it faster but preserve duration",
      "{\"summary\":\"bad\",\"operations\":[{\"type\":\"set_timing\"}]}",
      "Operation 2: scenes[0].elements[3].animations[0].keyframes[0].timeMs: Keyframe time must be ordered and inside the visible window.",
    );
    expect(prompt).toMatch(/repair/i);
    expect(prompt).toMatch(/Keyframe time must be ordered/);
    expect(prompt).toMatch(/Operation N.*zero-based failing operation/i);
    expect(prompt).toMatch(/do not return.*failing operation.*unchanged/i);
    expect(prompt).toMatch(/timing.*animation.*same transaction/i);
    expect(prompt).toMatch(/preserve duration/);
    expect(prompt).toMatch(/sceneId/);
  });
});
