import type {
  AnimationProperty,
  ColorValue,
  CreativeCamera,
  CreativeContinuation,
  CreativeGroupContinuation,
  CreativeHierarchyTransform,
  CreativeDesignSystem,
  CreativeDocument,
  CreativeElement,
  CreativeGroup,
  CreativeScene,
  ElementAnimation,
  ElementTiming,
  MotionPresetTrack,
  SceneTransition,
} from "./schema";
import { validateCreativeDocument } from "./validate";

export interface CreativeOperationError {
  code: "not_found" | "duplicate_id" | "invalid_operation" | "invalid_reference";
  message: string;
}

export type CreativeOperationResult =
  | { ok: true; document: CreativeDocument }
  | { ok: false; error: CreativeOperationError; document?: CreativeDocument };

function failure(
  code: CreativeOperationError["code"],
  message: string,
  document?: CreativeDocument,
): CreativeOperationResult {
  return document
    ? { ok: false, error: { code, message }, document }
    : { ok: false, error: { code, message } };
}

function success(document: CreativeDocument): CreativeOperationResult {
  const result = validateCreativeDocument(document);
  if (!result.valid) {
    const issue = result.issues[0];
    return failure(
      issue?.code === "duplicate_id" ? "duplicate_id" : "invalid_operation",
      issue ? `${issue.path}: ${issue.message}` : "The edit would create an invalid document.",
      document,
    );
  }
  return { ok: true, document };
}

function cloneAnimations(value?: ElementAnimation[]): ElementAnimation[] | undefined {
  return value?.map((animation) => ({
    ...animation,
    keyframes: animation.keyframes.map((keyframe) => ({ ...keyframe })),
  }));
}

/**
 * A one-level spread (`{ ...color }`) was a full clone before gradients
 * existed, because a literal or token colour has only primitive fields. A
 * gradient's `stops` array is real nested structure, so every existing
 * `{ ...x.color }` / `{ ...x.fill }` call site now routes through this
 * instead — otherwise two document revisions would share the same stops
 * array by reference, which happens to be harmless today only because
 * nothing mutates a ColorValue in place, and that is not an invariant worth
 * depending on silently.
 */
function cloneColorValue(color: ColorValue): ColorValue {
  if (color.kind !== "gradient") return { ...color };
  return {
    ...color,
    gradient: {
      ...color.gradient,
      stops: color.gradient.stops.map((stop) => ({ ...stop, color: cloneColorValue(stop.color) })),
    },
  };
}

function cloneElement(element: CreativeElement): CreativeElement {
  const transform = { ...element.transform };
  const timing = element.timing ? { ...element.timing } : undefined;
  const animations = cloneAnimations(element.animations);
  const adjustments = element.adjustments ? { ...element.adjustments } : undefined;
  const mask = element.mask ? { ...element.mask } : undefined;
  const motionBlur = element.motionBlur ? { ...element.motionBlur } : undefined;

  switch (element.type) {
    case "text":
      return {
        ...element,
        transform,
        timing,
        animations,
        adjustments,
        mask,
        motionBlur,
        animation: element.animation ? { ...element.animation } : undefined,
        fit: element.fit ? { ...element.fit } : undefined,
        style: {
          ...element.style,
          overrides: element.style.overrides
            ? {
                ...element.style.overrides,
                color: element.style.overrides.color ? cloneColorValue(element.style.overrides.color) : undefined,
              }
            : undefined,
        },
      };
    case "image":
      return {
        ...element,
        transform,
        timing,
        animations,
        adjustments,
        mask,
        motionBlur,
        crop: element.crop ? { ...element.crop } : undefined,
      };
    case "video":
      return {
        ...element,
        transform,
        timing,
        animations,
        adjustments,
        mask,
        motionBlur,
        crop: element.crop ? { ...element.crop } : undefined,
      };
    case "shape":
      return {
        ...element,
        transform,
        timing,
        animations,
        adjustments,
        mask,
        motionBlur,
        fill: cloneColorValue(element.fill),
        gradientAnimation: element.gradientAnimation
          ? JSON.parse(JSON.stringify(element.gradientAnimation)) as typeof element.gradientAnimation
          : undefined,
        stroke: element.stroke ? { ...element.stroke, color: cloneColorValue(element.stroke.color) } : undefined,
        // Two outline point arrays plus a possible cubic-bezier easing object -
        // real nested structure, the same reason gradientAnimation just above
        // gets a structural clone rather than the shallow `{ ...x }` a flat
        // field like `counter` relies on being safe.
        morph: element.morph
          ? JSON.parse(JSON.stringify(element.morph)) as typeof element.morph
          : undefined,
      };
    case "chart":
      return {
        ...element,
        transform,
        timing,
        animations,
        adjustments,
        mask,
        motionBlur,
        series: [...element.series],
        stroke: { ...element.stroke, color: cloneColorValue(element.stroke.color) },
        fill: element.fill ? cloneColorValue(element.fill) : undefined,
        pointEmphasis: element.pointEmphasis?.map((entry) => ({
          ...entry,
          color: entry.color ? cloneColorValue(entry.color) : undefined,
        })),
      };
    case "connector":
      return {
        ...element,
        transform,
        timing,
        animations,
        adjustments,
        mask,
        motionBlur,
        stroke: { ...element.stroke, color: cloneColorValue(element.stroke.color) },
      };
    case "ui":
      return {
        ...element,
        transform,
        timing,
        animations,
        adjustments,
        mask,
        motionBlur,
        viewport: { ...element.viewport },
        background: element.background ? cloneColorValue(element.background) : undefined,
        // The node tree is plain validated JSON, so a structural copy is
        // both correct and cheaper than hand-walking every node kind.
        nodes: JSON.parse(JSON.stringify(element.nodes)) as typeof element.nodes,
        scroll: element.scroll ? { ...element.scroll } : undefined,
        pointer: element.pointer
          ? {
              ...element.pointer,
              color: cloneColorValue(element.pointer.color),
              keyframes: element.pointer.keyframes.map((keyframe) => ({ ...keyframe })),
            }
          : undefined,
      };
    case "composite":
      return {
        ...element,
        transform,
        timing,
        animations,
        adjustments,
        mask,
        motionBlur,
        viewport: { ...element.viewport },
        // Real elements, so each gets the exact same per-type clone this
        // switch already gives a top-level element - never a shallower
        // structural copy that would let two documents share a nested
        // gradient's stops array or an animation's keyframes by reference.
        children: element.children.map(cloneElement),
      };
  }
}

function cloneGroup(group: CreativeGroup): CreativeGroup {
  return { ...group, elementIds: [...group.elementIds] };
}

function cloneScene(scene: CreativeScene): CreativeScene {
  return {
    ...scene,
    background: scene.background ? cloneColorValue(scene.background) : undefined,
    transitionOut: scene.transitionOut ? { ...scene.transitionOut } : undefined,
    elements: scene.elements.map(cloneElement),
    groups: scene.groups.map(cloneGroup),
  };
}

function cloneDesignSystem(system: CreativeDesignSystem): CreativeDesignSystem {
  const typography: CreativeDesignSystem["typography"] = {};
  for (const [key, token] of Object.entries(system.typography)) {
    typography[key] = { ...token, color: cloneColorValue(token.color) };
  }
  const strokes: CreativeDesignSystem["strokes"] = {};
  for (const [key, stroke] of Object.entries(system.strokes)) {
    strokes[key] = { ...stroke, color: cloneColorValue(stroke.color) };
  }
  const presets: CreativeDesignSystem["motion"]["presets"] = {};
  for (const [key, preset] of Object.entries(system.motion.presets)) {
    presets[key] = { ...preset, tracks: preset.tracks.map((track) => ({ ...track })) };
  }
  const sceneTransitions: CreativeDesignSystem["motion"]["sceneTransitions"] = {};
  for (const [key, transition] of Object.entries(system.motion.sceneTransitions)) {
    sceneTransitions[key] = { ...transition };
  }
  return {
    colors: { ...system.colors },
    typography,
    spacing: { ...system.spacing },
    radii: { ...system.radii },
    strokes,
    motion: { presets, sceneTransitions },
    mediaDirection: system.mediaDirection
      ? { ...system.mediaDirection, avoid: system.mediaDirection.avoid ? [...system.mediaDirection.avoid] : undefined }
      : undefined,
  };
}

function scenePosition(document: CreativeDocument, sceneId: string): number {
  return document.scenes.findIndex((scene) => scene.id === sceneId);
}

function elementPosition(scene: CreativeScene, elementId: string): number {
  return scene.elements.findIndex((element) => element.id === elementId);
}

function groupPosition(scene: CreativeScene, groupId: string): number {
  return scene.groups.findIndex((group) => group.id === groupId);
}

function replaceScene(document: CreativeDocument, index: number, scene: CreativeScene): CreativeOperationResult {
  const scenes = [...document.scenes];
  scenes[index] = scene;
  return success({ ...document, scenes });
}

function replaceElement(
  document: CreativeDocument,
  targetScenePosition: number,
  targetElementPosition: number,
  element: CreativeElement,
): CreativeOperationResult {
  const scene = document.scenes[targetScenePosition];
  const elements = [...scene.elements];
  elements[targetElementPosition] = element;
  return replaceScene(document, targetScenePosition, { ...scene, elements });
}

function insertIndexValid(index: number, length: number): boolean {
  return Number.isInteger(index) && index >= 0 && index <= length;
}

function reorderIndexValid(index: number, length: number): boolean {
  return Number.isInteger(index) && index >= 0 && index < length;
}

export function addScene(document: CreativeDocument, scene: CreativeScene, index = document.scenes.length): CreativeOperationResult {
  if (document.scenes.some((item) => item.id === scene.id)) {
    return failure("duplicate_id", `Scene ${scene.id} already exists.`);
  }
  if (!insertIndexValid(index, document.scenes.length)) {
    return failure("invalid_operation", "Scene insertion index is out of range.");
  }
  const scenes = [...document.scenes];
  scenes.splice(index, 0, cloneScene(scene));
  return success({ ...document, scenes });
}

export function updateScene(
  document: CreativeDocument,
  sceneId: string,
  patch: Partial<Omit<CreativeScene, "id">>,
): CreativeOperationResult {
  const index = scenePosition(document, sceneId);
  if (index < 0) return failure("not_found", `Scene ${sceneId} was not found.`);
  const current = document.scenes[index];
  const next: CreativeScene = {
    ...current,
    ...patch,
    id: current.id,
    background: patch.background ? cloneColorValue(patch.background) : current.background,
    transitionOut: patch.transitionOut ? { ...patch.transitionOut } : current.transitionOut,
    elements: patch.elements ? patch.elements.map(cloneElement) : current.elements,
    groups: patch.groups ? patch.groups.map(cloneGroup) : current.groups,
  };
  return replaceScene(document, index, next);
}

export function removeScene(document: CreativeDocument, sceneId: string): CreativeOperationResult {
  const index = scenePosition(document, sceneId);
  if (index < 0) return failure("not_found", `Scene ${sceneId} was not found.`);
  if (document.scenes.length === 1) return failure("invalid_operation", "The last remaining scene cannot be removed.");
  return success({ ...document, scenes: document.scenes.filter((_, position) => position !== index) });
}

export function reorderScene(document: CreativeDocument, sceneId: string, toIndex: number): CreativeOperationResult {
  const fromIndex = scenePosition(document, sceneId);
  if (fromIndex < 0) return failure("not_found", `Scene ${sceneId} was not found.`);
  if (!reorderIndexValid(toIndex, document.scenes.length)) return failure("invalid_operation", "Scene reorder index is out of range.");
  const scenes = [...document.scenes];
  const [scene] = scenes.splice(fromIndex, 1);
  scenes.splice(toIndex, 0, scene);
  return success({ ...document, scenes });
}

export function addElement(
  document: CreativeDocument,
  sceneId: string,
  element: CreativeElement,
  index?: number,
): CreativeOperationResult {
  const targetScenePosition = scenePosition(document, sceneId);
  if (targetScenePosition < 0) return failure("not_found", `Scene ${sceneId} was not found.`);
  const scene = document.scenes[targetScenePosition];
  if (scene.elements.some((item) => item.id === element.id)) return failure("duplicate_id", `Element ${element.id} already exists.`);
  const insertionIndex = index ?? scene.elements.length;
  if (!insertIndexValid(insertionIndex, scene.elements.length)) return failure("invalid_operation", "Element insertion index is out of range.");
  const elements = [...scene.elements];
  elements.splice(insertionIndex, 0, cloneElement(element));
  return replaceScene(document, targetScenePosition, { ...scene, elements });
}

export function updateElement(
  document: CreativeDocument,
  sceneId: string,
  elementId: string,
  patch: Partial<CreativeElement>,
): CreativeOperationResult {
  const targetScenePosition = scenePosition(document, sceneId);
  if (targetScenePosition < 0) return failure("not_found", `Scene ${sceneId} was not found.`);
  const scene = document.scenes[targetScenePosition];
  const targetElementPosition = elementPosition(scene, elementId);
  if (targetElementPosition < 0) return failure("not_found", `Element ${elementId} was not found.`);
  const current = scene.elements[targetElementPosition];
  if (patch.id !== undefined && patch.id !== current.id) return failure("invalid_operation", "Element id cannot be changed.");
  if (patch.type !== undefined && patch.type !== current.type) return failure("invalid_operation", "Element type cannot be changed.");
  const candidate = {
    ...current,
    ...patch,
    id: current.id,
    type: current.type,
    transform: patch.transform ? { ...patch.transform } : current.transform,
    timing: patch.timing ? { ...patch.timing } : current.timing,
    animations: patch.animations ? cloneAnimations(patch.animations) : current.animations,
  } as CreativeElement;
  return replaceElement(document, targetScenePosition, targetElementPosition, cloneElement(candidate));
}

export function removeElement(document: CreativeDocument, sceneId: string, elementId: string): CreativeOperationResult {
  const targetScenePosition = scenePosition(document, sceneId);
  if (targetScenePosition < 0) return failure("not_found", `Scene ${sceneId} was not found.`);
  const scene = document.scenes[targetScenePosition];
  const targetElementPosition = elementPosition(scene, elementId);
  if (targetElementPosition < 0) return failure("not_found", `Element ${elementId} was not found.`);
  const elements = scene.elements.filter((_, position) => position !== targetElementPosition);
  const groups = scene.groups
    .map((group) => ({ ...group, elementIds: group.elementIds.filter((id) => id !== elementId) }))
    .filter((group) => group.elementIds.length > 0);
  return replaceScene(document, targetScenePosition, { ...scene, elements, groups });
}

export function reorderElement(document: CreativeDocument, sceneId: string, elementId: string, toIndex: number): CreativeOperationResult {
  const targetScenePosition = scenePosition(document, sceneId);
  if (targetScenePosition < 0) return failure("not_found", `Scene ${sceneId} was not found.`);
  const scene = document.scenes[targetScenePosition];
  const fromIndex = elementPosition(scene, elementId);
  if (fromIndex < 0) return failure("not_found", `Element ${elementId} was not found.`);
  if (!reorderIndexValid(toIndex, scene.elements.length)) return failure("invalid_operation", "Element reorder index is out of range.");
  const elements = [...scene.elements];
  const [element] = elements.splice(fromIndex, 1);
  elements.splice(toIndex, 0, element);
  return replaceScene(document, targetScenePosition, { ...scene, elements });
}

function groupMembersError(scene: CreativeScene, elementIds: string[], ignoreGroupId?: string): CreativeOperationError | null {
  if (elementIds.length === 0) return { code: "invalid_reference", message: "A group must contain at least one element." };
  const local = new Set<string>();
  for (const elementId of elementIds) {
    if (local.has(elementId)) return { code: "invalid_reference", message: `Element ${elementId} is duplicated in the group.` };
    local.add(elementId);
    if (!scene.elements.some((element) => element.id === elementId)) {
      return { code: "invalid_reference", message: `Element ${elementId} does not exist in scene ${scene.id}.` };
    }
    if (scene.groups.some((group) => group.id !== ignoreGroupId && group.elementIds.includes(elementId))) {
      return { code: "invalid_reference", message: `Element ${elementId} already belongs to another group.` };
    }
  }
  return null;
}

export function createGroup(document: CreativeDocument, sceneId: string, group: CreativeGroup): CreativeOperationResult {
  const targetScenePosition = scenePosition(document, sceneId);
  if (targetScenePosition < 0) return failure("not_found", `Scene ${sceneId} was not found.`);
  const scene = document.scenes[targetScenePosition];
  if (scene.groups.some((item) => item.id === group.id)) return failure("duplicate_id", `Group ${group.id} already exists.`);
  const memberError = groupMembersError(scene, group.elementIds);
  if (memberError) return { ok: false, error: memberError };
  return replaceScene(document, targetScenePosition, { ...scene, groups: [...scene.groups, cloneGroup(group)] });
}

export function updateGroup(
  document: CreativeDocument,
  sceneId: string,
  groupId: string,
  patch: Partial<Omit<CreativeGroup, "id">>,
): CreativeOperationResult {
  const targetScenePosition = scenePosition(document, sceneId);
  if (targetScenePosition < 0) return failure("not_found", `Scene ${sceneId} was not found.`);
  const scene = document.scenes[targetScenePosition];
  const targetGroupPosition = groupPosition(scene, groupId);
  if (targetGroupPosition < 0) return failure("not_found", `Group ${groupId} was not found.`);
  const current = scene.groups[targetGroupPosition];
  const elementIds = patch.elementIds ? [...patch.elementIds] : current.elementIds;
  const memberError = groupMembersError(scene, elementIds, groupId);
  if (memberError) return { ok: false, error: memberError };
  const groups = [...scene.groups];
  groups[targetGroupPosition] = { ...current, ...patch, id: current.id, elementIds };
  return replaceScene(document, targetScenePosition, { ...scene, groups });
}

export function ungroup(document: CreativeDocument, sceneId: string, groupId: string): CreativeOperationResult {
  const targetScenePosition = scenePosition(document, sceneId);
  if (targetScenePosition < 0) return failure("not_found", `Scene ${sceneId} was not found.`);
  const scene = document.scenes[targetScenePosition];
  const targetGroupPosition = groupPosition(scene, groupId);
  if (targetGroupPosition < 0) return failure("not_found", `Group ${groupId} was not found.`);
  return replaceScene(document, targetScenePosition, {
    ...scene,
    groups: scene.groups.filter((_, position) => position !== targetGroupPosition),
  });
}

export function setElementTiming(
  document: CreativeDocument,
  sceneId: string,
  elementId: string,
  timing?: ElementTiming,
): CreativeOperationResult {
  const targetScenePosition = scenePosition(document, sceneId);
  if (targetScenePosition < 0) return failure("not_found", `Scene ${sceneId} was not found.`);
  const scene = document.scenes[targetScenePosition];
  const targetElementPosition = elementPosition(scene, elementId);
  if (targetElementPosition < 0) return failure("not_found", `Element ${elementId} was not found.`);
  const element = cloneElement(scene.elements[targetElementPosition]);
  element.timing = timing ? { ...timing } : undefined;
  return replaceElement(document, targetScenePosition, targetElementPosition, element);
}

export function setElementAnimations(
  document: CreativeDocument,
  sceneId: string,
  elementId: string,
  animations: ElementAnimation[],
): CreativeOperationResult {
  const targetScenePosition = scenePosition(document, sceneId);
  if (targetScenePosition < 0) return failure("not_found", `Scene ${sceneId} was not found.`);
  const scene = document.scenes[targetScenePosition];
  const targetElementPosition = elementPosition(scene, elementId);
  if (targetElementPosition < 0) return failure("not_found", `Element ${elementId} was not found.`);
  const element = cloneElement(scene.elements[targetElementPosition]);
  element.animations = cloneAnimations(animations);
  return replaceElement(document, targetScenePosition, targetElementPosition, element);
}

export function clearElementAnimations(document: CreativeDocument, sceneId: string, elementId: string): CreativeOperationResult {
  const targetScenePosition = scenePosition(document, sceneId);
  if (targetScenePosition < 0) return failure("not_found", `Scene ${sceneId} was not found.`);
  const scene = document.scenes[targetScenePosition];
  const targetElementPosition = elementPosition(scene, elementId);
  if (targetElementPosition < 0) return failure("not_found", `Element ${elementId} was not found.`);
  const element = cloneElement(scene.elements[targetElementPosition]);
  element.animations = undefined;
  return replaceElement(document, targetScenePosition, targetElementPosition, element);
}

function baseValue(element: CreativeElement, property: AnimationProperty): number {
  if (property === "scaleX" || property === "scaleY") return 1;
  if (property === "x") return element.transform.x;
  if (property === "y") return element.transform.y;
  if (property === "rotation") return element.transform.rotation;
  return element.transform.opacity;
}

function motionIntensityScale(document: CreativeDocument): number {
  switch (document.designSystem.mediaDirection?.motionIntensity) {
    case "low": return 0.72;
    case "high": return 1.28;
    default: return 1;
  }
}

function presetValue(element: CreativeElement, track: MotionPresetTrack, value: number, intensity: number): number {
  const base = baseValue(element, track.property);
  if (track.mode === "absolute") return value;
  if (track.mode === "delta") return base + value * intensity;
  return base * (1 + (value - 1) * intensity);
}

export function applyMotionPreset(
  document: CreativeDocument,
  sceneId: string,
  elementId: string,
  presetName: string,
  startMs: number,
): CreativeOperationResult {
  const targetScenePosition = scenePosition(document, sceneId);
  if (targetScenePosition < 0) return failure("not_found", `Scene ${sceneId} was not found.`);
  const scene = document.scenes[targetScenePosition];
  const targetElementPosition = elementPosition(scene, elementId);
  if (targetElementPosition < 0) return failure("not_found", `Element ${elementId} was not found.`);
  const preset = document.designSystem.motion.presets[presetName];
  if (!preset) return failure("invalid_reference", `Motion preset ${presetName} does not exist.`);
  if (!Number.isInteger(startMs) || startMs < 0) return failure("invalid_operation", "Motion preset startMs must be a non-negative integer.");

  const element = scene.elements[targetElementPosition];
  const visibleStartMs = element.timing?.startMs ?? 0;
  const visibleEndMs = element.timing?.endMs ?? scene.durationMs;
  const endMs = startMs + preset.durationMs;
  if (startMs < visibleStartMs || endMs > visibleEndMs) {
    return failure("invalid_operation", `Motion preset ${presetName} falls outside the element's visible window.`);
  }

  const intensity = motionIntensityScale(document);
  const replacedProperties = new Set(preset.tracks.map((track) => track.property));
  const preserved = (element.animations ?? []).filter((animation) => !replacedProperties.has(animation.property));
  const expanded: ElementAnimation[] = preset.tracks.map((track) => ({
    id: `preset:${presetName}:${track.property}`,
    property: track.property,
    keyframes: [
      { timeMs: startMs, value: presetValue(element, track, track.from, intensity), easing: preset.easing },
      { timeMs: endMs, value: presetValue(element, track, track.to, intensity), easing: preset.easing },
    ],
  }));
  return setElementAnimations(document, sceneId, elementId, [...preserved, ...expanded]);
}

export function setSceneTransition(
  document: CreativeDocument,
  sceneId: string,
  transition?: SceneTransition,
): CreativeOperationResult {
  const targetScenePosition = scenePosition(document, sceneId);
  if (targetScenePosition < 0) return failure("not_found", `Scene ${sceneId} was not found.`);
  const scene = document.scenes[targetScenePosition];
  return replaceScene(document, targetScenePosition, {
    ...scene,
    transitionOut: transition ? { ...transition } : undefined,
  });
}

/**
 * Give a scene a camera, or take it away.
 *
 * One animated camera replaces the same move authored onto every element in
 * lockstep — twenty tracks that must agree exactly or the composition shears.
 */
/**
 * Declare that one element becomes another across a scene boundary, or drop the
 * declaration.
 *
 * Validation does the real work: a continuation that does not fit inside the
 * scenes' overlap is rejected with the transition to lengthen, because a morph
 * with nowhere to happen renders as a cut and says nothing about why.
 */
export function setContinuation(
  document: CreativeDocument,
  continuation: CreativeContinuation,
): CreativeOperationResult {
  const existing = document.continuations ?? [];
  const index = existing.findIndex((entry) => entry.id === continuation.id);
  const next = index >= 0
    ? existing.map((entry, position) => (position === index ? { ...continuation } : entry))
    : [...existing, { ...continuation }];
  return success({ ...document, continuations: next });
}

export function removeContinuation(
  document: CreativeDocument,
  continuationId: string,
): CreativeOperationResult {
  const existing = document.continuations ?? [];
  if (!existing.some((entry) => entry.id === continuationId)) {
    return failure("not_found", `Continuation ${continuationId} was not found.`);
  }
  const next = existing.filter((entry) => entry.id !== continuationId);
  return success({ ...document, continuations: next.length ? next : undefined });
}

/** Declare that one group becomes another across a scene boundary, or drop it. */
export function setGroupContinuation(
  document: CreativeDocument,
  continuation: CreativeGroupContinuation,
): CreativeOperationResult {
  const existing = document.groupContinuations ?? [];
  const index = existing.findIndex((entry) => entry.id === continuation.id);
  const next = index >= 0
    ? existing.map((entry, position) => (position === index ? { ...continuation } : entry))
    : [...existing, { ...continuation }];
  return success({ ...document, groupContinuations: next });
}

export function removeGroupContinuation(
  document: CreativeDocument,
  continuationId: string,
): CreativeOperationResult {
  const existing = document.groupContinuations ?? [];
  if (!existing.some((entry) => entry.id === continuationId)) {
    return failure("not_found", `Group continuation ${continuationId} was not found.`);
  }
  const next = existing.filter((entry) => entry.id !== continuationId);
  return success({ ...document, groupContinuations: next.length ? next : undefined });
}

export function setSceneCamera(
  document: CreativeDocument,
  sceneId: string,
  camera?: CreativeCamera,
): CreativeOperationResult {
  const targetScenePosition = scenePosition(document, sceneId);
  if (targetScenePosition < 0) return failure("not_found", `Scene ${sceneId} was not found.`);
  const scene = document.scenes[targetScenePosition];
  return replaceScene(document, targetScenePosition, {
    ...scene,
    camera: camera
      ? {
          transform: { ...camera.transform },
          animations: camera.animations?.map((a) => ({ ...a, keyframes: a.keyframes.map((k) => ({ ...k })) })),
          perspectivePx: camera.perspectivePx,
          perspectiveOriginX: camera.perspectiveOriginX,
          perspectiveOriginY: camera.perspectiveOriginY,
        }
      : undefined,
  });
}

/**
 * Give a group a transform so its children move as one, or take it away.
 *
 * Clearing leaves the group in place as an organisational grouping, which is
 * all a group was before transforms existed.
 */
export function setGroupTransform(
  document: CreativeDocument,
  sceneId: string,
  groupId: string,
  transform?: CreativeHierarchyTransform,
  animations?: ElementAnimation[],
): CreativeOperationResult {
  const targetScenePosition = scenePosition(document, sceneId);
  if (targetScenePosition < 0) return failure("not_found", `Scene ${sceneId} was not found.`);
  const scene = document.scenes[targetScenePosition];
  const groupIndex = scene.groups.findIndex((group) => group.id === groupId);
  if (groupIndex < 0) return failure("not_found", `Group ${groupId} was not found.`);

  const groups = scene.groups.map((group, index) =>
    index === groupIndex
      ? {
          ...group,
          transform: transform ? { ...transform } : undefined,
          animations: transform
            ? animations?.map((a) => ({ ...a, keyframes: a.keyframes.map((k) => ({ ...k })) }))
            : undefined,
        }
      : group,
  );
  return replaceScene(document, targetScenePosition, { ...scene, groups });
}

export function setDesignSystem(document: CreativeDocument, designSystem: CreativeDesignSystem): CreativeOperationResult {
  return success({ ...document, designSystem: cloneDesignSystem(designSystem) });
}

export const addGroup = createGroup;
export const removeGroup = ungroup;
