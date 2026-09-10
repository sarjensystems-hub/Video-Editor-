import { describe, expect, it } from "vitest";
import { createRevisionSnapshot } from "./persistence";
import { evaluateSceneAtTime, getCreativeDurationMs } from "./evaluate";
import { resolveCreativeFrameAtTime } from "./frame-time";
import { getCreativeCompositionMetadata, getCreativeDocumentAssetIds } from "./remotion";
import { applyCreativeTransaction } from "./transactions";
import { validateCreativeDocument } from "./validate";
import type { CreativeDocument } from "./schema";

/**
 * A document exactly as a pre-V2 project would have been stored: only the
 * V1 element types, no UI element and none of the fields V2 introduced.
 * Nothing added in V2 may make a document like this fail to load, validate,
 * edit, restore or render.
 */
const STORED_BEFORE_V2: CreativeDocument = {
  version: 1,
  id: "legacy-project",
  title: "Legacy launch creative",
  canvas: { width: 1080, height: 1350, fps: 30, background: { kind: "token", token: "bg" } },
  designSystem: {
    colors: { bg: "#0A0A0A", fg: "#FFFFFF", accent: "#EF4444" },
    typography: {
      heading: {
        fontFamily: "Inter",
        fontSize: 64,
        fontWeight: 700,
        lineHeight: 1.05,
        letterSpacing: -1,
        align: "left",
        color: { kind: "token", token: "fg" },
      },
    },
    spacing: { md: 24 },
    radii: { md: 16 },
    strokes: { hairline: { width: 1, color: { kind: "token", token: "accent" } } },
    motion: {
      presets: {
        "rise-in": {
          durationMs: 600,
          easing: "ease-out",
          tracks: [{ property: "y", mode: "delta", from: 40, to: 0 }],
        },
      },
      sceneTransitions: { soft: { kind: "fade", durationMs: 240, easing: "ease-in-out" } },
    },
  },
  scenes: [
    {
      id: "scene-1",
      name: "Hero",
      durationMs: 5000,
      background: { kind: "token", token: "bg" },
      groups: [],
      elements: [
        {
          id: "hero-image",
          name: "Hero image",
          type: "image",
          assetId: "legacy-asset",
          fit: "cover",
          transform: { x: 0, y: 0, width: 1080, height: 1350, rotation: 0, opacity: 1, anchorX: 0, anchorY: 0, zIndex: 0 },
        },
        {
          id: "headline",
          name: "Headline",
          type: "text",
          text: "STOP GUESSING.",
          style: { token: "heading" },
          transform: { x: 80, y: 900, width: 900, height: 200, rotation: 0, opacity: 1, anchorX: 0, anchorY: 0, zIndex: 1 },
          animations: [
            {
              id: "fade-in",
              property: "opacity",
              keyframes: [
                { timeMs: 0, value: 0, easing: "ease-out" },
                { timeMs: 600, value: 1, easing: "ease-out" },
              ],
            },
          ],
        },
        {
          id: "rule",
          name: "Accent rule",
          type: "shape",
          shape: "rect",
          fill: { kind: "token", token: "accent" },
          transform: { x: 80, y: 860, width: 240, height: 8, rotation: 0, opacity: 1, anchorX: 0, anchorY: 0, zIndex: 2 },
        },
      ],
    },
  ],
  metadata: { source: "pre-v2" },
};

describe("existing projects and revisions stay backward compatible", () => {
  it("still validates a document stored before V2", () => {
    const result = validateCreativeDocument(STORED_BEFORE_V2);
    expect(result.issues).toEqual([]);
    expect(result.valid).toBe(true);
  });

  it("still evaluates and reports the same timeline and composition metadata", () => {
    expect(getCreativeDurationMs(STORED_BEFORE_V2)).toBe(5000);
    const metadata = getCreativeCompositionMetadata(STORED_BEFORE_V2);
    expect(metadata).toEqual({ width: 1080, height: 1350, fps: 30, durationInFrames: 150, durationMs: 5000 });
    const evaluated = evaluateSceneAtTime(STORED_BEFORE_V2, STORED_BEFORE_V2.scenes[0], 300);
    expect(evaluated.elements.map((item) => item.element.id)).toEqual(["hero-image", "headline", "rule"]);
    expect(evaluated.elements[1].transform.opacity).toBeGreaterThan(0);
    expect(evaluated.elements[1].transform.opacity).toBeLessThan(1);
  });

  it("still resolves its required assets through the shared collector", () => {
    expect(getCreativeDocumentAssetIds(STORED_BEFORE_V2)).toEqual(["legacy-asset"]);
  });

  it("is previewable at an exact frame by the new still renderer", () => {
    expect(resolveCreativeFrameAtTime(STORED_BEFORE_V2, 0).frame).toBe(0);
    expect(resolveCreativeFrameAtTime(STORED_BEFORE_V2, 4999).frame).toBe(149);
    expect(() => resolveCreativeFrameAtTime(STORED_BEFORE_V2, 5000)).toThrow(/rendered duration/i);
  });

  it("still accepts edit transactions and stays valid afterwards", () => {
    const result = applyCreativeTransaction(STORED_BEFORE_V2, {
      summary: "Legacy edit",
      operations: [
        { type: "set_text", sceneId: "scene-1", elementId: "headline", text: "BOOK IN 30 SECONDS." },
        { type: "move_element", sceneId: "scene-1", elementId: "rule", x: 96, y: 870 },
      ],
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(validateCreativeDocument(result.document).valid).toBe(true);
    // The stored document is never mutated in place.
    const original = STORED_BEFORE_V2.scenes[0].elements.find((element) => element.id === "headline");
    expect(original?.type === "text" ? original.text : null).toBe("STOP GUESSING.");
  });

  it("still snapshots and restores as a revision", () => {
    const snapshot = createRevisionSnapshot(STORED_BEFORE_V2, 7, "Legacy revision");
    expect(snapshot.sequence).toBe(7);
    expect(snapshot.changeSummary).toBe("Legacy revision");
    expect(validateCreativeDocument(snapshot.document).valid).toBe(true);
    expect(snapshot.document).toEqual(STORED_BEFORE_V2);
    // The snapshot is a copy, so restoring it cannot alias the live document.
    expect(snapshot.document).not.toBe(STORED_BEFORE_V2);
  });
});
