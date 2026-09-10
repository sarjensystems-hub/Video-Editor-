import { describe, expect, it } from "vitest";
import { createCanonicalCreativeFixture } from "./fixtures";
import {
  applyEditorTransaction,
  createCreativeEditorState,
  markEditorSaved,
  redoEditor,
  setEditorSelection,
  undoEditor,
} from "./editor-state";

function headlineText(state: ReturnType<typeof createCreativeEditorState>) {
  const element = state.document.scenes[0].elements.find((item) => item.id === "headline");
  return element?.type === "text" ? element.text : null;
}

describe("creative editor state", () => {
  it("supports transaction history with undo and redo", () => {
    let state = createCreativeEditorState(createCanonicalCreativeFixture());
    state = applyEditorTransaction(state, {
      summary: "Edit headline",
      operations: [{ type: "set_text", sceneId: "scene-1", elementId: "headline", text: "RIGHT PEOPLE. RIGHT CARE." }],
    });
    expect(headlineText(state)).toBe("RIGHT PEOPLE. RIGHT CARE.");
    expect(state.dirty).toBe(true);

    state = undoEditor(state);
    expect(headlineText(state)).toBe("STOP GUESSING.");
    expect(state.future).toHaveLength(1);

    state = redoEditor(state);
    expect(headlineText(state)).toBe("RIGHT PEOPLE. RIGHT CARE.");
  });

  it("invalidates redo after a new edit", () => {
    let state = createCreativeEditorState(createCanonicalCreativeFixture());
    state = applyEditorTransaction(state, {
      summary: "First edit",
      operations: [{ type: "set_text", sceneId: "scene-1", elementId: "headline", text: "FIRST" }],
    });
    state = undoEditor(state);
    expect(state.future).toHaveLength(1);
    state = applyEditorTransaction(state, {
      summary: "Different edit",
      operations: [{ type: "set_text", sceneId: "scene-1", elementId: "headline", text: "SECOND" }],
    });
    expect(state.future).toHaveLength(0);
    expect(headlineText(state)).toBe("SECOND");
  });

  it("normalizes selection when an element is removed", () => {
    let state = createCreativeEditorState(createCanonicalCreativeFixture());
    state = setEditorSelection(state, { sceneId: "scene-1", elementIds: ["headline", "accent-line"] });
    state = applyEditorTransaction(state, {
      summary: "Remove accent",
      operations: [{ type: "remove_element", sceneId: "scene-1", elementId: "accent-line" }],
    });
    expect(state.selection.elementIds).toEqual(["headline"]);
  });

  it("tracks the saved checkpoint independently of history", () => {
    let state = createCreativeEditorState(createCanonicalCreativeFixture());
    state = applyEditorTransaction(state, {
      summary: "Edit",
      operations: [{ type: "set_hidden", sceneId: "scene-1", elementId: "brand-logo", hidden: true }],
    });
    expect(state.dirty).toBe(true);
    state = markEditorSaved(state);
    expect(state.dirty).toBe(false);
    expect(state.savedDocument).toBe(state.document);
  });
});