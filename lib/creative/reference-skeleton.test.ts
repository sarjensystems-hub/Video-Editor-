import { describe, expect, it } from "vitest";
import { createCanonicalCreativeFixture } from "./fixtures";
import { buildReferenceTimelineSkeleton } from "./reference-skeleton";
import type { ReferenceVideoAnalysis } from "./reference-analysis";
import { validateCreativeDocument } from "./validate";

const analysis: ReferenceVideoAnalysis = {
  duration_ms: 3000,
  sample_times_ms: [0, 500, 1000, 1500, 2000, 2500],
  cuts: [{ time_ms: 1000, change_score: 0.7 }, { time_ms: 2200, change_score: 0.8 }],
  shot_durations_ms: [1000, 1200, 800],
  change_scores: [],
  cut_threshold: 0.4,
  average_non_cut_change: 0.08,
  visual_density: 0.2,
  luminance_contrast: 0.3,
  composition_center: { x: 0.7, y: 0.35 },
  palette: ["#202020", "#e0e0e0"],
  limitations: ["measurement only"],
};

describe("buildReferenceTimelineSkeleton", () => {
  it("turns measured shot durations into valid editable scenes", () => {
    const skeleton = buildReferenceTimelineSkeleton(createCanonicalCreativeFixture(), analysis);
    expect(skeleton.scenes.map((scene) => scene.durationMs)).toEqual([1000, 1200, 800]);
    expect(skeleton.scenes.every((scene) => scene.elements.length === 2)).toBe(true);
    expect(skeleton.scenes[0].elements[1].name).toContain("composition centre");
    expect(validateCreativeDocument(skeleton).valid).toBe(true);
  });

  it("places cut measurements on the editable timeline as cues", () => {
    const skeleton = buildReferenceTimelineSkeleton(createCanonicalCreativeFixture(), analysis);
    expect(skeleton.markers?.map((marker) => marker.timeMs)).toEqual([1000, 2200]);
    expect(skeleton.markers?.every((marker) => marker.kind === "cue")).toBe(true);
  });

  it("keeps the analyzer limitations in metadata instead of overstating inference", () => {
    const skeleton = buildReferenceTimelineSkeleton(createCanonicalCreativeFixture(), analysis);
    expect((skeleton.metadata?.referenceSkeleton as Record<string, unknown>).limitations).toEqual(["measurement only"]);
  });
});
