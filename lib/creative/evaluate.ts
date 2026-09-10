import type {
  AnimationKeyframe,
  ColorGradient,
  ColorValue,
  CreativeAdjustments,
  CreativeDesignSystem,
  CreativeGradientAnimation,
  FlatColorValue,
  GradientColorKeyframe,
  CreativeDocument,
  CreativeElement,
  CreativeScene,
  CreativeTransform,
  EasingSpec,
  ElementAnimation,
  TextStyleRef,
  TextStyleToken,
} from "./schema";
import {
  blendContinuedTransform,
  continuationProgress,
  findContinuationInto,
  findGroupChildMorphSource,
  isHeldBackByGroupContinuation,
} from "./continuation";
import { resolveGradientCss } from "./gradient";

export interface EvaluatedTransform extends CreativeTransform {
  scaleX: number;
  scaleY: number;
}

/** Normalized crop window resolved at a point in time, when animated. */
export interface EvaluatedCrop {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface EvaluatedElement {
  element: CreativeElement;
  transform: EvaluatedTransform;
  /** Present only when the element animates its crop. */
  crop?: EvaluatedCrop;
  /**
   * The element's adjustments with any animated values folded in. Renderers
   * must read this rather than `element.adjustments`, or an animated blur
   * renders as the static value it started from.
   */
  adjustments?: CreativeAdjustments;
  /**
   * Chart elements only, always resolved when present: how much of the
   * line/bars (drawProgress) and, for an area chart, the fill
   * (fillProgress) are revealed, 0..1. fillProgress mirrors the resolved
   * drawProgress unless the element or an animation sets it independently.
   */
  drawProgress?: number;
  fillProgress?: number;
  /** Shape fill after gradient animation has been resolved to CSS. */
  resolvedFill?: string;
}

export interface EvaluatedScene {
  scene: CreativeScene;
  timeMs: number;
  background: string;
  elements: EvaluatedElement[];
}

export interface ResolvedTextStyle extends Omit<TextStyleToken, "color"> {
  color: string;
}

const clamp01 = (value: number) => Math.min(1, Math.max(0, value));

export function resolveColor(designSystem: CreativeDesignSystem, color: ColorValue): string {
  if (color.kind === "literal") return color.value;
  // The single choke point every consumer of a colour goes through, so
  // teaching it to resolve a gradient is enough for every existing background
  // and fill call site to render one with no change of its own. Validation is
  // what keeps a gradient out of the call sites that cannot use it — a plain
  // CSS `color` or a border shorthand string — never this function.
  if (color.kind === "gradient") return resolveGradientCss(designSystem, color.gradient);
  const resolved = designSystem.colors[color.token];
  if (!resolved) throw new Error(`Unknown creative color token: ${color.token}`);
  return resolved;
}

interface RgbaColor { r: number; g: number; b: number; a: number }

function parseCssColor(value: string): RgbaColor | null {
  const input = value.trim();
  if (input === "transparent") return { r: 0, g: 0, b: 0, a: 0 };
  if (input.startsWith("#")) {
    const hex = input.slice(1);
    if (hex.length === 3) {
      return {
        r: parseInt(hex[0] + hex[0], 16),
        g: parseInt(hex[1] + hex[1], 16),
        b: parseInt(hex[2] + hex[2], 16),
        a: 1,
      };
    }
    if (hex.length === 6 || hex.length === 8) {
      return {
        r: parseInt(hex.slice(0, 2), 16),
        g: parseInt(hex.slice(2, 4), 16),
        b: parseInt(hex.slice(4, 6), 16),
        a: hex.length === 8 ? parseInt(hex.slice(6, 8), 16) / 255 : 1,
      };
    }
  }
  const rgb = input.match(/^rgba?\(([^)]+)\)$/i);
  if (!rgb) return null;
  const parts = rgb[1].split(",").map((part) => Number(part.trim()));
  if (parts.length < 3 || parts.slice(0, 3).some((part) => !Number.isFinite(part))) return null;
  const alpha = parts[3] === undefined ? 1 : parts[3];
  if (!Number.isFinite(alpha)) return null;
  return {
    r: Math.min(255, Math.max(0, parts[0])),
    g: Math.min(255, Math.max(0, parts[1])),
    b: Math.min(255, Math.max(0, parts[2])),
    a: clamp01(alpha),
  };
}

function rgbaCss(color: RgbaColor): string {
  return `rgba(${Math.round(color.r)}, ${Math.round(color.g)}, ${Math.round(color.b)}, ${Math.round(clamp01(color.a) * 10000) / 10000})`;
}

function resolveFlatColor(designSystem: CreativeDesignSystem, color: FlatColorValue): string {
  if (color.kind === "literal") return color.value;
  const resolved = designSystem.colors[color.token];
  if (!resolved) throw new Error(`Unknown creative color token: ${color.token}`);
  return resolved;
}

function sampleGradientColor(
  designSystem: CreativeDesignSystem,
  keyframes: GradientColorKeyframe[],
  timeMs: number,
): FlatColorValue {
  if (timeMs <= keyframes[0].timeMs) return keyframes[0].color;
  const last = keyframes[keyframes.length - 1];
  if (timeMs >= last.timeMs) return last.color;
  for (let index = 0; index < keyframes.length - 1; index += 1) {
    const from = keyframes[index];
    const to = keyframes[index + 1];
    if (timeMs > to.timeMs) continue;
    const raw = (timeMs - from.timeMs) / (to.timeMs - from.timeMs);
    const progress = applyCreativeEasing(from.easing, raw);
    const fromParsed = parseCssColor(resolveFlatColor(designSystem, from.color));
    const toParsed = parseCssColor(resolveFlatColor(designSystem, to.color));
    if (!fromParsed || !toParsed) return progress < 0.5 ? from.color : to.color;
    return {
      kind: "literal",
      value: rgbaCss({
        r: fromParsed.r + (toParsed.r - fromParsed.r) * progress,
        g: fromParsed.g + (toParsed.g - fromParsed.g) * progress,
        b: fromParsed.b + (toParsed.b - fromParsed.b) * progress,
        a: fromParsed.a + (toParsed.a - fromParsed.a) * progress,
      }),
    };
  }
  return last.color;
}

function sampleGradientNumber(keyframes: AnimationKeyframe[] | undefined, timeMs: number): number | undefined {
  if (!keyframes?.length) return undefined;
  return evaluateAnimation({ id: "gradient", property: "x", keyframes }, timeMs);
}

function resolveAnimatedGradientFill(
  designSystem: CreativeDesignSystem,
  gradient: ColorGradient,
  animation: CreativeGradientAnimation,
  timeMs: number,
): string {
  const next: ColorGradient = { ...gradient, stops: gradient.stops.map((stop) => ({ ...stop })) };
  const angle = sampleGradientNumber(animation.angle, timeMs);
  const centerX = sampleGradientNumber(animation.centerX, timeMs);
  const centerY = sampleGradientNumber(animation.centerY, timeMs);
  if (angle !== undefined) next.angle = angle;
  if (centerX !== undefined) next.centerX = clamp01(centerX);
  if (centerY !== undefined) next.centerY = clamp01(centerY);
  for (const stopAnimation of animation.stops ?? []) {
    const stop = next.stops[stopAnimation.stopIndex];
    if (!stop) continue;
    const offset = sampleGradientNumber(stopAnimation.offset, timeMs);
    if (offset !== undefined) stop.offset = clamp01(offset);
    if (stopAnimation.colorKeyframes?.length) stop.color = sampleGradientColor(designSystem, stopAnimation.colorKeyframes, timeMs);
  }
  return resolveGradientCss(designSystem, next);
}

export function resolveTextStyle(
  designSystem: CreativeDesignSystem,
  ref: TextStyleRef,
): ResolvedTextStyle {
  const base = designSystem.typography[ref.token];
  if (!base) throw new Error(`Unknown creative typography token: ${ref.token}`);
  const merged: TextStyleToken = { ...base, ...(ref.overrides ?? {}) };
  return { ...merged, color: resolveColor(designSystem, merged.color) };
}

/**
 * Solves a cubic-bezier curve for y at a given x.
 *
 * The curve is defined by its two control points; P0 is (0,0) and P3 is
 * (1,1), exactly as CSS defines it. x is found by Newton-Raphson with a
 * bisection fallback, because the x(t) curve is monotonic but not
 * analytically invertible.
 */
function solveCubicBezier(x1: number, y1: number, x2: number, y2: number, x: number): number {
  const cx = 3 * x1;
  const bx = 3 * (x2 - x1) - cx;
  const ax = 1 - cx - bx;
  const cy = 3 * y1;
  const by = 3 * (y2 - y1) - cy;
  const ay = 1 - cy - by;

  const sampleX = (t: number) => ((ax * t + bx) * t + cx) * t;
  const sampleY = (t: number) => ((ay * t + by) * t + cy) * t;
  const slopeX = (t: number) => (3 * ax * t + 2 * bx) * t + cx;

  let t = x;
  for (let i = 0; i < 8; i += 1) {
    const currentX = sampleX(t) - x;
    if (Math.abs(currentX) < 1e-6) return sampleY(t);
    const slope = slopeX(t);
    if (Math.abs(slope) < 1e-6) break;
    t -= currentX / slope;
  }

  let low = 0;
  let high = 1;
  t = x;
  for (let i = 0; i < 24; i += 1) {
    const currentX = sampleX(t);
    if (Math.abs(currentX - x) < 1e-6) break;
    if (currentX < x) low = t;
    else high = t;
    t = (low + high) / 2;
  }
  return sampleY(t);
}

export function applyCreativeEasing(easing: EasingSpec, progress: number): number {
  const t = clamp01(progress);
  if (typeof easing !== "string") {
    return solveCubicBezier(
      clamp01(easing.x1),
      easing.y1,
      clamp01(easing.x2),
      easing.y2,
      t,
    );
  }
  switch (easing) {
    case "linear":
      return t;
    case "ease-in":
      return t * t;
    case "ease-out":
      return 1 - (1 - t) * (1 - t);
    case "ease-in-out":
      return t < 0.5 ? 2 * t * t : 1 - Math.pow(-2 * t + 2, 2) / 2;
    case "spring-soft": {
      const damped = 1 - Math.exp(-5 * t) * Math.cos(6 * t);
      return clamp01(damped);
    }
    case "spring-snappy": {
      const damped = 1 - Math.exp(-8 * t) * Math.cos(9 * t);
      return clamp01(damped);
    }
  }
}

/**
 * Exported so group and camera transforms animate through the same keyframe
 * and easing code elements do. Two samplers would be two ways for the same
 * curve to be interpreted.
 */
export function evaluateAnimation(animation: ElementAnimation, timeMs: number): number {
  const frames = animation.keyframes;
  if (timeMs <= frames[0].timeMs) return frames[0].value;
  const last = frames[frames.length - 1];
  if (timeMs >= last.timeMs) return last.value;

  for (let index = 0; index < frames.length - 1; index += 1) {
    const from = frames[index];
    const to = frames[index + 1];
    if (timeMs > to.timeMs) continue;
    const raw = (timeMs - from.timeMs) / (to.timeMs - from.timeMs);
    const eased = applyCreativeEasing(from.easing, raw);
    return from.value + (to.value - from.value) * eased;
  }

  return last.value;
}

function baseTransform(transform: CreativeTransform): EvaluatedTransform {
  return { ...transform, z: transform.z ?? 0, rotationX: transform.rotationX ?? 0, rotationY: transform.rotationY ?? 0, scaleX: 1, scaleY: 1 };
}

export function evaluateElementAtTime(
  document: CreativeDocument,
  scene: CreativeScene,
  element: CreativeElement,
  timeMs: number,
  /**
   * Guards the one-hop lookup a continuation makes into the previous scene.
   * An element that continues *from* an element that itself continues would
   * otherwise recurse; the source is evaluated as itself, which is what it
   * looks like on screen at that moment anyway.
   */
  followContinuations = true,
): EvaluatedElement | null {
  if (element.hidden) return null;
  if (timeMs < 0 || timeMs >= scene.durationMs) return null;
  if (element.timing && (timeMs < element.timing.startMs || timeMs >= element.timing.endMs)) {
    return null;
  }
  // A child of a continuing group with no mapped counterpart has nothing to
  // hand off from. Showing it during the handoff puts it on screen beside the
  // element it replaces — two labels legible at once, which is the doubling a
  // group continuation exists to remove.
  if (followContinuations && isHeldBackByGroupContinuation(document, scene, element.id, timeMs)) {
    return null;
  }

  const transform = baseTransform(element.transform);
  // Copied lazily: an element that never animates its grade keeps the exact
  // object it was authored with, so nothing downstream sees a spurious change.
  let adjustments: CreativeAdjustments | undefined = undefined;
  const adjustmentsAt = (): CreativeAdjustments =>
    (adjustments ??= element.adjustments ? { ...element.adjustments } : {});
  const baseCrop =
    element.type === "image" || element.type === "video" ? element.crop : undefined;
  let crop: EvaluatedCrop | undefined = undefined;
  const cropAt = (): EvaluatedCrop =>
    (crop ??= baseCrop ? { ...baseCrop } : { x: 0, y: 0, width: 1, height: 1 });
  let drawProgress: number | undefined = undefined;
  let fillProgress: number | undefined = undefined;

  for (const animation of element.animations ?? []) {
    const value = evaluateAnimation(animation, timeMs);
    switch (animation.property) {
      case "cropX":
        cropAt().x = clamp01(value);
        break;
      case "cropY":
        cropAt().y = clamp01(value);
        break;
      case "cropWidth":
        cropAt().width = Math.max(0.0001, Math.min(1, value));
        break;
      case "cropHeight":
        cropAt().height = Math.max(0.0001, Math.min(1, value));
        break;
      case "x":
        transform.x = value;
        break;
      case "y":
        transform.y = value;
        break;
      case "rotation":
        transform.rotation = value;
        break;
      case "z":
        transform.z = value;
        break;
      case "rotationX":
        transform.rotationX = value;
        break;
      case "rotationY":
        transform.rotationY = value;
        break;
      case "opacity":
        transform.opacity = clamp01(value);
        break;
      case "scaleX":
        transform.scaleX = Math.max(0, value);
        break;
      case "scaleY":
        transform.scaleY = Math.max(0, value);
        break;
      case "blurPx":
        adjustmentsAt().blurPx = Math.max(0, value);
        break;
      case "drawProgress":
        drawProgress = clamp01(value);
        break;
      case "fillProgress":
        fillProgress = clamp01(value);
        break;
    }
  }

  // Connector geometry is semantic and scene-relative, not an authored box.
  // Normalizing it here keeps both renderers on the ordinary element wrapper.
  if (element.type === "connector") {
    transform.x = 0;
    transform.y = 0;
    transform.width = document.canvas.width;
    transform.height = document.canvas.height;
    transform.rotation = 0;
    transform.anchorX = 0.5;
    transform.anchorY = 0.5;
    transform.scaleX = 1;
    transform.scaleY = 1;
  }

  // A continued element enters exactly where its predecessor finished and
  // travels to its own position over the head of this scene, so the eye tracks
  // one object through the cut rather than seeing two compositions swapped.
  const resolvedAdjustments = adjustments ?? element.adjustments;
  const resolvedFill =
    element.type === "shape"
      ? element.fill.kind === "gradient" && element.gradientAnimation
        ? resolveAnimatedGradientFill(document.designSystem, element.fill.gradient, element.gradientAnimation, timeMs)
        : resolveColor(document.designSystem, element.fill)
      : undefined;
  // Always resolved for a chart, animated or not, so a renderer never has to
  // know that an unset drawProgress means "fully drawn" - that default lives
  // here, once. fillProgress falls back to the already-resolved drawProgress,
  // not to the element's raw field, so it mirrors whatever the line actually
  // ended up doing, animated or default alike, unless set independently.
  const resolvedDrawProgress =
    element.type === "chart" || element.type === "connector"
      ? drawProgress ?? element.drawProgress ?? 1
      : undefined;
  const resolvedFillProgress =
    element.type === "chart" ? fillProgress ?? element.fillProgress ?? resolvedDrawProgress : undefined;
  const progressFields = {
    ...(resolvedDrawProgress !== undefined ? { drawProgress: resolvedDrawProgress } : {}),
    ...(resolvedFillProgress !== undefined ? { fillProgress: resolvedFillProgress } : {}),
  };

  if (followContinuations) {
    const continued = applyContinuation(document, scene, element, timeMs, transform);
    if (continued) {
      return {
        element,
        transform: continued,
        ...(crop ? { crop } : {}),
        ...(resolvedAdjustments ? { adjustments: resolvedAdjustments } : {}),
        ...(resolvedFill !== undefined ? { resolvedFill } : {}),
        ...progressFields,
      };
    }
  }

  return {
    element,
    transform,
    ...(crop ? { crop } : {}),
    ...(resolvedAdjustments ? { adjustments: resolvedAdjustments } : {}),
    ...(resolvedFill !== undefined ? { resolvedFill } : {}),
    ...progressFields,
  };
}

/**
 * The incoming element's transform, blended back toward where the outgoing one
 * finished. Returns undefined when this element is not continuing — by either
 * mechanism below — or when this moment is past the handoff.
 */
function applyContinuation(
  document: CreativeDocument,
  scene: CreativeScene,
  element: CreativeElement,
  timeMs: number,
  ownTransform: EvaluatedTransform,
): EvaluatedTransform | undefined {
  const continuation = findContinuationInto(document, scene.id, element.id);
  if (continuation) {
    const progress = continuationProgress(continuation, timeMs);
    if (progress === null) return undefined;
    return blendFromContinuationSource(
      document,
      continuation.fromSceneId,
      continuation.fromElementId,
      ownTransform,
      progress,
    );
  }

  // v2: a group's own childMapping can carry this same per-child blend for a
  // pair that opted into morphGeometry, so an author does not have to
  // hand-author a separate continue_element for every child that should
  // rearrange. An explicit continue_element above always wins when both name
  // the same element — it is the more specific instruction, and running both
  // would be two different answers to "where did this come from" layered on
  // top of each other rather than one.
  const morphing = findGroupChildMorphSource(document, scene, element.id, timeMs);
  if (!morphing) return undefined;
  return blendFromContinuationSource(
    document,
    morphing.fromSceneId,
    morphing.fromElementId,
    ownTransform,
    morphing.progress,
  );
}

/**
 * Evaluate the source element at the end of its own scene and blend the
 * target transform back toward it. The one place "enter where the
 * predecessor finished" happens, shared by continue_element and a v2
 * morphing group child so the two cannot drift into different rules for what
 * is meant to be the same handoff.
 */
function blendFromContinuationSource(
  document: CreativeDocument,
  fromSceneId: string,
  fromElementId: string,
  ownTransform: EvaluatedTransform,
  progress: number,
): EvaluatedTransform | undefined {
  const fromScene = document.scenes.find((candidate) => candidate.id === fromSceneId);
  const fromElement = fromScene?.elements.find((candidate) => candidate.id === fromElementId);
  if (!fromScene || !fromElement) return undefined;

  // Where the source element actually ended, animations and all — not where it
  // was authored. A source that drifts during its scene hands off from where it
  // drifted to.
  const source = evaluateElementAtTime(
    document,
    fromScene,
    fromElement,
    Math.max(0, fromScene.durationMs - 1),
    false,
  );
  if (!source) return undefined;

  return blendContinuedTransform(source.transform, ownTransform, progress);
}

export interface EvaluateElementListOptions {
  /** Ids to skip outright. evaluateSceneAtTime uses this for elements inside a hidden group. */
  hiddenIds?: ReadonlySet<string>;
  /**
   * Off for a composite's children (see evaluateCompositeChildren in
   * composite.ts): continue_element/continue_group resolve a *scene*-level
   * element or group id against scene.elements/scene.groups, which a
   * composite child is never a member of, so there is nothing for a
   * continuation to match there. Defaults to true, unchanged for the scene's
   * own top-level elements.
   */
  followContinuations?: boolean;
}

/**
 * Resolves a flat list of elements at one moment, sorted by their own zIndex
 * among themselves (document order breaking a tie).
 *
 * This is the exact list-then-sort evaluateSceneAtTime already did for a
 * scene's own `elements`, pulled out so a composite's `children` - a second
 * flat list of real elements, just addressed through their owning composite
 * instead of a scene - resolves through the same one function rather than a
 * second copy of the same sort. Composite children are never held back by a
 * hidden *group*, because they are not addressable from scene.groups at all
 * (see the addressing note on CreativeCompositeElement); a hidden composite
 * simply never reaches this function for its children, because the composite
 * element itself was already excluded upstream.
 */
export function evaluateElementList(
  document: CreativeDocument,
  scene: CreativeScene,
  elements: CreativeElement[],
  timeMs: number,
  options: EvaluateElementListOptions = {},
): EvaluatedElement[] {
  const { hiddenIds, followContinuations = true } = options;
  return elements
    .map((element, sourceIndex) => ({
      sourceIndex,
      evaluated: hiddenIds?.has(element.id)
        ? null
        : evaluateElementAtTime(document, scene, element, timeMs, followContinuations),
    }))
    .filter((item): item is { sourceIndex: number; evaluated: EvaluatedElement } => item.evaluated !== null)
    .sort((a, b) => {
      const z = a.evaluated.transform.zIndex - b.evaluated.transform.zIndex;
      return z === 0 ? a.sourceIndex - b.sourceIndex : z;
    })
    .map((item) => item.evaluated);
}

export function evaluateSceneAtTime(
  document: CreativeDocument,
  scene: CreativeScene,
  timeMs: number,
): EvaluatedScene {
  const hiddenGroupElements = new Set(
    scene.groups.filter((group) => group.hidden).flatMap((group) => group.elementIds),
  );

  return {
    scene,
    timeMs,
    background: resolveColor(document.designSystem, scene.background ?? document.canvas.background),
    elements: evaluateElementList(document, scene, scene.elements, timeMs, { hiddenIds: hiddenGroupElements }),
  };
}

export function getCreativeDurationMs(document: CreativeDocument): number {
  return document.scenes.reduce((total, scene, index) => {
    if (index === document.scenes.length - 1) return total + scene.durationMs;
    return total + scene.durationMs - (scene.transitionOut?.durationMs ?? 0);
  }, 0);
}
