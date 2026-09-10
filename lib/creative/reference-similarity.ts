import type { CreativeDocument } from "./schema";
import type { ReferenceVideoAnalysis } from "./reference-analysis";
import { profileCreativeStructure } from "./structure-profile";

export interface ReferenceSimilarityScore {
  score: number;
  components: {
    duration: number;
    shot_count: number;
    shot_duration: number;
    rhythm_variation: number;
    palette: number;
    motion_density: number;
    visual_density: number;
  };
  measurements: {
    project_scene_count: number;
    reference_shot_count: number;
    project_mean_shot_ms: number;
    reference_mean_shot_ms: number;
  };
  limitations: string[];
}

const clamp01 = (value: number) => Math.max(0, Math.min(1, value));
const mean = (values: number[]) => values.length ? values.reduce((sum, value) => sum + value, 0) / values.length : 0;

function ratioSimilarity(a: number, b: number): number {
  if (a <= 0 && b <= 0) return 1;
  if (a <= 0 || b <= 0) return 0;
  return Math.min(a, b) / Math.max(a, b);
}

function coefficientOfVariation(values: number[]): number {
  const average = mean(values);
  if (average <= 0 || values.length < 2) return 0;
  const variance = mean(values.map((value) => (value - average) ** 2));
  return Math.sqrt(variance) / average;
}

function rgb(hex: string): [number, number, number] | null {
  const match = /^#([0-9a-f]{6})$/i.exec(hex.trim());
  if (!match) return null;
  const value = Number.parseInt(match[1], 16);
  return [(value >> 16) & 255, (value >> 8) & 255, value & 255];
}

function paletteSimilarity(project: string[], reference: string[]): number {
  const a = project.map(rgb).filter(Boolean) as Array<[number, number, number]>;
  const b = reference.map(rgb).filter(Boolean) as Array<[number, number, number]>;
  if (!a.length || !b.length) return 0;
  const maxDistance = Math.sqrt(3 * 255 * 255);
  return mean(b.map((target) => {
    const nearest = Math.min(...a.map((candidate) => Math.sqrt(
      (candidate[0] - target[0]) ** 2 + (candidate[1] - target[1]) ** 2 + (candidate[2] - target[2]) ** 2,
    )));
    return clamp01(1 - nearest / maxDistance);
  }));
}

/**
 * Deterministic structural similarity between the authored project and a
 * measured reference. It deliberately compares only measurements available on
 * both sides; it does not claim semantic, copy, subject or aesthetic equality.
 */
export function scoreReferenceSimilarity(
  project: CreativeDocument,
  reference: ReferenceVideoAnalysis,
): ReferenceSimilarityScore {
  const profile = profileCreativeStructure(project);
  const referenceMeanShot = mean(reference.shot_durations_ms);
  const referenceCv = coefficientOfVariation(reference.shot_durations_ms);
  const motionProxy = clamp01(profile.animation_tracks_per_10s / 12);
  const referenceMotionProxy = clamp01(reference.average_non_cut_change * 4);
  const projectDensityProxy = clamp01(profile.average_visible_elements / 8);

  const components = {
    duration: ratioSimilarity(profile.duration_ms, reference.duration_ms),
    shot_count: ratioSimilarity(profile.scene_count, reference.shot_durations_ms.length),
    shot_duration: ratioSimilarity(profile.shot_duration_mean_ms, referenceMeanShot),
    rhythm_variation: clamp01(1 - Math.abs(profile.shot_duration_cv - referenceCv)),
    palette: paletteSimilarity(profile.palette, reference.palette),
    motion_density: clamp01(1 - Math.abs(motionProxy - referenceMotionProxy)),
    visual_density: clamp01(1 - Math.abs(projectDensityProxy - clamp01(reference.visual_density))),
  };
  const weighted =
    components.duration * 0.10 +
    components.shot_count * 0.15 +
    components.shot_duration * 0.20 +
    components.rhythm_variation * 0.15 +
    components.palette * 0.20 +
    components.motion_density * 0.10 +
    components.visual_density * 0.10;

  return {
    score: Math.round(weighted * 1000) / 10,
    components: Object.fromEntries(Object.entries(components).map(([key, value]) => [key, Math.round(value * 1000) / 10])) as ReferenceSimilarityScore["components"],
    measurements: {
      project_scene_count: profile.scene_count,
      reference_shot_count: reference.shot_durations_ms.length,
      project_mean_shot_ms: Math.round(profile.shot_duration_mean_ms),
      reference_mean_shot_ms: Math.round(referenceMeanShot),
    },
    limitations: [
      "Score is structural and pixel-statistical, not semantic or aesthetic judgment.",
      "Reference motion density is inferred from sampled frame change and cannot separate camera movement from subject movement.",
      "Project visual density uses authored element density while reference visual density uses edge density; the component is an explicit heuristic.",
    ],
  };
}
