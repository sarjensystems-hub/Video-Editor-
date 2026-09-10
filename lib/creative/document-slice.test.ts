import { describe, expect, it } from "vitest";
import {
  isSliceRequested,
  parseCreativeSliceRequest,
  sliceCreativeDocument,
} from "./document-slice";
import type { CreativeDocument, CreativeElement, CreativeScene } from "./schema";

const element = (id: string): CreativeElement =>
  ({
    id,
    name: id,
    type: "shape",
    shape: "rect",
    fill: { kind: "literal", value: "#fff" },
    transform: { x: 0, y: 0, width: 100, height: 100, rotation: 0, opacity: 1, anchorX: 0.5, anchorY: 0.5, zIndex: 1 },
  }) as unknown as CreativeElement;

const scene = (id: string, elementIds: string[]): CreativeScene => ({
  id,
  name: id,
  durationMs: 3000,
  elements: elementIds.map(element),
  groups: [],
});

const document = {
  version: 1,
  id: "doc",
  title: "Film",
  canvas: { width: 1080, height: 1920, fps: 30, background: { kind: "literal", value: "#000" } },
  designSystem: { colors: { ink: "#111" }, typography: {}, spacing: {}, radii: {} },
  scenes: [
    scene("scene-1", ["orb", "label-1"]),
    scene("scene-2", ["hub", "label-2"]),
    scene("scene-3", ["chart", "label-3"]),
  ],
  audio: [{ id: "bed" }],
  markers: [{ id: "beat" }],
  continuations: [{ id: "orb-to-hub" }],
  groupContinuations: [{ id: "knowledge-to-sales" }],
} as unknown as CreativeDocument;

describe("parseCreativeSliceRequest", () => {
  it("reads nothing from an empty request", () => {
    const request = parseCreativeSliceRequest({});
    expect(isSliceRequested(request)).toBe(false);
  });

  it("trims ids and reports a slice was asked for", () => {
    const request = parseCreativeSliceRequest({ scene_ids: [" scene-1 "] });
    expect(request.sceneIds).toEqual(["scene-1"]);
    expect(isSliceRequested(request)).toBe(true);
  });

  it("rejects an empty list rather than treating it as no filter", () => {
    // An empty array is a caller mistake, not a request for everything.
    expect(() => parseCreativeSliceRequest({ scene_ids: [] })).toThrow(/non-empty array/);
    expect(() => parseCreativeSliceRequest({ element_ids: [""] })).toThrow(/non-empty string/);
  });

  it("rejects an unknown include rather than ignoring it", () => {
    expect(() => parseCreativeSliceRequest({ include: ["everything"] })).toThrow(/include must contain only/);
  });
});

describe("sliceCreativeDocument", () => {
  it("returns only the scenes asked for, in document order", () => {
    const slice = sliceCreativeDocument(document, { sceneIds: ["scene-3", "scene-1"] });
    expect(slice.scenes.map((s) => s.id)).toEqual(["scene-1", "scene-3"]);
  });

  it("narrows to the elements asked for and drops scenes with none", () => {
    const slice = sliceCreativeDocument(document, { elementIds: ["orb", "chart"] });
    expect(slice.scenes.map((s) => s.id)).toEqual(["scene-1", "scene-3"]);
    expect(slice.scenes[0].elements.map((e) => e.id)).toEqual(["orb"]);
  });

  it("intersects the two filters", () => {
    const slice = sliceCreativeDocument(document, { sceneIds: ["scene-1"], elementIds: ["orb", "chart"] });
    expect(slice.scenes).toHaveLength(1);
    expect(slice.scenes[0].elements.map((e) => e.id)).toEqual(["orb"]);
  });

  it("always marks itself partial, so it cannot be mistaken for a document", () => {
    // A document missing fifteen of its scenes would fail its own validator;
    // anything round-tripping it would destroy the film.
    expect(sliceCreativeDocument(document, { sceneIds: ["scene-1"] }).partial).toBe(true);
  });

  it("omits the heavy optional blocks unless asked", () => {
    const bare = sliceCreativeDocument(document, { sceneIds: ["scene-1"] });
    expect(bare.design_system).toBeUndefined();
    expect(bare.audio).toBeUndefined();

    const full = sliceCreativeDocument(document, {
      sceneIds: ["scene-1"],
      include: ["design_system", "audio", "markers", "continuations"],
    });
    expect(full.design_system).toEqual(document.designSystem);
    expect(full.audio).toHaveLength(1);
    expect(full.markers).toHaveLength(1);
    expect(full.continuations).toHaveLength(1);
  });

  it("throws on an id that matches nothing rather than returning empty", () => {
    // A typo returning "no scenes" looks exactly like a project that lost its
    // scenes, and the caller goes looking in the wrong place.
    expect(() => sliceCreativeDocument(document, { sceneIds: ["scene-9"] })).toThrow(/No scene with id scene-9/);
    expect(() => sliceCreativeDocument(document, { elementIds: ["ghost"] })).toThrow(/No element with id ghost/);
  });

  it("is much smaller than the document it replaces", () => {
    const full = JSON.stringify(document).length;
    const slice = JSON.stringify(sliceCreativeDocument(document, { elementIds: ["orb"] })).length;
    expect(slice).toBeLessThan(full / 2);
  });

  it("returns every scene when only include is given", () => {
    // include on its own is "the whole shape plus these extras", not a filter.
    const slice = sliceCreativeDocument(document, { include: ["design_system"] });
    expect(slice.scenes).toHaveLength(3);
    expect(slice.design_system).toBeDefined();
  });
});

/**
 * Every optional document-level collection must be reachable through some
 * include.
 *
 * `groupContinuations` was added to the document after this module was written,
 * so a slice read returned element continuations and silently omitted the group
 * ones — the document plainly contained them and the read said otherwise, which
 * reads as data loss rather than a missing option. Same family as the enum and
 * colour drift: a value added to the engine and never surfaced.
 */
describe("no document-level collection is unreachable", () => {
  const OPTIONAL_COLLECTIONS = ["audio", "markers", "continuations", "groupContinuations"] as const;

  it("returns every one of them under some include", () => {
    const everything = sliceCreativeDocument(document, {
      include: ["design_system", "audio", "markers", "continuations"],
    });
    const returned = JSON.stringify(everything);

    for (const key of OPTIONAL_COLLECTIONS) {
      const value = (document as unknown as Record<string, Array<{ id: string }>>)[key];
      expect(value, `fixture has no ${key} to check`).toBeTruthy();
      for (const entry of value) {
        expect(returned, `${key} entry "${entry.id}" is unreachable through any include`)
          .toContain(entry.id);
      }
    }
  });

  it("returns group continuations under the same include as element ones", () => {
    // They are one concept split by target; asking for continuations means both.
    const slice = sliceCreativeDocument(document, { include: ["continuations"] });
    expect(slice.continuations).toHaveLength(1);
    expect(slice.group_continuations).toHaveLength(1);
  });
});
