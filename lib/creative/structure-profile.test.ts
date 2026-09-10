import { describe, expect, it } from "vitest";
import { createCanonicalCreativeFixture } from "./fixtures";
import { critiqueCreativeProject, profileCreativeStructure, scoreCreativeStructureSimilarity } from "./structure-profile";
import type { CreativeDocument } from "./schema";

function repeatedFilm(): CreativeDocument {
  const document = createCanonicalCreativeFixture();
  const source = document.scenes[0];
  const scenes = Array.from({ length: 5 }, (_, index) => ({
    ...JSON.parse(JSON.stringify(source)),
    id: `scene-${index}`,
    name: `Scene ${index}`,
    durationMs: 2000,
    transitionOut: index < 4 ? { kind: "fade" as const, durationMs: 200, easing: "linear" as const } : undefined,
    elements: source.elements.map((element, elementIndex) => ({ ...JSON.parse(JSON.stringify(element)), id: `s${index}-e${elementIndex}` })),
    groups: [],
    camera: undefined,
  }));
  return { ...document, scenes, continuations: [], groupContinuations: [] };
}

describe("Creative structural profiling", () => {
  it("returns stable mechanical measurements instead of subjective prose only", () => {
    const profile = profileCreativeStructure(repeatedFilm());
    expect(profile.scene_count).toBe(5);
    expect(profile.duration_ms).toBe(9200);
    expect(profile.shot_durations_ms).toEqual([2000, 2000, 2000, 2000, 2000]);
    expect(profile.shot_duration_cv).toBe(0);
    expect(profile.transition_kinds.fade).toBe(4);
    expect(profile.repeated_layout_ratio).toBeGreaterThan(0.7);
  });

  it("critic findings expose their numeric threshold and measurement", () => {
    const critique = critiqueCreativeProject(repeatedFilm());
    const repeated = critique.findings.find((finding) => finding.code === "repeated_layouts");
    expect(repeated).toBeTruthy();
    expect(repeated?.measurement).toBe(critique.profile.repeated_layout_ratio);
    expect(repeated?.threshold).toBe(0.35);
    expect(critique.findings.some((finding) => finding.code === "uniform_scene_rhythm")).toBe(true);
    expect(critique.findings.some((finding) => finding.code === "few_cross_scene_handoffs")).toBe(true);
  });

  it("scores identical document structure at 100", () => {
    const film = repeatedFilm();
    expect(scoreCreativeStructureSimilarity(film, JSON.parse(JSON.stringify(film))).score).toBe(100);
  });

  it("drops similarity when scene rhythm and density change", () => {
    const left = repeatedFilm();
    const right = repeatedFilm();
    right.scenes[0].durationMs = 500;
    right.scenes[1].durationMs = 4200;
    right.scenes[0].elements = right.scenes[0].elements.slice(0, 1);
    const score = scoreCreativeStructureSimilarity(left, right);
    expect(score.score).toBeLessThan(100);
    expect(score.components.rhythm).toBeLessThan(1);
  });
});
