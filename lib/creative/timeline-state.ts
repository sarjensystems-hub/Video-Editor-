import { evaluateSceneAtTime } from "./evaluate";
import { getCreativeSceneTimeline } from "./remotion";
import type { CreativeDocument, CreativeElement, CreativeScene } from "./schema";
import { findOwningGroup, hierarchyTransformCss, resolveCameraCss, resolveGroupCss } from "./hierarchy";
import { isHeldBackByGroupContinuation, resolveContinuedGroupTransform } from "./continuation";

export type TimelineVisibilityReason =
  | "visible"
  | "element_hidden"
  | "group_hidden"
  | "before_timing"
  | "after_timing"
  | "held_for_group_continuation";

export interface CreativeTimelineElementState {
  id: string;
  name: string;
  type: CreativeElement["type"];
  alias?: string;
  tags?: string[];
  visible: boolean;
  visibility_reason: TimelineVisibilityReason;
  transform?: ReturnType<typeof evaluateSceneAtTime>["elements"][number]["transform"];
  crop?: ReturnType<typeof evaluateSceneAtTime>["elements"][number]["crop"];
  adjustments?: ReturnType<typeof evaluateSceneAtTime>["elements"][number]["adjustments"];
  resolved_fill?: string;
  draw_progress?: number;
  fill_progress?: number;
  group_id?: string;
  group_css?: ReturnType<typeof resolveGroupCss>;
}

export interface CreativeTimelineSceneState {
  scene_id: string;
  scene_name: string;
  scene_index: number;
  rendered_start_ms: number;
  rendered_end_ms: number;
  scene_local_ms: number;
  transition_out_ms: number;
  background: string;
  camera_css?: ReturnType<typeof resolveCameraCss>;
  elements: CreativeTimelineElementState[];
}

export interface CreativeTimelineState {
  time_ms: number;
  rendered_duration_ms: number;
  active_scenes: CreativeTimelineSceneState[];
  overlapping: boolean;
}

function visibilityReason(
  document: CreativeDocument,
  scene: CreativeScene,
  element: CreativeElement,
  localMs: number,
): TimelineVisibilityReason {
  if (element.hidden) return "element_hidden";
  if (scene.groups.some((group) => group.hidden && group.elementIds.includes(element.id))) return "group_hidden";
  if (element.timing && localMs < element.timing.startMs) return "before_timing";
  if (element.timing && localMs >= element.timing.endMs) return "after_timing";
  if (isHeldBackByGroupContinuation(document, scene, element.id, localMs)) return "held_for_group_continuation";
  return "visible";
}

/**
 * Inspect exactly what the deterministic runtime considers visible at one
 * rendered-timeline millisecond. Scene overlaps are represented honestly: two
 * scenes may be active at once during a transition, just as Remotion mounts two
 * overlapping Sequences. Element transforms stay element-local because camera
 * and group transforms are wrapper transforms in both renderers; those wrapper
 * values are returned alongside the element rather than silently flattened.
 */
export function inspectCreativeTimelineState(
  document: CreativeDocument,
  timeMs: number,
): CreativeTimelineState {
  if (!Number.isFinite(timeMs) || timeMs < 0) throw new Error("time_ms must be a non-negative finite number");
  const timeline = getCreativeSceneTimeline(document);
  const renderedDurationMs = timeline.length
    ? timeline[timeline.length - 1].startMs + timeline[timeline.length - 1].durationMs
    : 0;
  if (timeMs >= renderedDurationMs) {
    throw new Error(`time_ms must be less than the rendered duration of ${renderedDurationMs}ms`);
  }

  const active = timeline.filter((entry) => timeMs >= entry.startMs && timeMs < entry.endMs);
  const activeScenes: CreativeTimelineSceneState[] = active.map((entry) => {
    const scene = document.scenes[entry.sceneIndex];
    const localMs = Math.min(scene.durationMs - 0.001, Math.max(0, timeMs - entry.startMs));
    const evaluated = evaluateSceneAtTime(document, scene, localMs);
    const evaluatedById = new Map(evaluated.elements.map((item) => [item.element.id, item]));

    const elements = scene.elements.map((element): CreativeTimelineElementState => {
      const item = evaluatedById.get(element.id);
      const owningGroup = findOwningGroup(scene.groups, element.id);
      const continuedGroup = owningGroup
        ? resolveContinuedGroupTransform(document, scene, owningGroup.id, localMs)
        : undefined;
      const groupCss = continuedGroup
        ? hierarchyTransformCss(continuedGroup)
        : owningGroup
          ? resolveGroupCss(owningGroup, localMs)
          : undefined;
      const reason = item ? "visible" : visibilityReason(document, scene, element, localMs);
      return {
        id: element.id,
        name: element.name,
        type: element.type,
        ...(element.alias ? { alias: element.alias } : {}),
        ...(element.tags?.length ? { tags: [...element.tags] } : {}),
        visible: Boolean(item),
        visibility_reason: reason,
        ...(item ? { transform: item.transform } : {}),
        ...(item?.crop ? { crop: item.crop } : {}),
        ...(item?.adjustments ? { adjustments: item.adjustments } : {}),
        ...(item?.resolvedFill !== undefined ? { resolved_fill: item.resolvedFill } : {}),
        ...(item?.drawProgress !== undefined ? { draw_progress: item.drawProgress } : {}),
        ...(item?.fillProgress !== undefined ? { fill_progress: item.fillProgress } : {}),
        ...(owningGroup ? { group_id: owningGroup.id } : {}),
        ...(groupCss ? { group_css: groupCss } : {}),
      };
    });

    return {
      scene_id: scene.id,
      scene_name: scene.name,
      scene_index: entry.sceneIndex,
      rendered_start_ms: entry.startMs,
      rendered_end_ms: entry.endMs,
      scene_local_ms: localMs,
      transition_out_ms: entry.transitionOutMs,
      background: evaluated.background,
      ...(resolveCameraCss(scene.camera, localMs) ? { camera_css: resolveCameraCss(scene.camera, localMs) } : {}),
      elements,
    };
  });

  return {
    time_ms: timeMs,
    rendered_duration_ms: renderedDurationMs,
    active_scenes: activeScenes,
    overlapping: activeScenes.length > 1,
  };
}
