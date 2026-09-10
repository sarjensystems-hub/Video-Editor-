import { evaluateSceneAtTime, getCreativeDurationMs } from "./evaluate";
import type { CreativeDocument, CreativeElement } from "./schema";

export interface CreativeStructureProfile {
  duration_ms: number;
  scene_count: number;
  shot_durations_ms: number[];
  shot_duration_mean_ms: number;
  shot_duration_cv: number;
  transition_kinds: Record<string, number>;
  transition_diversity: number;
  transition_frequency_per_10s: number;
  average_visible_elements: number;
  max_visible_elements: number;
  average_element_area_ratio: number;
  scale_contrast_ratio: number;
  animation_track_count: number;
  animation_tracks_per_10s: number;
  camera_scene_ratio: number;
  transformed_group_count: number;
  continuation_count: number;
  continuation_rate_per_boundary: number;
  repeated_layout_ratio: number;
  palette: string[];
}

export type CreativeCritiqueSeverity = "info" | "warning";

export interface CreativeCritiqueFinding {
  code:
    | "flat_scale_hierarchy"
    | "high_simultaneous_density"
    | "low_motion_density"
    | "repeated_layouts"
    | "uniform_scene_rhythm"
    | "low_transition_variety"
    | "few_cross_scene_handoffs"
    | "limited_camera_motion";
  severity: CreativeCritiqueSeverity;
  measurement: number;
  threshold: number;
  message: string;
}

export interface CreativeCritique {
  profile: CreativeStructureProfile;
  findings: CreativeCritiqueFinding[];
}

const mean = (values: number[]) => values.length ? values.reduce((sum, value) => sum + value, 0) / values.length : 0;

function coefficientOfVariation(values: number[]): number {
  const average = mean(values);
  if (average <= 0 || values.length < 2) return 0;
  const variance = mean(values.map((value) => (value - average) ** 2));
  return Math.sqrt(variance) / average;
}

function elementAreaRatio(document: CreativeDocument, element: CreativeElement): number {
  return Math.max(0, element.transform.width * element.transform.height)
    / Math.max(1, document.canvas.width * document.canvas.height);
}

function median(values: number[]): number {
  if (!values.length) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[middle] : (sorted[middle - 1] + sorted[middle]) / 2;
}

function literalPalette(document: CreativeDocument): string[] {
  const colors = new Set<string>(Object.values(document.designSystem.colors));
  const add = (value: unknown) => {
    if (!value || typeof value !== "object") return;
    const color = value as { kind?: string; value?: string; gradient?: { stops?: Array<{ color?: unknown }> } };
    if (color.kind === "literal" && typeof color.value === "string") colors.add(color.value);
    if (color.kind === "gradient") color.gradient?.stops?.forEach((stop) => add(stop.color));
  };
  add(document.canvas.background);
  for (const scene of document.scenes) {
    add(scene.background);
    for (const element of scene.elements) {
      if (element.type === "shape") { add(element.fill); if (element.stroke) add(element.stroke.color); }
      if (element.type === "chart") { add(element.fill); add(element.stroke.color); }
      if (element.type === "connector") add(element.stroke.color);
      if (element.type === "ui") add(element.background);
    }
  }
  return [...colors].slice(0, 16);
}

function layoutSignature(document: CreativeDocument, sceneIndex: number): string {
  const scene = document.scenes[sceneIndex];
  const width = document.canvas.width;
  const height = document.canvas.height;
  // Coarse bins deliberately ignore copy/content. This detects recurring
  // composition structure rather than calling repeated words a repeated layout.
  return scene.elements
    .filter((element) => !element.hidden && element.role !== "background")
    .map((element) => {
      const t = element.transform;
      const x = Math.round((t.x / width) * 4);
      const y = Math.round((t.y / height) * 4);
      const w = Math.round((t.width / width) * 4);
      const h = Math.round((t.height / height) * 4);
      return `${element.type}:${x},${y},${w},${h}`;
    })
    .sort()
    .join("|");
}

function repeatedLayoutRatio(document: CreativeDocument): number {
  if (document.scenes.length < 2) return 0;
  const counts = new Map<string, number>();
  for (let index = 0; index < document.scenes.length; index += 1) {
    const signature = layoutSignature(document, index);
    counts.set(signature, (counts.get(signature) ?? 0) + 1);
  }
  const repeated = [...counts.values()].reduce((sum, count) => sum + Math.max(0, count - 1), 0);
  return repeated / document.scenes.length;
}

function visibleElementSamples(document: CreativeDocument): number[] {
  const counts: number[] = [];
  for (const scene of document.scenes) {
    for (const fraction of [0.2, 0.5, 0.8]) {
      const time = Math.max(0, Math.min(scene.durationMs - 0.001, scene.durationMs * fraction));
      counts.push(evaluateSceneAtTime(document, scene, time).elements
        .filter((entry) => entry.element.role !== "background").length);
    }
  }
  return counts;
}

export function profileCreativeStructure(document: CreativeDocument): CreativeStructureProfile {
  const durationMs = getCreativeDurationMs(document);
  const shots = document.scenes.map((scene) => scene.durationMs);
  const transitionKinds: Record<string, number> = {};
  for (const scene of document.scenes.slice(0, -1)) {
    const kind = scene.transitionOut?.kind ?? "cut";
    transitionKinds[kind] = (transitionKinds[kind] ?? 0) + 1;
  }
  const boundaries = Math.max(0, document.scenes.length - 1);
  const areas = document.scenes.flatMap((scene) => scene.elements
    .filter((element) => !element.hidden && element.role !== "background")
    .map((element) => elementAreaRatio(document, element)));
  const positiveAreas = areas.filter((area) => area > 0);
  const largestArea = positiveAreas.length ? Math.max(...positiveAreas) : 0;
  const medianArea = median(positiveAreas);
  const visibleCounts = visibleElementSamples(document);
  const animationTracks = document.scenes.reduce((sum, scene) =>
    sum + (scene.camera?.animations?.length ?? 0)
      + scene.groups.reduce((groupSum, group) => groupSum + (group.animations?.length ?? 0), 0)
      + scene.elements.reduce((elementSum, element) => elementSum + (element.animations?.length ?? 0), 0), 0);
  const cameraScenes = document.scenes.filter((scene) => scene.camera && (scene.camera.animations?.length ||
    scene.camera.transform.x || scene.camera.transform.y || scene.camera.transform.rotation ||
    scene.camera.transform.scaleX !== 1 || scene.camera.transform.scaleY !== 1 || (scene.camera.transform.blurPx ?? 0) > 0)).length;
  const continuationCount = (document.continuations?.length ?? 0) + (document.groupContinuations?.length ?? 0);

  return {
    duration_ms: durationMs,
    scene_count: document.scenes.length,
    shot_durations_ms: shots,
    shot_duration_mean_ms: mean(shots),
    shot_duration_cv: coefficientOfVariation(shots),
    transition_kinds: transitionKinds,
    transition_diversity: boundaries ? Object.keys(transitionKinds).length / boundaries : 0,
    transition_frequency_per_10s: durationMs ? boundaries / (durationMs / 10_000) : 0,
    average_visible_elements: mean(visibleCounts),
    max_visible_elements: visibleCounts.length ? Math.max(...visibleCounts) : 0,
    average_element_area_ratio: mean(positiveAreas),
    scale_contrast_ratio: medianArea > 0 ? largestArea / medianArea : 0,
    animation_track_count: animationTracks,
    animation_tracks_per_10s: durationMs ? animationTracks / (durationMs / 10_000) : 0,
    camera_scene_ratio: document.scenes.length ? cameraScenes / document.scenes.length : 0,
    transformed_group_count: document.scenes.reduce((sum, scene) => sum + scene.groups.filter((group) => group.transform).length, 0),
    continuation_count: continuationCount,
    continuation_rate_per_boundary: boundaries ? continuationCount / boundaries : 0,
    repeated_layout_ratio: repeatedLayoutRatio(document),
    palette: literalPalette(document),
  };
}

/**
 * Mechanical critic. Thresholds are intentionally visible and tied to the
 * measurements returned alongside each finding; this is not a hidden taste
 * model. ChatGPT can accept, reject or reinterpret any finding with context.
 */
export function critiqueCreativeProject(document: CreativeDocument): CreativeCritique {
  const profile = profileCreativeStructure(document);
  const findings: CreativeCritiqueFinding[] = [];
  const push = (finding: CreativeCritiqueFinding) => findings.push(finding);
  if (profile.scale_contrast_ratio < 2.2 && profile.scene_count > 1) push({
    code: "flat_scale_hierarchy", severity: "warning", measurement: profile.scale_contrast_ratio, threshold: 2.2,
    message: "Element-area contrast is low; scenes may read at one visual scale rather than having clear anchors.",
  });
  if (profile.max_visible_elements > 9) push({
    code: "high_simultaneous_density", severity: "warning", measurement: profile.max_visible_elements, threshold: 9,
    message: "At least one sampled moment carries more than nine content elements simultaneously.",
  });
  if (profile.animation_tracks_per_10s < 2 && profile.duration_ms >= 5000) push({
    code: "low_motion_density", severity: "info", measurement: profile.animation_tracks_per_10s, threshold: 2,
    message: "The document uses few explicit animation tracks relative to its duration.",
  });
  if (profile.repeated_layout_ratio > 0.35 && profile.scene_count >= 4) push({
    code: "repeated_layouts", severity: "warning", measurement: profile.repeated_layout_ratio, threshold: 0.35,
    message: "More than a third of scene layouts repeat a coarse composition signature.",
  });
  if (profile.shot_duration_cv < 0.12 && profile.scene_count >= 4) push({
    code: "uniform_scene_rhythm", severity: "info", measurement: profile.shot_duration_cv, threshold: 0.12,
    message: "Scene durations are unusually uniform, which can make pacing feel metronomic.",
  });
  if (profile.transition_diversity < 0.3 && profile.scene_count >= 4) push({
    code: "low_transition_variety", severity: "info", measurement: profile.transition_diversity, threshold: 0.3,
    message: "Most scene boundaries use the same transition family.",
  });
  if (profile.continuation_rate_per_boundary < 0.2 && profile.scene_count >= 4) push({
    code: "few_cross_scene_handoffs", severity: "info", measurement: profile.continuation_rate_per_boundary, threshold: 0.2,
    message: "Few scene boundaries use element/group continuation, so the film may read as discrete compositions.",
  });
  if (profile.camera_scene_ratio < 0.2 && profile.scene_count >= 4) push({
    code: "limited_camera_motion", severity: "info", measurement: profile.camera_scene_ratio, threshold: 0.2,
    message: "Few scenes use camera movement or non-neutral camera framing.",
  });
  return { profile, findings };
}

const similarity = (a: number, b: number, scale = Math.max(1, Math.abs(a), Math.abs(b))) =>
  Math.max(0, 1 - Math.abs(a - b) / scale);

/** Structural—not pixel—similarity for two editable CreativeDocuments. */
export function scoreCreativeStructureSimilarity(
  left: CreativeDocument,
  right: CreativeDocument,
): { score: number; components: Record<string, number>; left: CreativeStructureProfile; right: CreativeStructureProfile } {
  const a = profileCreativeStructure(left);
  const b = profileCreativeStructure(right);
  const components = {
    duration: similarity(a.duration_ms, b.duration_ms),
    scene_count: similarity(a.scene_count, b.scene_count),
    rhythm: similarity(a.shot_duration_cv, b.shot_duration_cv, 0.5),
    density: similarity(a.average_visible_elements, b.average_visible_elements),
    scale_contrast: similarity(a.scale_contrast_ratio, b.scale_contrast_ratio),
    motion_density: similarity(a.animation_tracks_per_10s, b.animation_tracks_per_10s),
    camera_use: similarity(a.camera_scene_ratio, b.camera_scene_ratio, 1),
    continuation_rate: similarity(a.continuation_rate_per_boundary, b.continuation_rate_per_boundary, 1),
    layout_repetition: similarity(a.repeated_layout_ratio, b.repeated_layout_ratio, 1),
  };
  const values = Object.values(components);
  return { score: Math.round(mean(values) * 1000) / 10, components, left: a, right: b };
}
