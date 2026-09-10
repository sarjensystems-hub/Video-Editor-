import { describe, expect, it } from "vitest";
import {
  CREATIVE_RETURN_MODES,
  creativeDocumentPayload,
  outlineCreativeDocument,
  parseCreativeReturnMode,
  summarizeCreativeDocument,
} from "./document-summary";
import { getCreativeRenderedDurationMs } from "./frame-time";
import { applyCreativeTransaction } from "./transactions";
import { createEmptyCreativeDocument } from "./defaults";
import type { CreativeDocument, CreativeScene } from "./schema";

function scene(overrides: Partial<CreativeScene> = {}): CreativeScene {
  return {
    id: "scene",
    name: "Scene",
    durationMs: 3000,
    elements: [],
    groups: [],
    ...overrides,
  };
}

function doc(scenes: CreativeScene[]): CreativeDocument {
  return {
    version: 1,
    id: "doc",
    title: "Is That Legal",
    canvas: { width: 1080, height: 1920, fps: 30, background: { kind: "literal", value: "#000000" } },
    designSystem: { colors: {}, typography: {}, spacing: {} } as CreativeDocument["designSystem"],
    scenes,
  };
}

describe("summarizeCreativeDocument", () => {
  it("reports the same duration the renderer will produce", () => {
    const document = doc([scene({ id: "a" }), scene({ id: "b" }), scene({ id: "c" })]);
    expect(summarizeCreativeDocument(document).duration_ms).toBe(
      getCreativeRenderedDurationMs(document),
    );
  });

  it("places scene starts on the overlap-aware timeline, not back to back", () => {
    // A caller that assumes back-to-back placement cuts in the wrong place, so
    // the resolved starts are the reason this summary is worth returning.
    const document = doc([
      scene({ id: "a", durationMs: 3000, transitionOut: { kind: "fade", durationMs: 500, easing: "linear" } }),
      scene({ id: "b", durationMs: 3000 }),
    ]);
    const [a, b] = summarizeCreativeDocument(document).scenes;
    expect(a.start_ms).toBe(0);
    expect(a.end_ms).toBe(3000);
    expect(b.start_ms).toBe(2500);
  });

  it("does not let a trailing transition shorten the film", () => {
    const document = doc([scene({ id: "only", durationMs: 4000, transitionOut: { kind: "fade", durationMs: 900, easing: "linear" } })]);
    const summary = summarizeCreativeDocument(document);
    expect(summary.duration_ms).toBe(4000);
    expect(summary.scenes[0].end_ms).toBe(4000);
  });

  it("spells out where the rendered duration went", () => {
    // Overlapping transitions shorten the film, and reporting only the result
    // made a 56.7s project silently become 52.75s. The arithmetic has to be
    // visible, not just the answer.
    const document = doc([
      scene({ id: "a", durationMs: 3000, transitionOut: { kind: "fade", durationMs: 500, easing: "linear" } }),
      scene({ id: "b", durationMs: 3000, transitionOut: { kind: "fade", durationMs: 300, easing: "linear" } }),
      scene({ id: "c", durationMs: 3000 }),
    ]);
    expect(summarizeCreativeDocument(document).duration_breakdown).toEqual({
      nominal_scene_total_ms: 9000,
      transition_overlap_removed_ms: 800,
      rendered_ms: 8200,
    });
  });

  it("reports no overlap removed when there are no transitions", () => {
    const summary = summarizeCreativeDocument(doc([scene({ id: "a" }), scene({ id: "b" })]));
    expect(summary.duration_breakdown.transition_overlap_removed_ms).toBe(0);
    expect(summary.duration_breakdown.rendered_ms).toBe(summary.duration_ms);
  });

  it("counts elements across every scene", () => {
    const element = { id: "e", name: "e", type: "text" } as unknown as CreativeScene["elements"][number];
    const document = doc([
      scene({ id: "a", elements: [element, element] }),
      scene({ id: "b", elements: [element] }),
    ]);
    const summary = summarizeCreativeDocument(document);
    expect(summary.element_count).toBe(3);
    expect(summary.scenes.map((s) => s.element_count)).toEqual([2, 1]);
  });

  it("stays small next to the document it replaces", () => {
    // The point of the whole change: eight scenes of real elements cost
    // thousands of tokens to echo and a few hundred to summarise.
    const element = {
      id: "headline",
      name: "Headline",
      type: "text",
      text: "Bull bar",
      transform: { x: 0, y: 0, width: 900, height: 300, rotation: 0, opacity: 1, anchorX: 0.5, anchorY: 0.5, zIndex: 2 },
    } as unknown as CreativeScene["elements"][number];
    const document = doc(
      Array.from({ length: 8 }, (_, i) => scene({ id: `s${i}`, elements: [element, element, element, element] })),
    );
    const full = JSON.stringify(document).length;
    const summary = JSON.stringify(summarizeCreativeDocument(document)).length;
    expect(summary).toBeLessThan(full / 3);
  });
});

describe("outlineCreativeDocument", () => {
  it("places scene starts on the overlap-aware timeline, the same resolution summary uses", () => {
    // The outline and the summary must never disagree about where a scene
    // sits - one shared resolveSceneWindows feeds both, and this is the test
    // that would fail first if a future edit forked them back apart.
    const document = doc([
      scene({ id: "a", durationMs: 3000, transitionOut: { kind: "fade", durationMs: 500, easing: "linear" } }),
      scene({ id: "b", durationMs: 3000 }),
    ]);
    const [a, b] = outlineCreativeDocument(document).scenes;
    expect(a.start_ms).toBe(0);
    expect(a.end_ms).toBe(3000);
    expect(b.start_ms).toBe(2500);
  });

  it("resolves an element's timing to the whole scene when none is authored", () => {
    // evaluateSceneAtTime treats a missing `timing` as "visible for the whole
    // scene"; echoing that as undefined would force every caller to already
    // know the engine's default instead of being told it outright.
    const withTiming = {
      id: "e1", name: "Headline", type: "text", timing: { startMs: 500, endMs: 2500 },
    } as unknown as CreativeScene["elements"][number];
    const withoutTiming = { id: "e2", name: "Backdrop", type: "shape" } as unknown as CreativeScene["elements"][number];
    const document = doc([scene({ id: "a", durationMs: 4000, elements: [withTiming, withoutTiming] })]);
    const [element1, element2] = outlineCreativeDocument(document).scenes[0].elements;
    expect(element1.timing).toEqual({ start_ms: 500, end_ms: 2500 });
    expect(element2.timing).toEqual({ start_ms: 0, end_ms: 4000 });
  });

  it("reports which group an element belongs to, and null for one in none", () => {
    // Group membership is the other half of "what is in this film" the row
    // asked for: knowing card-a moves with group-1 is what lets a caller
    // retarget the group instead of three elements that happen to agree.
    const grouped = { id: "card-a", name: "Card A", type: "shape" } as unknown as CreativeScene["elements"][number];
    const solo = { id: "loose", name: "Loose label", type: "text" } as unknown as CreativeScene["elements"][number];
    const document = doc([
      scene({
        id: "a",
        elements: [grouped, solo],
        groups: [{ id: "group-1", name: "Card", elementIds: ["card-a"] }],
      }),
    ]);
    const outline = outlineCreativeDocument(document).scenes[0];
    expect(outline.elements.find((e) => e.id === "card-a")?.group).toBe("group-1");
    expect(outline.elements.find((e) => e.id === "loose")?.group).toBeNull();
    expect(outline.groups).toEqual([{ id: "group-1", name: "Card", element_ids: ["card-a"] }]);
  });

  it("flags has_animations from either the shared track list or text's own kinetic reveal", () => {
    // Two differently-shaped fields both mean "this element moves": the
    // generic keyframe `animations` array every element type can carry, and
    // text's own single kinetic-typography `animation`. Checking only one
    // would under-report every animated headline.
    const keyframed = {
      id: "e1", name: "Moving", type: "shape",
      animations: [{ id: "t1", property: "x", keyframes: [{ timeMs: 0, value: 0, easing: "linear" }] }],
    } as unknown as CreativeScene["elements"][number];
    const kinetic = {
      id: "e2", name: "Kinetic text", type: "text",
      animation: { granularity: "word", mode: "fade", startMs: 0, durationMs: 300, staggerMs: 50, easing: "linear" },
    } as unknown as CreativeScene["elements"][number];
    const still = { id: "e3", name: "Still", type: "shape" } as unknown as CreativeScene["elements"][number];
    const document = doc([scene({ id: "a", elements: [keyframed, kinetic, still] })]);
    const [a, b, c] = outlineCreativeDocument(document).scenes[0].elements;
    expect(a.has_animations).toBe(true);
    expect(b.has_animations).toBe(true);
    expect(c.has_animations).toBe(false);
  });

  it("resolves hidden and locked to concrete booleans instead of leaving them undefined", () => {
    const bare = { id: "e1", name: "Bare", type: "shape" } as unknown as CreativeScene["elements"][number];
    const explicit = {
      id: "e2", name: "Explicit", type: "shape", hidden: true, locked: true,
    } as unknown as CreativeScene["elements"][number];
    const document = doc([scene({ id: "a", elements: [bare, explicit] })]);
    const [a, b] = outlineCreativeDocument(document).scenes[0].elements;
    expect(a.hidden).toBe(false);
    expect(a.locked).toBe(false);
    expect(b.hidden).toBe(true);
    expect(b.locked).toBe(true);
  });

  it("reports document-level audio clip ids/kinds/windows and a marker count", () => {
    const document = {
      ...doc([scene({ id: "a" })]),
      audio: [
        { id: "music-1", name: "Bed", assetId: "asset-1", kind: "music", startMs: 0, endMs: 3000, sourceStartMs: 0, gain: 1 },
      ],
      // Markers are editing metadata only and never affect rendering, so a
      // count is enough to know they exist without paying for the list.
      markers: [{ id: "m1", timeMs: 500, kind: "beat" }, { id: "m2", timeMs: 900, kind: "beat" }],
    } as CreativeDocument;
    const outline = outlineCreativeDocument(document);
    expect(outline.audio).toEqual([{ id: "music-1", kind: "music", start_ms: 0, end_ms: 3000 }]);
    expect(outline.marker_count).toBe(2);
  });

  it("excludes animation keyframes, transforms and text bodies - the whole point of an outline", () => {
    const heavy = {
      id: "headline",
      name: "Headline",
      type: "text",
      text: "Do not leak this string into the outline",
      transform: { x: 10, y: 20, width: 900, height: 300, rotation: 0, opacity: 1, anchorX: 0.5, anchorY: 0.5, zIndex: 2 },
      animations: [{ id: "a1", property: "opacity", keyframes: [{ timeMs: 0, value: 0, easing: "linear" }] }],
    } as unknown as CreativeScene["elements"][number];
    const document = doc([scene({ id: "a", elements: [heavy] })]);
    const outlineElement = outlineCreativeDocument(document).scenes[0].elements[0];
    expect(outlineElement).not.toHaveProperty("transform");
    expect(outlineElement).not.toHaveProperty("animations");
    expect(outlineElement).not.toHaveProperty("text");
    // Belt and suspenders on the serialised form too, so the excluded data
    // could not have leaked back in nested under a different key.
    expect(JSON.stringify(outlineElement)).not.toContain("Do not leak this string");
  });

  it("stays materially smaller than the document once elements carry animation tracks", () => {
    // Row #67's actual complaint: `document` includes every keyframe on
    // every property of every element, and in a real film the animation
    // tracks - not the transforms, not the text bodies - are the largest
    // part of that payload. This is the case `summary`'s own size test
    // (above) does not cover, because it never gives an element a track.
    const animated = {
      id: "headline",
      name: "Headline",
      type: "text",
      text: "Bull bar",
      transform: { x: 0, y: 0, width: 900, height: 300, rotation: 0, opacity: 1, anchorX: 0.5, anchorY: 0.5, zIndex: 2 },
      animations: [
        {
          id: "opacity-in",
          property: "opacity",
          keyframes: Array.from({ length: 12 }, (_, i) => ({ timeMs: i * 100, value: i / 11, easing: "ease-in-out" })),
        },
        {
          id: "y-drift",
          property: "y",
          keyframes: Array.from({ length: 12 }, (_, i) => ({ timeMs: i * 100, value: 40 - i * 3, easing: "ease-in-out" })),
        },
      ],
    } as unknown as CreativeScene["elements"][number];
    const document = doc(
      Array.from({ length: 8 }, (_, i) => scene({ id: `s${i}`, elements: [animated, animated, animated, animated] })),
    );
    const full = JSON.stringify(document).length;
    const outline = JSON.stringify(outlineCreativeDocument(document)).length;
    expect(outline).toBeLessThan(full / 3);
  });
});

describe("parseCreativeReturnMode", () => {
  it("defaults to summary, because the caller wrote the change", () => {
    expect(parseCreativeReturnMode(undefined)).toBe("summary");
    expect(parseCreativeReturnMode(null)).toBe("summary");
  });

  it("honours an explicit mode", () => {
    expect(parseCreativeReturnMode("document")).toBe("document");
    expect(parseCreativeReturnMode("none")).toBe("none");
    expect(parseCreativeReturnMode("outline")).toBe("outline");
    expect(parseCreativeReturnMode(" summary ")).toBe("summary");
  });

  it("takes a caller-supplied fallback, so read tools can keep returning documents", () => {
    expect(parseCreativeReturnMode(undefined, "document")).toBe("document");
  });

  it("rejects anything else rather than silently choosing", () => {
    expect(() => parseCreativeReturnMode("full")).toThrow(/summary, document, none, outline/);
    expect(() => parseCreativeReturnMode(7)).toThrow(/summary, document, none, outline/);
  });

  it("names every mode CREATIVE_RETURN_MODES actually has, so the message cannot go stale", () => {
    // The message used to be a second hand-written copy of this list. Two
    // copies drift; deriving it from the one export cannot.
    for (const mode of CREATIVE_RETURN_MODES) {
      expect(() => parseCreativeReturnMode("not-a-real-mode")).toThrow(new RegExp(mode));
    }
  });
});

describe("creativeDocumentPayload", () => {
  const document = doc([scene()]);

  it("returns a summary by default and the document on request", () => {
    expect(creativeDocumentPayload(document, "summary")).toHaveProperty("summary");
    expect(creativeDocumentPayload(document, "document")).toEqual({ document });
  });

  it("returns an outline on request", () => {
    expect(creativeDocumentPayload(document, "outline")).toHaveProperty("outline");
  });

  it("returns nothing at all under none", () => {
    expect(creativeDocumentPayload(document, "none")).toEqual({});
  });

  it("never carries more than the one field the mode asked for", () => {
    // Looping CREATIVE_RETURN_MODES itself, rather than a hand-copied list of
    // modes, so a mode added later is covered here without an edit.
    for (const mode of CREATIVE_RETURN_MODES) {
      const payload = creativeDocumentPayload(document, mode);
      expect(Object.keys(payload).length).toBeLessThanOrEqual(1);
    }
  });
});

describe("outline carries the note a previous session left", () => {
  /**
   * set_project_scratchpad is documented as holding notes that survive between
   * sessions, but it lived only in a full `document` read - so a resuming
   * session doing the cheap outline read could not see what the film was
   * supposed to be. That is the exact failure mode the scratchpad exists to
   * prevent, so the outline has to carry it.
   */
  it("returns the scratchpad verbatim when one is set", () => {
    const document = doc([scene({ id: "a" })]);
    document.metadata = { scratchpad: "Beat 3 lands the 38% figure; hold the panel until the VO clears." };
    expect(outlineCreativeDocument(document).scratchpad)
      .toBe("Beat 3 lands the 38% figure; hold the panel until the VO clears.");
  });

  it("omits the key entirely when no note is set, rather than reporting null", () => {
    const outline = outlineCreativeDocument(doc([scene({ id: "a" })]));
    expect("scratchpad" in outline).toBe(false);
  });

  it("survives a real set_project_scratchpad transaction end to end", () => {
    // A real transaction validates the whole document, so this needs a document
    // the engine actually accepts rather than the minimal shape the pure
    // outline/summary tests above can get away with.
    const applied = applyCreativeTransaction(createEmptyCreativeDocument({ id: "p" }), {
      summary: "record the brief",
      operations: [{ type: "set_project_scratchpad", scratchpad: "The Grammar Changes — six eras, one object carried across every cut." }],
    });
    expect(applied.ok).toBe(true);
    if (!applied.ok) return;
    expect(outlineCreativeDocument(applied.document).scratchpad).toMatch(/six eras/);
  });
});
