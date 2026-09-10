import { describe, expect, it } from "vitest";
import { createCanonicalCreativeFixture } from "./fixtures";
import { parseCreativeOperationInput } from "./operation-contract";
import { applyCreativeTransaction } from "./transactions";
import type { CreativeCompositeElement, CreativeTextElement } from "./schema";

function textChild(): CreativeTextElement {
  return {
    id: "label", type: "text", name: "Label", text: "Revenue up",
    style: { token: "body" },
    transform: { x: 0, y: 0, width: 300, height: 80, rotation: 0, opacity: 1, anchorX: 0.5, anchorY: 0.5, zIndex: 0 },
  };
}

describe("text animation nested targets", () => {
  it("parses and applies apply_text_animation to a direct composite child", () => {
    const document = createCanonicalCreativeFixture();
    const composite: CreativeCompositeElement = {
      id: "card", type: "composite", name: "Card", viewport: { width: 400, height: 200 }, children: [textChild()],
      transform: { x: 10, y: 10, width: 400, height: 200, rotation: 0, opacity: 1, anchorX: 0.5, anchorY: 0.5, zIndex: 2 },
    };
    document.scenes[0].elements.push(composite);
    const operation = parseCreativeOperationInput({
      type: "apply_text_animation", sceneId: document.scenes[0].id, elementId: "card", childId: "label",
      animation: { granularity: "word", mode: "rise", startMs: 0, durationMs: 400, staggerMs: 50, easing: "ease-out" },
    });
    const result = applyCreativeTransaction(document, { summary: "Animate card label", operations: [operation] });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const card = result.document.scenes[0].elements.find((element) => element.id === "card") as CreativeCompositeElement;
    expect((card.children[0] as CreativeTextElement).animation?.mode).toBe("rise");
  });

  it("rejects a missing or non-text composite child with a specific error", () => {
    const document = createCanonicalCreativeFixture();
    document.scenes[0].elements.push({
      id: "card", type: "composite", name: "Card", viewport: { width: 400, height: 200 }, children: [textChild()],
      transform: { x: 10, y: 10, width: 400, height: 200, rotation: 0, opacity: 1, anchorX: 0.5, anchorY: 0.5, zIndex: 2 },
    });
    const result = applyCreativeTransaction(document, { summary: "Bad child", operations: [{
      type: "apply_text_animation", sceneId: document.scenes[0].id, elementId: "card", childId: "missing",
      animation: { granularity: "word", mode: "fade", startMs: 0, durationMs: 200, staggerMs: 0, easing: "linear" },
    } as any] });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.message).toMatch(/child.*missing|missing.*child/i);
  });
});
