import type {
  AnimationProperty,
  BlendMode,
  ColorValue,
  CreativeAdjustments,
  CreativeAudioClip,
  CreativeChartAxes,
  CreativeGlass,
  TextStyleRef,
  CreativeChartCallout,
  CreativeChartKind,
  ConnectorCurve,
  CreativeMarker,
  CreativeMask,
  CreativeMotionBlur,
  CreativeSpeedRamp,
  CreativeCamera,
  CreativeContinuation,
  CreativeDesignSystem,
  CreativeGroupContinuation,
  CreativeGradientAnimation,
  CreativeDocument,
  CreativeHierarchyTransform,
  CreativeElement,
  CreativeTextElement,
  CreativeUiNode,
  CreativeVideoElement,
  CreativeGroup,
  CreativeScene,
  ElementAnimation,
  ElementTiming,
  SceneTransition,
  CreativeShapeMorph,
  CreativeTextAnimation,
  CreativeTextCounter,
  CreativeTextFit,
  EasingSpec,
  MotionValueMode,
  StrokeToken,
  TextStyleToken,
} from "./schema";
import {
  addElement,
  addScene,
  applyMotionPreset,
  createGroup,
  removeElement,
  removeScene,
  reorderElement,
  reorderScene,
  setDesignSystem,
  removeContinuation,
  removeGroupContinuation,
  setContinuation,
  setGroupContinuation,
  setGroupTransform,
  setSceneCamera,
  setElementAnimations,
  setElementTiming,
  setSceneTransition,
  ungroup,
  updateElement,
  updateGroup,
  updateScene,
  type CreativeOperationResult,
} from "./operations";
import { collectCreativeUiNodeIds, patchCreativeUiNode } from "./ui-element";
import { validateCreativeDocument } from "./validate";
import { getCreativeDurationMs } from "./evaluate";
import { applyGroupStagger, applyOrbitGroup, explodeTextElement } from "./authoring-primitives";
import { setCreativeAssetAlias } from "./asset-alias";
import { setCreativeProjectAttachment, removeCreativeProjectAttachment } from "./project-attachments";
import { buildCompositionTemplateScene } from "./composition-templates";
import {
  duplicateVideoClip,
  freezeVideoClip,
  setVideoClipSpeed,
  slipVideoClip,
  splitVideoClip,
  trimVideoClip,
  type ClipSpeedMode,
} from "./clip-edit";

export type CreativeTransactionOperation =
  | { type: "set_canvas"; width?: number; height?: number; fps?: number }
  | { type: "set_project_scratchpad"; scratchpad: string }
  | { type: "set_asset_alias"; alias: string; assetId?: string }
  | { type: "set_project_attachment"; attachment: { id: string; kind: "reference" | "brand"; assetId: string; label?: string } }
  | { type: "remove_project_attachment"; attachmentId: string }
  | { type: "add_composition_template"; template: "hero" | "split" | "metric-grid"; sceneId: string; durationMs?: number; index?: number }
  | { type: "normalize_timeline_duration"; targetMs: number; sceneId?: string }
  | { type: "add_element"; sceneId: string; element: CreativeElement; index?: number }
  | { type: "update_element"; sceneId: string; elementId: string; patch: Partial<CreativeElement> }
  | {
      type: "update_elements";
      /** Explicit targets, when the set is not describable by a suffix. */
      targets?: Array<{ sceneId: string; elementId: string }>;
      /** Selects every element whose id ends with this, across the scenes considered. */
      elementIdEndsWith?: string;
      /** Semantic query alternative to explicit targets or id suffix. */
      selector?: {
        aliases?: string[];
        tags?: string[];
        type?: CreativeElement["type"];
        role?: "background";
        nameContains?: string;
      };
      /** Narrows a suffix/semantic selector to these scenes; omit to consider all of them. */
      sceneIds?: string[];
      patch: Partial<CreativeElement>;
    }
  | { type: "remove_element"; sceneId: string; elementId: string }
  | { type: "reorder_element"; sceneId: string; elementId: string; toIndex: number }
  | { type: "move_element"; sceneId: string; elementId: string; x: number; y: number }
  | { type: "resize_element"; sceneId: string; elementId: string; width: number; height: number }
  | { type: "set_text"; sceneId: string; elementId: string; text: string }
  | { type: "set_hidden"; sceneId: string; elementId: string; hidden: boolean }
  | { type: "set_locked"; sceneId: string; elementId: string; locked: boolean }
  | { type: "set_timing"; sceneId: string; elementId: string; timing?: ElementTiming }
  | { type: "set_animation"; sceneId: string; elementId: string; animations: ElementAnimation[] }
  | { type: "apply_motion_preset"; sceneId: string; elementId: string; presetName: string; startMs: number }
  | {
      type: "stagger_group";
      sceneId: string; groupId: string; elementIds?: string[];
      property: AnimationProperty; from: number; to: number; mode?: MotionValueMode;
      startMs: number; durationMs: number; staggerMs: number; easing: EasingSpec;
    }
  | {
      type: "orbit_group";
      sceneId: string; groupId: string; itemIds?: string[];
      centerElementId?: string; centerX?: number; centerY?: number;
      radius: number; startAngleDeg?: number; radiusTo?: number; rotateByDeg?: number;
      startMs?: number; endMs?: number; easing?: EasingSpec;
    }
  | { type: "explode_text"; sceneId: string; elementId: string; granularity: "word" | "character"; groupId?: string }
  | { type: "add_scene"; scene: CreativeScene; index?: number }
  | { type: "update_scene"; sceneId: string; patch: Partial<Omit<CreativeScene, "id">> }
  | { type: "remove_scene"; sceneId: string }
  | { type: "reorder_scene"; sceneId: string; toIndex: number }
  | { type: "set_transition"; sceneId: string; transition?: SceneTransition }
  | { type: "set_scene_camera"; sceneId: string; camera?: CreativeCamera }
  | { type: "continue_element"; continuation: CreativeContinuation }
  | { type: "continue_group"; continuation: CreativeGroupContinuation }
  | { type: "remove_group_continuation"; continuationId: string }
  | { type: "remove_continuation"; continuationId: string }
  | {
      type: "set_group_transform";
      sceneId: string;
      groupId: string;
      transform?: CreativeHierarchyTransform;
      animations?: ElementAnimation[];
    }
  | { type: "split_clip"; sceneId: string; elementId: string; atMs: number }
  | { type: "trim_clip"; sceneId: string; elementId: string; startMs?: number; endMs?: number }
  | { type: "slip_clip"; sceneId: string; elementId: string; byMs: number }
  | { type: "set_clip_speed"; sceneId: string; elementId: string; speed: number; mode?: ClipSpeedMode }
  | { type: "freeze_clip"; sceneId: string; elementId: string; atMs: number }
  | { type: "duplicate_clip"; sceneId: string; elementId: string; atMs: number }
  | { type: "apply_text_animation"; sceneId: string; elementId: string; childId?: string; animation?: CreativeTextAnimation }
  | { type: "set_text_fit"; sceneId: string; elementId: string; fit?: CreativeTextFit }
  | { type: "set_counter"; sceneId: string; elementId: string; counter?: CreativeTextCounter }
  | { type: "animate_ui_node"; sceneId: string; elementId: string; nodeId: string; animations: ElementAnimation[] }
  | { type: "set_ui_node_timing"; sceneId: string; elementId: string; nodeId: string; timing?: ElementTiming }
  | { type: "move_ui_node"; sceneId: string; elementId: string; nodeId: string; x: number; y: number }
  | { type: "resize_ui_node"; sceneId: string; elementId: string; nodeId: string; width: number; height: number }
  | { type: "set_adjustments"; sceneId: string; elementId: string; adjustments?: CreativeAdjustments }
  | { type: "add_audio_clip"; clip: CreativeAudioClip }
  | { type: "update_audio_clip"; clipId: string; patch: Partial<Omit<CreativeAudioClip, "id">> }
  | { type: "remove_audio_clip"; clipId: string }
  | { type: "set_clip_speed_ramp"; sceneId: string; elementId: string; speedRamp?: CreativeSpeedRamp }
  | { type: "set_mask"; sceneId: string; elementId: string; mask?: CreativeMask }
  | { type: "set_motion_blur"; sceneId: string; elementId: string; motionBlur?: CreativeMotionBlur }
  | { type: "set_fill"; sceneId: string; elementId: string; fill: ColorValue }
  | { type: "set_gradient_animation"; sceneId: string; elementId: string; animation?: CreativeGradientAnimation }
  | { type: "set_shape_morph"; sceneId: string; elementId: string; morph?: CreativeShapeMorph }
  | {
      type: "set_connector";
      sceneId: string;
      elementId: string;
      fromElementId?: string;
      toElementId?: string;
      curve?: ConnectorCurve;
      stroke?: StrokeToken;
      drawProgress?: number;
    }
  | { type: "set_blend_mode"; sceneId: string; elementId: string; blendMode?: BlendMode }
  | { type: "set_glass"; sceneId: string; elementId: string; glass?: CreativeGlass }
  | {
      type: "set_chart_axes";
      sceneId: string;
      elementId: string;
      axes?: CreativeChartAxes;
      callouts?: CreativeChartCallout[];
      labelStyle?: TextStyleRef;
    }
  | {
      type: "set_chart_data";
      sceneId: string;
      elementId: string;
      chartKind: CreativeChartKind;
      series: number[];
      axisMin?: number;
      axisMax?: number;
      drawProgress?: number;
      fillProgress?: number;
      staggerPoints?: number;
      stroke: StrokeToken;
      fill?: ColorValue;
    }
  | {
      type: "set_chart_point_emphasis";
      sceneId: string;
      elementId: string;
      index: number;
      scale?: number;
      color?: ColorValue;
    }
  | { type: "add_marker"; marker: CreativeMarker }
  | { type: "remove_marker"; markerId: string }
  | { type: "create_group"; sceneId: string; group: CreativeGroup }
  | { type: "update_group"; sceneId: string; groupId: string; patch: Partial<Omit<CreativeGroup, "id">> }
  | { type: "ungroup"; sceneId: string; groupId: string }
  | { type: "set_design_token"; namespace: "colors"; token: string; value: string }
  | { type: "set_design_token"; namespace: "spacing" | "radii"; token: string; value: number }
  | { type: "set_design_token"; namespace: "typography"; token: string; value: TextStyleToken };

export interface CreativeTransaction {
  summary: string;
  operations: CreativeTransactionOperation[];
}

export type CreativeTransactionResult =
  | { ok: true; document: CreativeDocument; summary: string; operationCount: number }
  | {
      ok: false;
      document: CreativeDocument;
      error: { code: string; message: string; operationIndex?: number };
    };

function findElement(document: CreativeDocument, sceneId: string, elementId: string) {
  return document.scenes.find((scene) => scene.id === sceneId)?.elements.find((element) => element.id === elementId);
}

function patchTransform(
  document: CreativeDocument,
  sceneId: string,
  elementId: string,
  patch: Partial<CreativeElement["transform"]>,
): CreativeOperationResult {
  const element = findElement(document, sceneId, elementId);
  if (!element) {
    return { ok: false, error: { code: "not_found", message: `Element ${elementId} was not found.` } };
  }
  return updateElement(document, sceneId, elementId, {
    transform: { ...element.transform, ...patch },
  } as Partial<CreativeElement>);
}

function updateTransactionElement(
  document: CreativeDocument,
  sceneId: string,
  elementId: string,
  patch: Partial<CreativeElement>,
): CreativeOperationResult {
  const element = findElement(document, sceneId, elementId);
  if (!element || !patch.transform) return updateElement(document, sceneId, elementId, patch);
  return updateElement(document, sceneId, elementId, {
    ...patch,
    transform: { ...element.transform, ...patch.transform },
  } as Partial<CreativeElement>);
}

/**
 * One patch applied to many elements.
 *
 * A templated film repeats one element role across every scene — that is the
 * design, and the repetition is what makes it read as a system. Restyling the
 * scrims of an eight-scene film meant eight near-identical operations, three
 * separate times.
 *
 * A selector that matches nothing is an error, not a no-op. A mistyped suffix
 * that silently changed nothing would burn a revision and send the caller to
 * look for the fault in the renderer.
 */
function updateElements(
  document: CreativeDocument,
  operation: Extract<CreativeTransactionOperation, { type: "update_elements" }>,
): CreativeOperationResult {
  const { targets, elementIdEndsWith, selector, sceneIds, patch } = operation;
  const reject = (
    code: "not_found" | "invalid_operation",
    message: string,
  ): CreativeOperationResult => ({ ok: false, error: { code, message } });

  const addressingCount = [targets != null, elementIdEndsWith != null, selector != null].filter(Boolean).length;
  if (addressingCount !== 1) {
    return reject("invalid_operation", "update_elements needs exactly one of targets, elementIdEndsWith or selector.");
  }

  let resolved: Array<{ sceneId: string; elementId: string }>;
  if (targets) {
    if (targets.length === 0) {
      return reject("invalid_operation", "update_elements targets must not be empty.");
    }
    resolved = targets;
  } else {
    const scope = sceneIds && sceneIds.length ? new Set(sceneIds) : null;
    if (scope) {
      const missing = [...scope].filter((id) => !document.scenes.some((scene) => scene.id === id));
      if (missing.length) return reject("not_found", `Scene ${missing[0]} was not found.`);
    }
    if (elementIdEndsWith != null) {
      const suffix = elementIdEndsWith;
      if (!suffix) return reject("invalid_operation", "update_elements elementIdEndsWith must not be empty.");
      resolved = document.scenes
        .filter((scene) => !scope || scope.has(scene.id))
        .flatMap((scene) => scene.elements
          .filter((element) => element.id.endsWith(suffix))
          .map((element) => ({ sceneId: scene.id, elementId: element.id })));
    } else {
      const query = selector!;
      if (!query.aliases?.length && !query.tags?.length && !query.type && !query.role && !query.nameContains) {
        return reject("invalid_operation", "update_elements selector must contain at least one criterion.");
      }
      const aliases = query.aliases?.length ? new Set(query.aliases) : null;
      const requestedTags = query.tags?.length ? new Set(query.tags) : null;
      const needle = query.nameContains?.toLowerCase();
      resolved = document.scenes
        .filter((scene) => !scope || scope.has(scene.id))
        .flatMap((scene) => scene.elements
          .filter((element) => {
            if (aliases && (!element.alias || !aliases.has(element.alias))) return false;
            if (requestedTags && ![...requestedTags].every((tag) => element.tags?.includes(tag))) return false;
            if (query.type && element.type !== query.type) return false;
            if (query.role && element.role !== query.role) return false;
            if (needle && !element.name.toLowerCase().includes(needle)) return false;
            return true;
          })
          .map((element) => ({ sceneId: scene.id, elementId: element.id })));
    }
    if (resolved.length === 0) return reject("not_found", elementIdEndsWith != null
      ? `No element id ends with "${elementIdEndsWith}"${scope ? " in the scenes given" : ""}.`
      : "update_elements selector matched no elements.");
  }

  // Every step validates the whole document, so the last successful result is
  // already a validated one — and any failure aborts before it is returned,
  // which keeps the operation as atomic as the single-element version.
  let current: CreativeOperationResult | null = null;
  let working = document;
  for (const target of resolved) {
    current = updateTransactionElement(working, target.sceneId, target.elementId, patch);
    if (!current.ok) return current;
    working = current.document;
  }
  return current!;
}

/**
 * Edit one node inside a `ui` element's tree.
 *
 * A ui element used to be atomic, so choreographing five nested rows meant
 * tearing the interface apart into separate elements and losing the reason to
 * use ui at all. These operations reach a single node by id and leave the rest
 * of the tree byte-identical.
 */
function patchUiNode(
  document: CreativeDocument,
  sceneId: string,
  elementId: string,
  nodeId: string,
  patch: (node: CreativeUiNode) => CreativeUiNode,
): CreativeOperationResult {
  const element = findElement(document, sceneId, elementId);
  if (!element) {
    return { ok: false, error: { code: "not_found", message: `Element ${elementId} was not found.` } };
  }
  if (element.type !== "ui") {
    return { ok: false, error: { code: "invalid_operation", message: `Element ${elementId} is not a ui element.` } };
  }

  const { nodes, found } = patchCreativeUiNode(element.nodes, nodeId, patch);
  if (!found) {
    // Naming what the element does contain turns "nothing happened" into one
    // readable mistake.
    const available = collectCreativeUiNodeIds(element.nodes).slice(0, 12).join(", ");
    return {
      ok: false,
      error: {
        code: "not_found",
        message: `UI node ${nodeId} was not found in ${elementId}. It contains: ${available}.`,
      },
    };
  }

  return updateElement(document, sceneId, elementId, { nodes } as Partial<CreativeElement>);
}

function setText(document: CreativeDocument, sceneId: string, elementId: string, text: string): CreativeOperationResult {
  const element = findElement(document, sceneId, elementId);
  if (!element) {
    return { ok: false, error: { code: "not_found", message: `Element ${elementId} was not found.` } };
  }
  if (element.type !== "text") {
    return { ok: false, error: { code: "invalid_operation", message: `Element ${elementId} is not text.` } };
  }
  return updateElement(document, sceneId, elementId, { text } as Partial<CreativeElement>);
}

function cloneDesignSystem(system: CreativeDesignSystem): CreativeDesignSystem {
  return JSON.parse(JSON.stringify(system)) as CreativeDesignSystem;
}

function setCanvas(
  document: CreativeDocument,
  operation: Extract<CreativeTransactionOperation, { type: "set_canvas" }>,
): CreativeOperationResult {
  if (operation.width === undefined && operation.height === undefined && operation.fps === undefined) {
    return { ok: false, error: { code: "invalid_operation", message: "set_canvas requires width, height or fps." } };
  }
  return {
    ok: true,
    document: {
      ...document,
      canvas: {
        ...document.canvas,
        ...(operation.width === undefined ? {} : { width: operation.width }),
        ...(operation.height === undefined ? {} : { height: operation.height }),
        ...(operation.fps === undefined ? {} : { fps: operation.fps }),
      },
    },
  };
}

function setDesignToken(document: CreativeDocument, operation: Extract<CreativeTransactionOperation, { type: "set_design_token" }>): CreativeOperationResult {
  const next = cloneDesignSystem(document.designSystem);
  if (operation.namespace === "colors") next.colors[operation.token] = operation.value;
  else if (operation.namespace === "spacing") next.spacing[operation.token] = operation.value;
  else if (operation.namespace === "radii") next.radii[operation.token] = operation.value;
  else next.typography[operation.token] = JSON.parse(JSON.stringify(operation.value)) as TextStyleToken;
  return setDesignSystem(document, next);
}

/** Adds, patches or removes one document-level audio clip. */
function editAudioClips(
  document: CreativeDocument,
  edit: (clips: CreativeAudioClip[]) => CreativeAudioClip[] | { error: string },
): CreativeOperationResult {
  const result = edit([...(document.audio ?? [])]);
  if ("error" in result) {
    return { ok: false, error: { code: "not_found", message: result.error } };
  }
  return { ok: true, document: { ...document, audio: result } };
}

/** Applies a text-only property, refusing elements that are not text. */
function setTextProperty(
  document: CreativeDocument,
  sceneId: string,
  elementId: string,
  patch: Partial<Pick<CreativeTextElement, "animation" | "fit" | "counter">>,
): CreativeOperationResult {
  const element = findElement(document, sceneId, elementId);
  if (!element) {
    return { ok: false, error: { code: "not_found", message: `Element ${elementId} was not found.` } };
  }
  if (element.type !== "text") {
    return { ok: false, error: { code: "invalid_operation", message: `Element ${elementId} is not text.` } };
  }
  return updateElement(document, sceneId, elementId, patch as Partial<CreativeElement>);
}

function setCompositeChildTextProperty(
  document: CreativeDocument,
  sceneId: string,
  elementId: string,
  childId: string,
  patch: Partial<Pick<CreativeTextElement, "animation" | "fit" | "counter">>,
): CreativeOperationResult {
  const element = findElement(document, sceneId, elementId);
  if (!element) return { ok: false, error: { code: "not_found", message: `Element ${elementId} was not found.` } };
  if (element.type !== "composite") return { ok: false, error: { code: "invalid_operation", message: `Element ${elementId} is not a composite element.` } };
  const index = element.children.findIndex((child) => child.id === childId);
  if (index < 0) return { ok: false, error: { code: "not_found", message: `Composite child ${childId} was not found in ${elementId}.` } };
  const child = element.children[index];
  if (child.type !== "text") return { ok: false, error: { code: "invalid_operation", message: `Composite child ${childId} is not text.` } };
  const children = [...element.children];
  children[index] = { ...child, ...patch };
  return updateElement(document, sceneId, elementId, { children } as Partial<CreativeElement>);
}

/**
 * Sets a shape element's fill — literal, token or gradient. Restricted to
 * shape because it is the only element type with a required, always-visible
 * fill; a ui box node's or a chart's own fill go through `update_element`'s
 * patch or their own dedicated operation instead, since neither is a
 * standalone element.
 */
function setFill(
  document: CreativeDocument,
  sceneId: string,
  elementId: string,
  fill: ColorValue,
): CreativeOperationResult {
  const element = findElement(document, sceneId, elementId);
  if (!element) {
    return { ok: false, error: { code: "not_found", message: `Element ${elementId} was not found.` } };
  }
  if (element.type !== "shape") {
    return { ok: false, error: { code: "invalid_operation", message: `Element ${elementId} is not a shape; only a shape element has a fill.` } };
  }
  return updateElement(document, sceneId, elementId, {
    fill,
    ...(fill.kind === "gradient" ? {} : { gradientAnimation: undefined }),
  } as Partial<CreativeElement>);
}

function setConnector(
  document: CreativeDocument,
  operation: Extract<CreativeTransactionOperation, { type: "set_connector" }>,
): CreativeOperationResult {
  const element = findElement(document, operation.sceneId, operation.elementId);
  if (!element) return { ok: false, error: { code: "not_found", message: `Element ${operation.elementId} was not found.` } };
  if (element.type !== "connector") {
    return { ok: false, error: { code: "invalid_operation", message: `Element ${operation.elementId} is not a connector.` } };
  }
  return updateElement(document, operation.sceneId, operation.elementId, {
    ...(operation.fromElementId !== undefined ? { fromElementId: operation.fromElementId } : {}),
    ...(operation.toElementId !== undefined ? { toElementId: operation.toElementId } : {}),
    ...(operation.curve !== undefined ? { curve: operation.curve } : {}),
    ...(operation.stroke !== undefined ? { stroke: operation.stroke } : {}),
    ...(operation.drawProgress !== undefined ? { drawProgress: operation.drawProgress } : {}),
  } as Partial<CreativeElement>);
}

function setGradientAnimation(
  document: CreativeDocument,
  sceneId: string,
  elementId: string,
  animation?: CreativeGradientAnimation,
): CreativeOperationResult {
  const element = findElement(document, sceneId, elementId);
  if (!element) return { ok: false, error: { code: "not_found", message: `Element ${elementId} was not found.` } };
  if (element.type !== "shape" || element.fill.kind !== "gradient") {
    return { ok: false, error: { code: "invalid_operation", message: `Element ${elementId} must be a shape with a gradient fill.` } };
  }
  return updateElement(document, sceneId, elementId, { gradientAnimation: animation } as Partial<CreativeElement>);
}

/**
 * Sets or clears a shape element's outline morph. Restricted to shape, the
 * only element type with an outline to morph - set_fill and
 * set_gradient_animation apply the same restriction for the same reason.
 * Omitting morph clears it, the same rule set_glass/set_mask/set_counter
 * already follow, so an author stops a morph without resending the rest of
 * the element; a cleared shape renders exactly as it did before this field
 * existed.
 */
function setShapeMorph(
  document: CreativeDocument,
  sceneId: string,
  elementId: string,
  morph?: CreativeShapeMorph,
): CreativeOperationResult {
  const element = findElement(document, sceneId, elementId);
  if (!element) return { ok: false, error: { code: "not_found", message: `Element ${elementId} was not found.` } };
  if (element.type !== "shape") {
    return { ok: false, error: { code: "invalid_operation", message: `Element ${elementId} is not a shape; only a shape element has an outline to morph.` } };
  }
  return updateElement(document, sceneId, elementId, { morph } as Partial<CreativeElement>);
}

/**
 * Replaces a chart's data, bounds, draw/fill progress defaults and base
 * styling in one call, so an agent iterating on a chart's numbers does not
 * have to resend the rest of the element.
 */
function setChartData(
  document: CreativeDocument,
  operation: Extract<CreativeTransactionOperation, { type: "set_chart_data" }>,
): CreativeOperationResult {
  const element = findElement(document, operation.sceneId, operation.elementId);
  if (!element) {
    return { ok: false, error: { code: "not_found", message: `Element ${operation.elementId} was not found.` } };
  }
  if (element.type !== "chart") {
    return { ok: false, error: { code: "invalid_operation", message: `Element ${operation.elementId} is not a chart.` } };
  }
  return updateElement(document, operation.sceneId, operation.elementId, {
    chartKind: operation.chartKind,
    series: operation.series,
    axisMin: operation.axisMin,
    axisMax: operation.axisMax,
    drawProgress: operation.drawProgress,
    fillProgress: operation.fillProgress,
    staggerPoints: operation.staggerPoints,
    stroke: operation.stroke,
    fill: operation.fill,
  } as Partial<CreativeElement>);
}

/**
 * Sets a chart's axes, callouts and label typography in one call.
 *
 * Separate from set_chart_data because the two change on different rhythms: an
 * agent iterating on numbers should not have to resend the axis configuration,
 * and one adjusting presentation should not have to resend the series.
 *
 * Passing a field explicitly as null clears it, which is how an author removes
 * axes they previously added; omitting it leaves it alone.
 */
function setChartAxes(
  document: CreativeDocument,
  operation: Extract<CreativeTransactionOperation, { type: "set_chart_axes" }>,
): CreativeOperationResult {
  const element = findElement(document, operation.sceneId, operation.elementId);
  if (!element) {
    return { ok: false, error: { code: "not_found", message: `Element ${operation.elementId} was not found.` } };
  }
  if (element.type !== "chart") {
    return { ok: false, error: { code: "invalid_operation", message: `Element ${operation.elementId} is not a chart.` } };
  }
  const patch: Record<string, unknown> = {};
  if ("axes" in operation) patch.axes = operation.axes;
  if ("callouts" in operation) patch.callouts = operation.callouts;
  if ("labelStyle" in operation) patch.labelStyle = operation.labelStyle;
  return updateElement(document, operation.sceneId, operation.elementId, patch as Partial<CreativeElement>);
}

/**
 * Calls out one chart point by its series index, or clears its emphasis when
 * neither scale nor color is given - addressing a generated point without it
 * ever being a stored object of its own.
 */
function setChartPointEmphasis(
  document: CreativeDocument,
  operation: Extract<CreativeTransactionOperation, { type: "set_chart_point_emphasis" }>,
): CreativeOperationResult {
  const element = findElement(document, operation.sceneId, operation.elementId);
  if (!element) {
    return { ok: false, error: { code: "not_found", message: `Element ${operation.elementId} was not found.` } };
  }
  if (element.type !== "chart") {
    return { ok: false, error: { code: "invalid_operation", message: `Element ${operation.elementId} is not a chart.` } };
  }
  const existing = (element.pointEmphasis ?? []).filter((entry) => entry.index !== operation.index);
  const next =
    operation.scale === undefined && operation.color === undefined
      ? existing
      : [...existing, { index: operation.index, scale: operation.scale, color: operation.color }];
  return updateElement(document, operation.sceneId, operation.elementId, {
    pointEmphasis: next.length ? next : undefined,
  } as Partial<CreativeElement>);
}

type FoundVideoClip =
  | { ok: true; scene: CreativeScene; element: CreativeVideoElement }
  | { ok: false; message: string };

/** Resolves the scene and video clip a clip operation targets. */
function findVideoClip(document: CreativeDocument, sceneId: string, elementId: string): FoundVideoClip {
  const scene = document.scenes.find((item) => item.id === sceneId);
  if (!scene) return { ok: false, message: `Scene ${sceneId} was not found.` };
  const element = scene.elements.find((item) => item.id === elementId);
  if (!element) return { ok: false, message: `Element ${elementId} was not found.` };
  if (element.type !== "video") return { ok: false, message: `Element ${elementId} is not a video clip.` };
  return { ok: true, scene, element };
}

/**
 * Runs one clip edit and writes the result back into the scene.
 *
 * A split yields two clips, so the edited element is replaced in place and
 * the new half is inserted directly after it, keeping cut order on the
 * timeline the same as document order.
 */
function applyClipEdit(
  document: CreativeDocument,
  sceneId: string,
  elementId: string,
  edit: (clip: CreativeVideoElement, sceneDurationMs: number) => CreativeElement[],
): CreativeOperationResult {
  const found = findVideoClip(document, sceneId, elementId);
  if (!found.ok) {
    return { ok: false, error: { code: "not_found", message: found.message } };
  }
  let replacements: CreativeElement[];
  try {
    replacements = edit(found.element, found.scene.durationMs);
  } catch (error) {
    return {
      ok: false,
      error: { code: "invalid_operation", message: error instanceof Error ? error.message : String(error) },
    };
  }
  const scenePosition = document.scenes.indexOf(found.scene);
  const elementPosition = found.scene.elements.indexOf(found.element);
  const elements = [...found.scene.elements];
  elements.splice(elementPosition, 1, ...replacements);
  const scenes = [...document.scenes];
  scenes[scenePosition] = { ...found.scene, elements };
  return { ok: true, document: { ...document, scenes } };
}

function applyOne(document: CreativeDocument, operation: CreativeTransactionOperation): CreativeOperationResult {
  switch (operation.type) {
    case "set_canvas":
      return setCanvas(document, operation);
    case "set_project_scratchpad":
      return { ok: true, document: { ...document, metadata: { ...(document.metadata ?? {}), scratchpad: operation.scratchpad } } };
    case "set_asset_alias":
      try { return { ok: true, document: setCreativeAssetAlias(document, operation.alias, operation.assetId) }; }
      catch (error) { return { ok: false, error: { code: "invalid_operation", message: error instanceof Error ? error.message : String(error) } }; }
    case "set_project_attachment":
      try { return { ok: true, document: setCreativeProjectAttachment(document, operation.attachment) }; }
      catch (error) { return { ok: false, error: { code: "invalid_operation", message: error instanceof Error ? error.message : String(error) } }; }
    case "remove_project_attachment":
      try { return { ok: true, document: removeCreativeProjectAttachment(document, operation.attachmentId) }; }
      catch (error) { return { ok: false, error: { code: "invalid_operation", message: error instanceof Error ? error.message : String(error) } }; }
    case "add_composition_template":
      try { return addScene(document, buildCompositionTemplateScene(document, operation.template, operation.sceneId, operation.durationMs), operation.index); }
      catch (error) { return { ok: false, error: { code: "invalid_operation", message: error instanceof Error ? error.message : String(error) } }; }
    case "normalize_timeline_duration": {
      if (!Number.isFinite(operation.targetMs) || operation.targetMs <= 0) return { ok: false, error: { code: "invalid_operation", message: "targetMs must be positive." } };
      const current = getCreativeDurationMs(document);
      const delta = operation.targetMs - current;
      const targetIndex = operation.sceneId
        ? document.scenes.findIndex((scene) => scene.id === operation.sceneId)
        : document.scenes.length - 1;
      if (targetIndex < 0) return { ok: false, error: { code: "not_found", message: `Scene ${operation.sceneId} was not found.` } };
      const scene = document.scenes[targetIndex];
      const durationMs = Math.round(scene.durationMs + delta);
      if (durationMs <= 0) return { ok: false, error: { code: "invalid_operation", message: `Normalizing to ${operation.targetMs}ms would make ${scene.id} non-positive.` } };
      const scenes = [...document.scenes];
      scenes[targetIndex] = { ...scene, durationMs };
      return { ok: true, document: { ...document, scenes } };
    }
    case "add_element":
      return addElement(document, operation.sceneId, operation.element, operation.index);
    case "update_element":
      return updateTransactionElement(document, operation.sceneId, operation.elementId, operation.patch);
    case "update_elements":
      return updateElements(document, operation);
    case "remove_element":
      return removeElement(document, operation.sceneId, operation.elementId);
    case "reorder_element":
      return reorderElement(document, operation.sceneId, operation.elementId, operation.toIndex);
    case "move_element":
      return patchTransform(document, operation.sceneId, operation.elementId, { x: operation.x, y: operation.y });
    case "resize_element":
      return patchTransform(document, operation.sceneId, operation.elementId, { width: operation.width, height: operation.height });
    case "set_text":
      return setText(document, operation.sceneId, operation.elementId, operation.text);
    case "set_hidden":
      return updateElement(document, operation.sceneId, operation.elementId, { hidden: operation.hidden });
    case "set_locked":
      return updateElement(document, operation.sceneId, operation.elementId, { locked: operation.locked });
    case "set_timing":
      return setElementTiming(document, operation.sceneId, operation.elementId, operation.timing);
    case "set_animation":
      return setElementAnimations(document, operation.sceneId, operation.elementId, operation.animations);
    case "apply_motion_preset":
      return applyMotionPreset(document, operation.sceneId, operation.elementId, operation.presetName, operation.startMs);
    case "stagger_group": {
      const result = applyGroupStagger(document, operation);
      return result.ok ? { ok: true, document: result.document } : { ok: false, error: { code: result.code, message: result.message } };
    }
    case "orbit_group": {
      const result = applyOrbitGroup(document, operation);
      return result.ok ? { ok: true, document: result.document } : { ok: false, error: { code: result.code, message: result.message } };
    }
    case "explode_text": {
      const result = explodeTextElement(document, operation);
      return result.ok ? { ok: true, document: result.document } : { ok: false, error: { code: result.code, message: result.message } };
    }
    case "add_scene":
      return addScene(document, operation.scene, operation.index);
    case "update_scene":
      return updateScene(document, operation.sceneId, operation.patch);
    case "remove_scene":
      return removeScene(document, operation.sceneId);
    case "reorder_scene":
      return reorderScene(document, operation.sceneId, operation.toIndex);
    case "set_scene_camera":
      return setSceneCamera(document, operation.sceneId, operation.camera);
    case "continue_element":
      return setContinuation(document, operation.continuation);
    case "continue_group":
      return setGroupContinuation(document, operation.continuation);
    case "remove_group_continuation":
      return removeGroupContinuation(document, operation.continuationId);
    case "remove_continuation":
      return removeContinuation(document, operation.continuationId);
    case "set_group_transform":
      return setGroupTransform(
        document,
        operation.sceneId,
        operation.groupId,
        operation.transform,
        operation.animations,
      );
    case "set_transition":
      return setSceneTransition(document, operation.sceneId, operation.transition);
    case "create_group":
      return createGroup(document, operation.sceneId, operation.group);
    case "update_group":
      return updateGroup(document, operation.sceneId, operation.groupId, operation.patch);
    case "ungroup":
      return ungroup(document, operation.sceneId, operation.groupId);
    case "split_clip":
      return applyClipEdit(document, operation.sceneId, operation.elementId, (clip, sceneMs) => {
        const { left, right } = splitVideoClip(clip, sceneMs, operation.atMs);
        return [left, right];
      });
    case "trim_clip":
      return applyClipEdit(document, operation.sceneId, operation.elementId, (clip, sceneMs) => [
        trimVideoClip(clip, sceneMs, { startMs: operation.startMs, endMs: operation.endMs }),
      ]);
    case "slip_clip":
      return applyClipEdit(document, operation.sceneId, operation.elementId, (clip, sceneMs) => [
        slipVideoClip(clip, sceneMs, operation.byMs),
      ]);
    case "set_clip_speed":
      return applyClipEdit(document, operation.sceneId, operation.elementId, (clip, sceneMs) => [
        setVideoClipSpeed(clip, sceneMs, operation.speed, operation.mode ?? "hold_source"),
      ]);
    case "freeze_clip":
      return applyClipEdit(document, operation.sceneId, operation.elementId, (clip, sceneMs) => [
        freezeVideoClip(clip, sceneMs, operation.atMs),
      ]);
    case "duplicate_clip":
      return applyClipEdit(document, operation.sceneId, operation.elementId, (clip, sceneMs) => [
        clip,
        duplicateVideoClip(clip, sceneMs, operation.atMs),
      ]);
    case "apply_text_animation":
      return operation.childId
        ? setCompositeChildTextProperty(document, operation.sceneId, operation.elementId, operation.childId, { animation: operation.animation })
        : setTextProperty(document, operation.sceneId, operation.elementId, { animation: operation.animation });
    case "animate_ui_node":
      return patchUiNode(document, operation.sceneId, operation.elementId, operation.nodeId, (node) => ({
        ...node,
        animations: operation.animations.map((a) => ({ ...a, keyframes: a.keyframes.map((k) => ({ ...k })) })),
      }));
    case "set_ui_node_timing":
      return patchUiNode(document, operation.sceneId, operation.elementId, operation.nodeId, (node) => ({
        ...node,
        timing: operation.timing ? { ...operation.timing } : undefined,
      }));
    case "move_ui_node":
      return patchUiNode(document, operation.sceneId, operation.elementId, operation.nodeId, (node) => ({
        ...node,
        frame: { ...node.frame, x: operation.x, y: operation.y },
      }));
    case "resize_ui_node":
      return patchUiNode(document, operation.sceneId, operation.elementId, operation.nodeId, (node) => ({
        ...node,
        frame: { ...node.frame, width: operation.width, height: operation.height },
      }));
    case "set_text_fit":
      return setTextProperty(document, operation.sceneId, operation.elementId, { fit: operation.fit });
    case "set_counter":
      // Omitting counter clears it, the same rule set_glass and set_mask
      // follow, so an author stops a count-up without resending the text.
      return setTextProperty(document, operation.sceneId, operation.elementId, { counter: operation.counter });
    case "set_adjustments":
      return updateElement(document, operation.sceneId, operation.elementId, {
        adjustments: operation.adjustments,
      } as Partial<CreativeElement>);
    case "add_audio_clip":
      return editAudioClips(document, (clips) =>
        clips.some((clip) => clip.id === operation.clip.id)
          ? { error: `Audio clip ${operation.clip.id} already exists.` }
          : [...clips, JSON.parse(JSON.stringify(operation.clip)) as CreativeAudioClip],
      );
    case "update_audio_clip":
      return editAudioClips(document, (clips) => {
        const index = clips.findIndex((clip) => clip.id === operation.clipId);
        if (index < 0) return { error: `Audio clip ${operation.clipId} was not found.` };
        const next = [...clips];
        next[index] = { ...next[index], ...operation.patch, id: next[index].id };
        return next;
      });
    case "remove_audio_clip":
      return editAudioClips(document, (clips) => {
        const next = clips.filter((clip) => clip.id !== operation.clipId);
        return next.length === clips.length
          ? { error: `Audio clip ${operation.clipId} was not found.` }
          : next;
      });
    case "set_clip_speed_ramp":
      return applyClipEdit(document, operation.sceneId, operation.elementId, (clip) => [
        { ...clip, speedRamp: operation.speedRamp },
      ]);
    case "set_mask":
      return updateElement(document, operation.sceneId, operation.elementId, {
        mask: operation.mask,
      } as Partial<CreativeElement>);
    case "set_motion_blur":
      return updateElement(document, operation.sceneId, operation.elementId, {
        motionBlur: operation.motionBlur,
      } as Partial<CreativeElement>);
    case "set_fill":
      return setFill(document, operation.sceneId, operation.elementId, operation.fill);
    case "set_gradient_animation":
      return setGradientAnimation(document, operation.sceneId, operation.elementId, operation.animation);
    case "set_shape_morph":
      return setShapeMorph(document, operation.sceneId, operation.elementId, operation.morph);
    case "set_connector":
      return setConnector(document, operation);
    case "set_blend_mode":
      return updateElement(document, operation.sceneId, operation.elementId, {
        blendMode: operation.blendMode,
      } as Partial<CreativeElement>);
    case "set_chart_data":
      return setChartData(document, operation);
    case "set_chart_axes":
      return setChartAxes(document, operation);
    case "set_glass":
      // Omitting glass clears it, which is how a panel stops being glass
      // without the author having to resend the rest of the element.
      return updateElement(document, operation.sceneId, operation.elementId, {
        glass: operation.glass,
      } as Partial<CreativeElement>);
    case "set_chart_point_emphasis":
      return setChartPointEmphasis(document, operation);
    case "add_marker": {
      const markers = [...(document.markers ?? [])];
      if (markers.some((marker) => marker.id === operation.marker.id)) {
        return { ok: false, error: { code: "duplicate_id", message: `Marker ${operation.marker.id} already exists.` } };
      }
      markers.push({ ...operation.marker });
      markers.sort((a, b) => a.timeMs - b.timeMs);
      return { ok: true, document: { ...document, markers } };
    }
    case "remove_marker": {
      const markers = (document.markers ?? []).filter((marker) => marker.id !== operation.markerId);
      if (markers.length === (document.markers ?? []).length) {
        return { ok: false, error: { code: "not_found", message: `Marker ${operation.markerId} was not found.` } };
      }
      return { ok: true, document: { ...document, markers } };
    }
    case "set_design_token":
      return setDesignToken(document, operation);
  }
}

export function applyCreativeTransaction(
  document: CreativeDocument,
  transaction: CreativeTransaction,
): CreativeTransactionResult {
  if (!transaction.summary.trim()) {
    return { ok: false, document, error: { code: "invalid_transaction", message: "Transaction summary is required." } };
  }
  if (transaction.operations.length === 0) {
    return { ok: false, document, error: { code: "invalid_transaction", message: "Transaction must contain at least one operation." } };
  }

  let candidate = document;
  let unresolvedInvalidRunStartIndex: number | undefined;
  for (let index = 0; index < transaction.operations.length; index += 1) {
    const result = applyOne(candidate, transaction.operations[index]);
    if (!result.ok) {
      if (result.document) {
        candidate = result.document;
        if (unresolvedInvalidRunStartIndex === undefined) unresolvedInvalidRunStartIndex = index;
        continue;
      }
      return {
        ok: false,
        document,
        error: { code: result.error.code, message: result.error.message, operationIndex: index },
      };
    }
    candidate = result.document;
    unresolvedInvalidRunStartIndex = undefined;
  }

  const validation = validateCreativeDocument(candidate);
  if (!validation.valid) {
    const issue = validation.issues[0];
    return {
      ok: false,
      document,
      error: {
        code: issue?.code ?? "invalid_document",
        message: issue ? `${issue.path}: ${issue.message}` : "Transaction produced an invalid document.",
        operationIndex: unresolvedInvalidRunStartIndex,
      },
    };
  }

  return {
    ok: true,
    document: candidate,
    summary: transaction.summary.trim(),
    operationCount: transaction.operations.length,
  };
}
