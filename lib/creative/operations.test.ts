import { describe, expect, it } from "vitest";
import {
  createDefaultTransform,
  createEmptyCreativeDocument,
  createNeutralDesignSystem,
} from "./defaults";
import type { CreativeDocument, CreativeElement, CreativeScene } from "./schema";
import {
  addElement,
  addScene,
  applyMotionPreset,
  clearElementAnimations,
  createGroup,
  removeElement,
  removeScene,
  reorderElement,
  reorderScene,
  setDesignSystem,
  setElementAnimations,
  setElementTiming,
  setSceneTransition,
  ungroup,
  updateElement,
  updateGroup,
  updateScene,
} from "./operations";

function scene(id: string): CreativeScene {
  return { id, name: id, durationMs: 5000, elements: [], groups: [] };
}

function textElement(id: string, y = 100): CreativeElement {
  return {
    id,
    name: id,
    type: "text",
    text: id,
    style: { token: "heading" },
    transform: createDefaultTransform({ y, width: 500, height: 100 }),
  };
}

function seedDocument(): CreativeDocument {
  const document = createEmptyCreativeDocument({ id: "operations" });
  document.scenes[0].elements = [textElement("one"), textElement("two", 300)];
  return document;
}

describe("creative document operations", () => {
  it("adds, updates, reorders and removes scenes immutably", () => {
    const original = seedDocument();
    const snapshot = JSON.stringify(original);

    let result = addScene(original, scene("scene-2"));
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    let document = result.document;
    expect(document.scenes.map((item) => item.id)).toEqual(["scene-1", "scene-2"]);

    result = updateScene(document, "scene-2", { name: "Updated" });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    document = result.document;
    expect(document.scenes[1].name).toBe("Updated");

    result = reorderScene(document, "scene-2", 0);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    document = result.document;
    expect(document.scenes.map((item) => item.id)).toEqual(["scene-2", "scene-1"]);

    result = removeScene(document, "scene-2");
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.document.scenes.map((item) => item.id)).toEqual(["scene-1"]);
    expect(JSON.stringify(original)).toBe(snapshot);
  });

  it("rejects duplicate IDs, invalid reorder indexes and removing the last scene", () => {
    const original = seedDocument();
    expect(addScene(original, scene("scene-1"))).toMatchObject({ ok: false, error: { code: "duplicate_id" } });
    expect(reorderScene(original, "scene-1", 4)).toMatchObject({ ok: false, error: { code: "invalid_operation" } });
    expect(removeScene(original, "scene-1")).toMatchObject({ ok: false, error: { code: "invalid_operation" } });
    expect(addElement(original, "scene-1", textElement("one"))).toMatchObject({ ok: false, error: { code: "duplicate_id" } });
  });

  it("adds, updates and reorders elements without mutating the source", () => {
    const original = seedDocument();
    const first = addElement(original, "scene-1", textElement("three"), 1);
    expect(first.ok).toBe(true);
    if (!first.ok) return;
    expect(first.document.scenes[0].elements.map((item) => item.id)).toEqual(["one", "three", "two"]);

    const second = updateElement(first.document, "scene-1", "three", { name: "Three updated" });
    expect(second.ok).toBe(true);
    if (!second.ok) return;
    expect(second.document.scenes[0].elements[1].name).toBe("Three updated");

    const third = reorderElement(second.document, "scene-1", "three", 2);
    expect(third.ok).toBe(true);
    if (!third.ok) return;
    expect(third.document.scenes[0].elements.map((item) => item.id)).toEqual(["one", "two", "three"]);
    expect(original.scenes[0].elements.map((item) => item.id)).toEqual(["one", "two"]);
  });

  it("creates, updates and removes logical groups while maintaining membership", () => {
    const document = seedDocument();
    const grouped = createGroup(document, "scene-1", {
      id: "copy",
      name: "Copy",
      elementIds: ["one", "two"],
    });
    expect(grouped.ok).toBe(true);
    if (!grouped.ok) return;

    const renamed = updateGroup(grouped.document, "scene-1", "copy", { name: "Copy lockup" });
    expect(renamed.ok).toBe(true);
    if (!renamed.ok) return;
    expect(renamed.document.scenes[0].groups[0].name).toBe("Copy lockup");

    const firstRemoval = removeElement(renamed.document, "scene-1", "one");
    expect(firstRemoval.ok).toBe(true);
    if (!firstRemoval.ok) return;
    expect(firstRemoval.document.scenes[0].groups[0].elementIds).toEqual(["two"]);

    const ungrouped = ungroup(firstRemoval.document, "scene-1", "copy");
    expect(ungrouped.ok).toBe(true);
    if (!ungrouped.ok) return;
    expect(ungrouped.document.scenes[0].groups).toEqual([]);
  });

  it("drops a group when its last member is removed", () => {
    const document = seedDocument();
    const grouped = createGroup(document, "scene-1", { id: "single", name: "Single", elementIds: ["one"] });
    expect(grouped.ok).toBe(true);
    if (!grouped.ok) return;
    const removed = removeElement(grouped.document, "scene-1", "one");
    expect(removed.ok).toBe(true);
    if (!removed.ok) return;
    expect(removed.document.scenes[0].groups).toEqual([]);
  });

  it("rejects missing or multiply grouped elements", () => {
    const document = seedDocument();
    expect(createGroup(document, "scene-1", { id: "bad", name: "Bad", elementIds: ["missing"] })).toMatchObject({
      ok: false,
      error: { code: "invalid_reference" },
    });

    const first = createGroup(document, "scene-1", { id: "first", name: "First", elementIds: ["one"] });
    expect(first.ok).toBe(true);
    if (!first.ok) return;
    expect(createGroup(first.document, "scene-1", { id: "second", name: "Second", elementIds: ["one"] })).toMatchObject({
      ok: false,
      error: { code: "invalid_reference" },
    });
    expect(updateGroup(first.document, "scene-1", "first", { elementIds: ["missing"] })).toMatchObject({
      ok: false,
      error: { code: "invalid_reference" },
    });
  });

  it("sets and clears timing and animations only on the targeted element", () => {
    const document = seedDocument();
    const timed = setElementTiming(document, "scene-1", "one", { startMs: 200, endMs: 1000 });
    expect(timed.ok).toBe(true);
    if (!timed.ok) return;
    expect(timed.document.scenes[0].elements[0].timing).toEqual({ startMs: 200, endMs: 1000 });
    expect(timed.document.scenes[0].elements[1].timing).toBeUndefined();

    const animated = setElementAnimations(timed.document, "scene-1", "one", [
      {
        id: "opacity",
        property: "opacity",
        keyframes: [
          { timeMs: 200, value: 0, easing: "ease-out" },
          { timeMs: 500, value: 1, easing: "ease-out" },
        ],
      },
    ]);
    expect(animated.ok).toBe(true);
    if (!animated.ok) return;
    expect(animated.document.scenes[0].elements[0].animations?.[0].id).toBe("opacity");

    const clearedAnimations = clearElementAnimations(animated.document, "scene-1", "one");
    expect(clearedAnimations.ok).toBe(true);
    if (!clearedAnimations.ok) return;
    expect(clearedAnimations.document.scenes[0].elements[0].animations).toBeUndefined();

    const clearedTiming = setElementTiming(clearedAnimations.document, "scene-1", "one", undefined);
    expect(clearedTiming.ok).toBe(true);
    if (!clearedTiming.ok) return;
    expect(clearedTiming.document.scenes[0].elements[0].timing).toBeUndefined();
  });

  it("expands semantic motion presets at the requested scene-local start time", () => {
    const document = seedDocument();
    const timed = setElementTiming(document, "scene-1", "one", { startMs: 500, endMs: 2000 });
    expect(timed.ok).toBe(true);
    if (!timed.ok) return;

    const result = applyMotionPreset(timed.document, "scene-1", "one", "rise-in", 700);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const element = result.document.scenes[0].elements[0];
    expect(element.animations).toEqual([
      {
        id: "preset:rise-in:y",
        property: "y",
        keyframes: [
          { timeMs: 700, value: 140, easing: "ease-out" },
          { timeMs: 1100, value: 100, easing: "ease-out" },
        ],
      },
      {
        id: "preset:rise-in:opacity",
        property: "opacity",
        keyframes: [
          { timeMs: 700, value: 0, easing: "ease-out" },
          { timeMs: 1100, value: 1, easing: "ease-out" },
        ],
      },
    ]);
  });

  it("preserves unrelated animation tracks and rejects presets outside visibility", () => {
    let document = seedDocument();
    const baseAnimations = setElementAnimations(document, "scene-1", "one", [
      {
        id: "rotation-custom",
        property: "rotation",
        keyframes: [
          { timeMs: 0, value: 0, easing: "linear" },
          { timeMs: 1000, value: 5, easing: "linear" },
        ],
      },
      {
        id: "opacity-old",
        property: "opacity",
        keyframes: [
          { timeMs: 0, value: 0.5, easing: "linear" },
          { timeMs: 1000, value: 1, easing: "linear" },
        ],
      },
    ]);
    expect(baseAnimations.ok).toBe(true);
    if (!baseAnimations.ok) return;
    document = baseAnimations.document;

    const applied = applyMotionPreset(document, "scene-1", "one", "fade-in", 1200);
    expect(applied.ok).toBe(true);
    if (!applied.ok) return;
    expect(applied.document.scenes[0].elements[0].animations?.map((item) => item.property)).toEqual([
      "rotation",
      "opacity",
    ]);

    const fresh = seedDocument();
    const tooShort = setElementTiming(fresh, "scene-1", "one", { startMs: 100, endMs: 200 });
    expect(tooShort.ok).toBe(true);
    if (!tooShort.ok) return;
    expect(applyMotionPreset(tooShort.document, "scene-1", "one", "fade-in", 100)).toMatchObject({
      ok: false,
      error: { code: "invalid_operation" },
    });
    expect(applyMotionPreset(fresh, "scene-1", "one", "fade-in", -1)).toMatchObject({
      ok: false,
      error: { code: "invalid_operation" },
    });
  });

  it("sets and clears scene transitions", () => {
    const document = seedDocument();
    const set = setSceneTransition(document, "scene-1", {
      kind: "fade",
      durationMs: 250,
      easing: "ease-in-out",
    });
    expect(set.ok).toBe(true);
    if (!set.ok) return;
    expect(set.document.scenes[0].transitionOut?.kind).toBe("fade");

    const cleared = setSceneTransition(set.document, "scene-1", undefined);
    expect(cleared.ok).toBe(true);
    if (!cleared.ok) return;
    expect(cleared.document.scenes[0].transitionOut).toBeUndefined();
  });

  it("replaces the design system transactionally", () => {
    const document = seedDocument();
    const replacement = createNeutralDesignSystem();
    replacement.colors.accent = "#FF0000";
    const result = setDesignSystem(document, replacement);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.document.designSystem.colors.accent).toBe("#FF0000");
    expect(document.designSystem.colors.accent).toBe("#F97316");
  });
});
