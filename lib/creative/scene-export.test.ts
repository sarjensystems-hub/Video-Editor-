import { describe, expect, it } from "vitest";
import { createCanonicalCreativeFixture } from "./fixtures";
import { extractSceneDocument, findSceneExportWindow } from "./scene-export";
import type { CreativeAudioClip, CreativeDocument } from "./schema";
import { validateCreativeDocument } from "./validate";
import { getCreativeDurationMs } from "./evaluate";
import { baseGain } from "./audio-timeline";

/**
 * Two copies of the canonical 8s scene with a 1s transition between them, so
 * scene two begins at 7000 on the rendered timeline. The scene duration is left
 * alone on purpose: element timings and animation keyframes are validated
 * against it, so shortening it would make the source document invalid before
 * the extraction was ever asked to do anything.
 */
function twoSceneDocument(audio?: CreativeAudioClip[]): CreativeDocument {
  const base = createCanonicalCreativeFixture();
  const first = base.scenes[0];
  const document: CreativeDocument = {
    ...base,
    scenes: [
      { ...first, id: "scene-a", name: "Opening", transitionOut: { kind: "fade", durationMs: 1000, easing: "ease-in-out" } },
      { ...first, id: "scene-b", name: "Payoff" },
    ],
  };
  if (audio) document.audio = audio;
  return document;
}

const musicBed: CreativeAudioClip = {
  id: "bed",
  name: "Music bed",
  assetId: "asset-music",
  kind: "music",
  startMs: 0,
  endMs: 14000,
  sourceStartMs: 0,
  gain: 0.8,
  fadeInMs: 500,
  fadeOutMs: 500,
};

describe("findSceneExportWindow", () => {
  it("places each scene on the overlap-aware timeline", () => {
    const document = twoSceneDocument();
    expect(findSceneExportWindow(document, "scene-a")).toEqual({
      sceneId: "scene-a",
      sceneIndex: 0,
      startMs: 0,
      endMs: 8000,
      durationMs: 8000,
    });
    // Scene two starts where scene one's transition begins, not at 8000.
    expect(findSceneExportWindow(document, "scene-b")).toMatchObject({ startMs: 7000, endMs: 15000 });
  });

  it("returns null for a scene the document does not have", () => {
    expect(findSceneExportWindow(twoSceneDocument(), "nope")).toBeNull();
  });
});

describe("extractSceneDocument", () => {
  it("produces a valid one-scene document of exactly the clip's length", () => {
    const document = extractSceneDocument(twoSceneDocument(), "scene-b");
    expect(document.scenes).toHaveLength(1);
    expect(document.scenes[0].id).toBe("scene-b");
    expect(getCreativeDurationMs(document)).toBe(8000);
    expect(validateCreativeDocument(document).valid).toBe(true);
  });

  it("drops the outgoing transition, which had nothing left to cut to", () => {
    const document = extractSceneDocument(twoSceneDocument(), "scene-a");
    expect(document.scenes[0].transitionOut).toBeUndefined();
    // Without the transition the clip is its own full length, not shortened by
    // an overlap with a scene that is no longer there.
    expect(getCreativeDurationMs(document)).toBe(8000);
  });

  it("keeps the canvas and design system so the clip matches the film", () => {
    const source = twoSceneDocument();
    const document = extractSceneDocument(source, "scene-b");
    expect(document.canvas).toEqual(source.canvas);
    expect(document.designSystem).toEqual(source.designSystem);
  });

  it("refuses a scene from another project rather than rendering the wrong clip", () => {
    expect(() => extractSceneDocument(twoSceneDocument(), "scene-z")).toThrow(/not part of this project/i);
  });
});

describe("extractSceneDocument audio", () => {
  it("re-bases a bed onto the window and advances the source in-point", () => {
    const document = extractSceneDocument(twoSceneDocument([musicBed]), "scene-b");
    const clip = document.audio?.[0];
    expect(clip).toBeDefined();
    // Scene two runs 7000..15000 and the bed ends at 14000, so it plays
    // 0..7000 of the export...
    expect(clip?.startMs).toBe(0);
    expect(clip?.endMs).toBe(7000);
    // ...starting 7000ms into the music rather than replaying its opening.
    expect(clip?.sourceStartMs).toBe(7000);
  });

  it("drops a fade whose edge was cut away and keeps one that survived", () => {
    const document = extractSceneDocument(twoSceneDocument([musicBed]), "scene-b");
    const clip = document.audio?.[0];
    // The head was trimmed, so the authored fade-in already happened.
    expect(clip?.fadeInMs).toBeUndefined();
    // The tail was not, so its fade-out still belongs to this clip.
    expect(clip?.fadeOutMs).toBe(500);
  });

  it("keeps both fades when the window contains the whole clip", () => {
    const shortBed: CreativeAudioClip = { ...musicBed, startMs: 7200, endMs: 13000, sourceStartMs: 0 };
    const document = extractSceneDocument(twoSceneDocument([shortBed]), "scene-b");
    const clip = document.audio?.[0];
    expect(clip?.fadeInMs).toBe(500);
    expect(clip?.fadeOutMs).toBe(500);
    expect(clip?.sourceStartMs).toBe(0);
  });

  it("drops a clip that never sounds inside the window", () => {
    const early: CreativeAudioClip = { ...musicBed, id: "early", startMs: 0, endMs: 2000 };
    const document = extractSceneDocument(twoSceneDocument([early]), "scene-b");
    expect(document.audio).toBeUndefined();
  });

  it("preserves the gain curve across the cut", () => {
    const automated: CreativeAudioClip = {
      ...musicBed,
      fadeInMs: undefined,
      fadeOutMs: undefined,
      gainKeyframes: [
        { timeMs: 0, gain: 0.2 },
        { timeMs: 12000, gain: 1.2 },
      ],
    };
    const source = twoSceneDocument([automated]);
    const document = extractSceneDocument(source, "scene-b");
    const clip = document.audio?.[0];
    expect(clip?.gainKeyframes).toBeDefined();

    // The exported clip must sound the way the film sounded at the same moment.
    for (const offset of [0, 500, 1500, 4000, 7000]) {
      expect(baseGain(clip!, offset)).toBeCloseTo(baseGain(automated, 7000 + offset), 6);
    }
    expect(validateCreativeDocument(document).valid).toBe(true);
  });

  it("emits gain keyframes the validator accepts: integer and strictly ordered", () => {
    const automated: CreativeAudioClip = {
      ...musicBed,
      fadeInMs: undefined,
      fadeOutMs: undefined,
      gainKeyframes: [
        { timeMs: 0, gain: 0.2 },
        { timeMs: 9000, gain: 0.9 },
        { timeMs: 12000, gain: 1.2 },
      ],
    };
    const document = extractSceneDocument(twoSceneDocument([automated]), "scene-b");
    const points = document.audio?.[0].gainKeyframes ?? [];
    expect(points.length).toBeGreaterThan(1);
    for (let i = 0; i < points.length; i += 1) {
      expect(Number.isInteger(points[i].timeMs)).toBe(true);
      expect(points[i].timeMs).toBeGreaterThanOrEqual(0);
      if (i > 0) expect(points[i].timeMs).toBeGreaterThan(points[i - 1].timeMs);
    }
    expect(validateCreativeDocument(document).valid).toBe(true);
  });
});

describe("extractSceneDocument markers", () => {
  it("keeps only the markers inside the window, re-based to zero", () => {
    const source = twoSceneDocument();
    source.markers = [
      { id: "m1", timeMs: 500, kind: "cue" },
      { id: "m2", timeMs: 7500, kind: "cue" },
    ];
    const document = extractSceneDocument(source, "scene-b");
    expect(document.markers).toEqual([{ id: "m2", timeMs: 500, kind: "cue" }]);
  });
});

describe("extractSceneDocument continuations", () => {
  /**
   * The regression this exists for: the extraction spread the whole document
   * and carried its continuations into a one-scene clip, where each of them
   * named a scene that had just been dropped. The clip then failed
   * validateCreativeDocument, so /api/creative/render answered 422 before
   * creating a job row - a scene export that died instantly on a film whose
   * full render was fine. A film that uses continuations is the normal case,
   * not an exotic one, so this broke clip export for most real projects.
   */
  function withContinuations(): CreativeDocument {
    const document = twoSceneDocument();
    const [first] = document.scenes[0].elements;
    const [second] = document.scenes[1].elements;
    document.continuations = [{
      id: "carry-the-mark",
      fromSceneId: "scene-a",
      toSceneId: "scene-b",
      fromElementId: first.id,
      toElementId: second.id,
      durationMs: 1000,
    }];
    document.groupContinuations = [{
      id: "carry-the-cluster",
      fromSceneId: "scene-a",
      toSceneId: "scene-b",
      fromGroupId: "group-a",
      toGroupId: "group-b",
      childMapping: [],
      durationMs: 1000,
    }];
    return document;
  }

  it("drops continuations rather than leaving them naming a scene that is gone", () => {
    const clip = extractSceneDocument(withContinuations(), "scene-a");
    expect(clip.continuations).toBeUndefined();
    expect(clip.groupContinuations).toBeUndefined();
  });

  it("produces a clip that actually validates, which is what the export gate checks", () => {
    for (const sceneId of ["scene-a", "scene-b"]) {
      const result = validateCreativeDocument(extractSceneDocument(withContinuations(), sceneId));
      expect(result.valid, `${sceneId}: ${JSON.stringify(result.issues)}`).toBe(true);
    }
  });

  it("leaves the source document untouched", () => {
    const document = withContinuations();
    extractSceneDocument(document, "scene-a");
    expect(document.continuations).toHaveLength(1);
    expect(document.groupContinuations).toHaveLength(1);
  });
});
