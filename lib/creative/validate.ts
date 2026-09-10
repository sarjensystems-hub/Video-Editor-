import {
  ANIMATION_PROPERTIES,
  BLEND_MODES,
  CREATIVE_AUDIO_KINDS,
  CREATIVE_CHART_KINDS,
  CHART_LABEL_FORMATS,
  CONNECTOR_CURVES,
  CREATIVE_CANVAS_MAX_DIMENSION,
  CREATIVE_COMPOSITE_MAX_DEPTH,
  CREATIVE_COMPOSITE_MAX_DESCENDANTS,
  CREATIVE_MARKER_KINDS,
  CREATIVE_MASK_KINDS,
  CREATIVE_UI_MAX_DEPTH,
  CREATIVE_UI_MAX_NODES,
  CREATIVE_UI_MAX_VIEWPORT,
  CREATIVE_UI_NODE_KINDS,
  EASING_NAMES,
  GRADIENT_KINDS,
  TEXT_ANIMATION_GRANULARITIES,
  TEXT_ANIMATION_MODES,
  TEXT_FIT_MODES,
  SCENE_TRANSITION_KINDS,
} from "./schema";
import { inspectContinuations, inspectGroupContinuations } from "./continuation";

export type CreativeValidationCode =
  | "invalid_document"
  | "unsupported_version"
  | "invalid_canvas"
  | "invalid_design_token"
  | "invalid_scene"
  | "invalid_element"
  | "invalid_group"
  | "invalid_transform"
  | "invalid_timing"
  | "invalid_animation"
  | "invalid_transition"
  | "duplicate_id"
  | "missing_reference";

export interface CreativeValidationIssue {
  code: CreativeValidationCode;
  path: string;
  message: string;
}

export interface CreativeValidationResult {
  valid: boolean;
  issues: CreativeValidationIssue[];
}

type RecordValue = Record<string, unknown>;

function isRecord(value: unknown): value is RecordValue {
  return !!value && typeof value === "object" && !Array.isArray(value);
}

function isFiniteNumber(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value);
}

function isInteger(value: unknown): value is number {
  return isFiniteNumber(value) && Number.isInteger(value);
}

function nonEmptyString(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0;
}

function inList(value: unknown, values: readonly string[]): value is string {
  return typeof value === "string" && values.includes(value);
}

/**
 * An easing is either a named preset or a cubic-bezier curve. x control
 * points must sit in 0..1 like CSS requires; y may overshoot, which is what
 * makes anticipation and follow-through possible.
 */
function isValidEasing(value: unknown): boolean {
  if (typeof value === "string") return (EASING_NAMES as readonly string[]).includes(value);
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const curve = value as Record<string, unknown>;
  if (curve.kind !== "cubic-bezier") return false;
  for (const key of ["x1", "y1", "x2", "y2"] as const) {
    if (typeof curve[key] !== "number" || !Number.isFinite(curve[key])) return false;
  }
  return (
    (curve.x1 as number) >= 0 && (curve.x1 as number) <= 1 &&
    (curve.x2 as number) >= 0 && (curve.x2 as number) <= 1
  );
}

function addIssue(
  issues: CreativeValidationIssue[],
  code: CreativeValidationCode,
  path: string,
  message: string,
) {
  issues.push({ code, path, message });
}

const HEX_COLOR = /^#(?:[0-9a-fA-F]{3}|[0-9a-fA-F]{6}|[0-9a-fA-F]{8})$/;
const FUNCTION_COLOR = /^(?:rgb|rgba|hsl|hsla)\(\s*[^()]+\s*\)$/i;

function isLiteralColor(value: unknown): value is string {
  return (
    typeof value === "string" &&
    (value === "transparent" || HEX_COLOR.test(value) || FUNCTION_COLOR.test(value))
  );
}

/**
 * `allowGradient` is a required, explicit choice at every call site rather
 * than a default, so adding a new colour-bearing field forces a deliberate
 * answer to "can this one render a gradient" instead of silently inheriting
 * whatever the default happened to be. Reject it here and the error names the
 * fix: literal or token colours are exactly the alternatives `resolveColor`
 * still resolves without a `background`.
 */
function validateColorValue(
  value: unknown,
  path: string,
  colors: Record<string, string>,
  issues: CreativeValidationIssue[],
  allowGradient: boolean,
) {
  if (!isRecord(value)) {
    addIssue(issues, "invalid_design_token", path, "Color must be a literal, token or gradient reference.");
    return;
  }
  if (value.kind === "literal") {
    if (!isLiteralColor(value.value)) {
      addIssue(issues, "invalid_design_token", `${path}.value`, "Literal color is not supported.");
    }
    return;
  }
  if (value.kind === "token") {
    if (!nonEmptyString(value.token) || !(value.token in colors)) {
      addIssue(issues, "missing_reference", `${path}.token`, "Color token does not exist.");
    }
    return;
  }
  if (value.kind === "gradient") {
    if (!allowGradient) {
      addIssue(issues, "invalid_design_token", path, "A gradient cannot be used here; use a literal or token color instead.");
      return;
    }
    validateGradientValue(value.gradient, `${path}.gradient`, colors, issues);
    return;
  }
  addIssue(issues, "invalid_design_token", `${path}.kind`, "Unknown color value kind.");
}

/**
 * A gradient's own shape: a real kind, at least two stops, each with an
 * offset in range and a colour that resolves to one flat CSS `<color>`.
 *
 * Stops are not required to arrive pre-sorted — `lib/creative/gradient.ts`
 * orders them by offset at resolve time — so this validates each stop
 * independently rather than checking the array is already ascending.
 */
function validateGradientValue(
  value: unknown,
  path: string,
  colors: Record<string, string>,
  issues: CreativeValidationIssue[],
) {
  if (!isRecord(value)) {
    addIssue(issues, "invalid_design_token", path, "Gradient must be an object.");
    return;
  }
  if (!inList(value.kind, GRADIENT_KINDS)) {
    addIssue(issues, "invalid_design_token", `${path}.kind`, "Gradient kind is invalid.");
  }
  for (const key of ["angle", "centerX", "centerY"] as const) {
    if (value[key] !== undefined && !isFiniteNumber(value[key])) {
      addIssue(issues, "invalid_design_token", `${path}.${key}`, `Gradient ${key} must be finite.`);
    }
  }
  for (const key of ["centerX", "centerY"] as const) {
    if (isFiniteNumber(value[key]) && ((value[key] as number) < 0 || (value[key] as number) > 1)) {
      addIssue(issues, "invalid_design_token", `${path}.${key}`, `Gradient ${key} must be between zero and one.`);
    }
  }
  if (!Array.isArray(value.stops) || value.stops.length < 2) {
    addIssue(issues, "invalid_design_token", `${path}.stops`, "Gradient requires at least two stops.");
    return;
  }
  value.stops.forEach((stop, index) => {
    const stopPath = `${path}.stops[${index}]`;
    if (!isRecord(stop)) {
      addIssue(issues, "invalid_design_token", stopPath, "Gradient stop must be an object.");
      return;
    }
    if (!isFiniteNumber(stop.offset) || stop.offset < 0 || stop.offset > 1) {
      addIssue(issues, "invalid_design_token", `${stopPath}.offset`, "Gradient stop offset must be between zero and one.");
    }
    // A stop's colour has to resolve to one CSS <color>, so a gradient nested
    // inside it is rejected the same way a gradient is rejected anywhere
    // else only a flat colour can render.
    validateColorValue(stop.color, `${stopPath}.color`, colors, issues, false);
  });
}

function validateGradientNumberTrack(
  value: unknown, path: string, visibleStartMs: number, visibleEndMs: number,
  issues: CreativeValidationIssue[], normalized: boolean,
) {
  if (!Array.isArray(value) || value.length < 2) { addIssue(issues, "invalid_animation", path, "Gradient animation track requires at least two keyframes."); return; }
  let previous = -1;
  value.forEach((keyframe, index) => {
    const keyPath = `${path}[${index}]`;
    if (!isRecord(keyframe)) { addIssue(issues, "invalid_animation", keyPath, "Gradient keyframe must be an object."); return; }
    if (!isInteger(keyframe.timeMs) || keyframe.timeMs <= previous || keyframe.timeMs < visibleStartMs || keyframe.timeMs > visibleEndMs) addIssue(issues, "invalid_animation", `${keyPath}.timeMs`, "Gradient keyframe time must be ordered and inside the visible window.");
    if (isInteger(keyframe.timeMs)) previous = keyframe.timeMs;
    if (!isFiniteNumber(keyframe.value) || (normalized && (keyframe.value < 0 || keyframe.value > 1))) addIssue(issues, "invalid_animation", `${keyPath}.value`, normalized ? "Gradient value must be between zero and one." : "Gradient value must be finite.");
    if (!isValidEasing(keyframe.easing)) addIssue(issues, "invalid_animation", `${keyPath}.easing`, "Gradient keyframe easing is invalid.");
  });
}

function validateGradientColorTrack(
  value: unknown, path: string, visibleStartMs: number, visibleEndMs: number, colors: Record<string, string>, issues: CreativeValidationIssue[],
) {
  if (!Array.isArray(value) || value.length < 2) { addIssue(issues, "invalid_animation", path, "Gradient color track requires at least two keyframes."); return; }
  let previous = -1;
  value.forEach((keyframe, index) => {
    const keyPath = `${path}[${index}]`;
    if (!isRecord(keyframe)) { addIssue(issues, "invalid_animation", keyPath, "Gradient color keyframe must be an object."); return; }
    if (!isInteger(keyframe.timeMs) || keyframe.timeMs <= previous || keyframe.timeMs < visibleStartMs || keyframe.timeMs > visibleEndMs) addIssue(issues, "invalid_animation", `${keyPath}.timeMs`, "Gradient color keyframe time must be ordered and inside the visible window.");
    if (isInteger(keyframe.timeMs)) previous = keyframe.timeMs;
    validateColorValue(keyframe.color, `${keyPath}.color`, colors, issues, false);
    if (!isValidEasing(keyframe.easing)) addIssue(issues, "invalid_animation", `${keyPath}.easing`, "Gradient color keyframe easing is invalid.");
  });
}

function validateGradientAnimation(
  value: unknown, path: string, baseGradient: RecordValue, visibleStartMs: number, visibleEndMs: number, colors: Record<string, string>, issues: CreativeValidationIssue[],
) {
  if (!isRecord(value)) { addIssue(issues, "invalid_animation", path, "Gradient animation must be an object."); return; }
  if (value.angle !== undefined) validateGradientNumberTrack(value.angle, `${path}.angle`, visibleStartMs, visibleEndMs, issues, false);
  if (value.centerX !== undefined) validateGradientNumberTrack(value.centerX, `${path}.centerX`, visibleStartMs, visibleEndMs, issues, true);
  if (value.centerY !== undefined) validateGradientNumberTrack(value.centerY, `${path}.centerY`, visibleStartMs, visibleEndMs, issues, true);
  if (value.stops === undefined) return;
  if (!Array.isArray(value.stops)) { addIssue(issues, "invalid_animation", `${path}.stops`, "Gradient stop animations must be an array."); return; }
  const stopCount = Array.isArray(baseGradient.stops) ? baseGradient.stops.length : 0;
  const seen = new Set<number>();
  value.stops.forEach((entry, index) => {
    const entryPath = `${path}.stops[${index}]`;
    if (!isRecord(entry)) { addIssue(issues, "invalid_animation", entryPath, "Gradient stop animation must be an object."); return; }
    if (!isInteger(entry.stopIndex) || entry.stopIndex < 0 || entry.stopIndex >= stopCount) addIssue(issues, "invalid_animation", `${entryPath}.stopIndex`, "Gradient stop animation index must reference an authored stop.");
    else if (seen.has(entry.stopIndex)) addIssue(issues, "duplicate_id", `${entryPath}.stopIndex`, "Gradient stop animation index is duplicated.");
    else seen.add(entry.stopIndex);
    if (entry.offset !== undefined) validateGradientNumberTrack(entry.offset, `${entryPath}.offset`, visibleStartMs, visibleEndMs, issues, true);
    if (entry.colorKeyframes !== undefined) validateGradientColorTrack(entry.colorKeyframes, `${entryPath}.colorKeyframes`, visibleStartMs, visibleEndMs, colors, issues);
  });
}

function validateTextStyleToken(
  value: unknown,
  path: string,
  colors: Record<string, string>,
  issues: CreativeValidationIssue[],
) {
  if (!isRecord(value)) {
    addIssue(issues, "invalid_design_token", path, "Typography token must be an object.");
    return;
  }
  if (!nonEmptyString(value.fontFamily)) addIssue(issues, "invalid_design_token", `${path}.fontFamily`, "Font family is required.");
  if (!isFiniteNumber(value.fontSize) || value.fontSize <= 0) addIssue(issues, "invalid_design_token", `${path}.fontSize`, "Font size must be positive.");
  if (!isFiniteNumber(value.fontWeight) || value.fontWeight <= 0) addIssue(issues, "invalid_design_token", `${path}.fontWeight`, "Font weight must be positive.");
  if (!isFiniteNumber(value.lineHeight) || value.lineHeight <= 0) addIssue(issues, "invalid_design_token", `${path}.lineHeight`, "Line height must be positive.");
  if (!isFiniteNumber(value.letterSpacing)) addIssue(issues, "invalid_design_token", `${path}.letterSpacing`, "Letter spacing must be finite.");
  if (!inList(value.align, ["left", "center", "right"])) addIssue(issues, "invalid_design_token", `${path}.align`, "Text alignment is invalid.");
  // A typography token's colour renders as CSS `color`, which cannot take a
  // gradient function.
  validateColorValue(value.color, `${path}.color`, colors, issues, false);
}

function validateStroke(
  value: unknown,
  path: string,
  colors: Record<string, string>,
  issues: CreativeValidationIssue[],
) {
  if (!isRecord(value)) {
    addIssue(issues, "invalid_design_token", path, "Stroke must be an object.");
    return;
  }
  if (!isFiniteNumber(value.width) || value.width < 0) {
    addIssue(issues, "invalid_design_token", `${path}.width`, "Stroke width must be non-negative.");
  }
  // A stroke renders as a CSS border shorthand string, which cannot embed a
  // gradient function where it wants a single colour.
  validateColorValue(value.color, `${path}.color`, colors, issues, false);
}

function validateTransition(
  value: unknown,
  path: string,
  sceneDurationMs: number,
  issues: CreativeValidationIssue[],
) {
  if (!isRecord(value)) {
    addIssue(issues, "invalid_transition", path, "Transition must be an object.");
    return;
  }
  const validKind = inList(value.kind, SCENE_TRANSITION_KINDS);
  if (!validKind) addIssue(issues, "invalid_transition", `${path}.kind`, "Transition kind is invalid.");
  if (!isInteger(value.durationMs) || value.durationMs < 0) {
    addIssue(issues, "invalid_transition", `${path}.durationMs`, "Transition duration must be a non-negative integer.");
  } else {
    if (value.kind === "cut" && value.durationMs !== 0) {
      addIssue(issues, "invalid_transition", `${path}.durationMs`, "Cut transition duration must be zero.");
    }
    if (value.kind !== "cut" && validKind && value.durationMs <= 0) {
      addIssue(issues, "invalid_transition", `${path}.durationMs`, "Non-cut transition duration must be positive.");
    }
    if (sceneDurationMs > 0 && value.durationMs > sceneDurationMs) {
      addIssue(issues, "invalid_transition", `${path}.durationMs`, "Transition cannot exceed scene duration.");
    }
  }
  if (!isValidEasing(value.easing)) {
    addIssue(issues, "invalid_transition", `${path}.easing`, "Transition easing is invalid.");
  }
}

function validateDesignSystem(
  value: unknown,
  path: string,
  issues: CreativeValidationIssue[],
): { colors: Record<string, string>; typography: Record<string, unknown> } {
  if (!isRecord(value)) {
    addIssue(issues, "invalid_design_token", path, "Design system must be an object.");
    return { colors: {}, typography: {} };
  }

  const colors: Record<string, string> = {};
  if (!isRecord(value.colors)) {
    addIssue(issues, "invalid_design_token", `${path}.colors`, "Color tokens must be an object.");
  } else {
    for (const [key, color] of Object.entries(value.colors)) {
      if (!isLiteralColor(color)) {
        addIssue(issues, "invalid_design_token", `${path}.colors.${key}`, "Color token must contain a supported literal color.");
      } else {
        colors[key] = color;
      }
    }
  }

  const typography: Record<string, unknown> = {};
  if (!isRecord(value.typography)) {
    addIssue(issues, "invalid_design_token", `${path}.typography`, "Typography tokens must be an object.");
  } else {
    Object.assign(typography, value.typography);
    for (const [key, token] of Object.entries(value.typography)) {
      validateTextStyleToken(token, `${path}.typography.${key}`, colors, issues);
    }
  }

  for (const collectionName of ["spacing", "radii"] as const) {
    const collection = value[collectionName];
    if (!isRecord(collection)) {
      addIssue(issues, "invalid_design_token", `${path}.${collectionName}`, `${collectionName} tokens must be an object.`);
      continue;
    }
    for (const [key, token] of Object.entries(collection)) {
      if (!isFiniteNumber(token) || token < 0) {
        addIssue(issues, "invalid_design_token", `${path}.${collectionName}.${key}`, `${collectionName} token must be non-negative.`);
      }
    }
  }

  if (!isRecord(value.strokes)) {
    addIssue(issues, "invalid_design_token", `${path}.strokes`, "Stroke tokens must be an object.");
  } else {
    for (const [key, token] of Object.entries(value.strokes)) {
      validateStroke(token, `${path}.strokes.${key}`, colors, issues);
    }
  }

  if (!isRecord(value.motion)) {
    addIssue(issues, "invalid_design_token", `${path}.motion`, "Motion system must be an object.");
  } else {
    if (!isRecord(value.motion.presets)) {
      addIssue(issues, "invalid_design_token", `${path}.motion.presets`, "Motion presets must be an object.");
    } else {
      for (const [key, preset] of Object.entries(value.motion.presets)) {
        const presetPath = `${path}.motion.presets.${key}`;
        if (!isRecord(preset)) {
          addIssue(issues, "invalid_design_token", presetPath, "Motion preset must be an object.");
          continue;
        }
        if (!isInteger(preset.durationMs) || preset.durationMs <= 0) addIssue(issues, "invalid_design_token", `${presetPath}.durationMs`, "Motion duration must be a positive integer.");
        if (!isValidEasing(preset.easing)) addIssue(issues, "invalid_design_token", `${presetPath}.easing`, "Motion easing is invalid.");
        if (!Array.isArray(preset.tracks) || preset.tracks.length === 0) {
          addIssue(issues, "invalid_design_token", `${presetPath}.tracks`, "Motion preset requires at least one track.");
        } else {
          preset.tracks.forEach((track, index) => {
            const trackPath = `${presetPath}.tracks[${index}]`;
            if (!isRecord(track)) {
              addIssue(issues, "invalid_design_token", trackPath, "Motion track must be an object.");
              return;
            }
            if (!inList(track.property, ANIMATION_PROPERTIES)) addIssue(issues, "invalid_design_token", `${trackPath}.property`, "Motion property is invalid.");
            if (!inList(track.mode, ["absolute", "delta", "multiplier"])) addIssue(issues, "invalid_design_token", `${trackPath}.mode`, "Motion value mode is invalid.");
            if (!isFiniteNumber(track.from)) addIssue(issues, "invalid_design_token", `${trackPath}.from`, "Motion from value must be finite.");
            if (!isFiniteNumber(track.to)) addIssue(issues, "invalid_design_token", `${trackPath}.to`, "Motion to value must be finite.");
          });
        }
      }
    }
    if (!isRecord(value.motion.sceneTransitions)) {
      addIssue(issues, "invalid_design_token", `${path}.motion.sceneTransitions`, "Scene transition presets must be an object.");
    } else {
      for (const [key, transition] of Object.entries(value.motion.sceneTransitions)) {
        validateTransition(transition, `${path}.motion.sceneTransitions.${key}`, Number.MAX_SAFE_INTEGER, issues);
      }
    }
  }

  return { colors, typography };
}

function validateTransform(value: unknown, path: string, issues: CreativeValidationIssue[]) {
  if (!isRecord(value)) {
    addIssue(issues, "invalid_transform", path, "Transform must be an object.");
    return;
  }
  for (const key of ["x", "y", "rotation"] as const) {
    if (!isFiniteNumber(value[key])) addIssue(issues, "invalid_transform", `${path}.${key}`, `${key} must be finite.`);
  }
  for (const key of ["z", "rotationX", "rotationY"] as const) {
    if (value[key] !== undefined && !isFiniteNumber(value[key])) addIssue(issues, "invalid_transform", `${path}.${key}`, `${key} must be finite.`);
  }
  for (const key of ["width", "height"] as const) {
    if (!isFiniteNumber(value[key]) || value[key] <= 0) addIssue(issues, "invalid_transform", `${path}.${key}`, `${key} must be positive.`);
  }
  if (!isFiniteNumber(value.opacity) || value.opacity < 0 || value.opacity > 1) addIssue(issues, "invalid_transform", `${path}.opacity`, "Opacity must be between zero and one.");
  for (const key of ["anchorX", "anchorY"] as const) {
    if (!isFiniteNumber(value[key]) || value[key] < 0 || value[key] > 1) addIssue(issues, "invalid_transform", `${path}.${key}`, `${key} must be between zero and one.`);
  }
  if (!isInteger(value.zIndex)) addIssue(issues, "invalid_transform", `${path}.zIndex`, "zIndex must be an integer.");
}

function validateTiming(
  value: unknown,
  path: string,
  sceneDurationMs: number,
  issues: CreativeValidationIssue[],
): { startMs: number; endMs: number; valid: boolean } {
  if (!isRecord(value)) {
    addIssue(issues, "invalid_timing", path, "Timing must be an object.");
    return { startMs: 0, endMs: sceneDurationMs, valid: false };
  }
  const valid =
    isInteger(value.startMs) &&
    isInteger(value.endMs) &&
    value.startMs >= 0 &&
    value.startMs < value.endMs &&
    value.endMs <= sceneDurationMs;
  if (!valid) addIssue(issues, "invalid_timing", path, "Timing must satisfy 0 <= start < end <= scene duration.");
  return {
    startMs: isInteger(value.startMs) ? value.startMs : 0,
    endMs: isInteger(value.endMs) ? value.endMs : sceneDurationMs,
    valid,
  };
}

function validateAnimations(
  value: unknown,
  path: string,
  visibleStartMs: number,
  visibleEndMs: number,
  issues: CreativeValidationIssue[],
) {
  if (!Array.isArray(value)) {
    addIssue(issues, "invalid_animation", path, "Animations must be an array.");
    return;
  }
  const ids = new Set<string>();
  value.forEach((animation, animationIndex) => {
    const animationPath = `${path}[${animationIndex}]`;
    if (!isRecord(animation)) {
      addIssue(issues, "invalid_animation", animationPath, "Animation must be an object.");
      return;
    }
    if (!nonEmptyString(animation.id)) {
      addIssue(issues, "invalid_animation", `${animationPath}.id`, "Animation id is required.");
    } else if (ids.has(animation.id)) {
      addIssue(issues, "duplicate_id", `${animationPath}.id`, "Animation id is duplicated.");
    } else {
      ids.add(animation.id);
    }
    const propertyValid = inList(animation.property, ANIMATION_PROPERTIES);
    if (!propertyValid) addIssue(issues, "invalid_animation", `${animationPath}.property`, "Animation property is invalid.");
    if (!Array.isArray(animation.keyframes) || animation.keyframes.length < 2) {
      addIssue(issues, "invalid_animation", `${animationPath}.keyframes`, "Animation requires at least two keyframes.");
      return;
    }
    let previousTime = -1;
    animation.keyframes.forEach((keyframe, keyframeIndex) => {
      const keyframePath = `${animationPath}.keyframes[${keyframeIndex}]`;
      if (!isRecord(keyframe)) {
        addIssue(issues, "invalid_animation", keyframePath, "Keyframe must be an object.");
        return;
      }
      if (!isInteger(keyframe.timeMs) || keyframe.timeMs <= previousTime || keyframe.timeMs < visibleStartMs || keyframe.timeMs > visibleEndMs) {
        addIssue(issues, "invalid_animation", `${keyframePath}.timeMs`, "Keyframe time must be ordered and inside the visible window.");
      }
      if (isInteger(keyframe.timeMs)) previousTime = keyframe.timeMs;
      if (!isFiniteNumber(keyframe.value)) {
        addIssue(issues, "invalid_animation", `${keyframePath}.value`, "Keyframe value must be finite.");
      } else if (animation.property === "opacity" && (keyframe.value < 0 || keyframe.value > 1)) {
        addIssue(issues, "invalid_animation", `${keyframePath}.value`, "Opacity animation must stay between zero and one.");
      } else if ((animation.property === "scaleX" || animation.property === "scaleY") && keyframe.value < 0) {
        addIssue(issues, "invalid_animation", `${keyframePath}.value`, "Scale animation must be non-negative.");
      } else if (
        (animation.property === "drawProgress" || animation.property === "fillProgress") &&
        (keyframe.value < 0 || keyframe.value > 1)
      ) {
        addIssue(issues, "invalid_animation", `${keyframePath}.value`, "Draw/fill progress animation must stay between zero and one.");
      }
      if (!isValidEasing(keyframe.easing)) addIssue(issues, "invalid_animation", `${keyframePath}.easing`, "Keyframe easing is invalid.");
    });
  });
}

function validateHierarchyTransform(value: unknown, path: string, issues: CreativeValidationIssue[]) {
  if (!isRecord(value)) {
    addIssue(issues, "invalid_transform", path, "Hierarchy transform must be an object.");
    return;
  }
  for (const key of ["x", "y", "rotation"] as const) {
    if (!isFiniteNumber(value[key])) addIssue(issues, "invalid_transform", `${path}.${key}`, `${key} must be finite.`);
  }
  for (const key of ["scaleX", "scaleY"] as const) {
    if (!isFiniteNumber(value[key]) || value[key] < 0) addIssue(issues, "invalid_transform", `${path}.${key}`, `${key} must be non-negative.`);
  }
  if (!isFiniteNumber(value.opacity) || value.opacity < 0 || value.opacity > 1) addIssue(issues, "invalid_transform", `${path}.opacity`, "Opacity must be between zero and one.");
  for (const key of ["anchorX", "anchorY"] as const) {
    if (!isFiniteNumber(value[key]) || value[key] < 0 || value[key] > 1) addIssue(issues, "invalid_transform", `${path}.${key}`, `${key} must be between zero and one.`);
  }
  if (value.blurPx !== undefined && (!isFiniteNumber(value.blurPx) || value.blurPx < 0)) {
    addIssue(issues, "invalid_transform", `${path}.blurPx`, "Hierarchy blur must be non-negative.");
  }
}

function validateCamera(value: unknown, path: string, sceneDurationMs: number, issues: CreativeValidationIssue[]) {
  if (!isRecord(value)) {
    addIssue(issues, "invalid_scene", path, "Scene camera must be an object.");
    return;
  }
  validateHierarchyTransform(value.transform, `${path}.transform`, issues);
  if (value.animations !== undefined) validateAnimations(value.animations, `${path}.animations`, 0, sceneDurationMs, issues);
  if (value.perspectivePx !== undefined && (!isFiniteNumber(value.perspectivePx) || value.perspectivePx <= 0)) {
    addIssue(issues, "invalid_scene", `${path}.perspectivePx`, "Camera perspective must be positive.");
  }
  for (const key of ["perspectiveOriginX", "perspectiveOriginY"] as const) {
    if (value[key] !== undefined && (!isFiniteNumber(value[key]) || value[key] < 0 || value[key] > 1)) {
      addIssue(issues, "invalid_scene", `${path}.${key}`, `${key} must be between zero and one.`);
    }
  }
}

function validateCrop(value: unknown, path: string, issues: CreativeValidationIssue[]) {
  if (!isRecord(value)) {
    addIssue(issues, "invalid_element", path, "Crop must be an object.");
    return;
  }
  const values = [value.x, value.y, value.width, value.height];
  const finite = values.every(isFiniteNumber);
  if (
    !finite ||
    (value.x as number) < 0 ||
    (value.y as number) < 0 ||
    (value.width as number) <= 0 ||
    (value.height as number) <= 0 ||
    (value.x as number) + (value.width as number) > 1 ||
    (value.y as number) + (value.height as number) > 1
  ) {
    addIssue(issues, "invalid_element", path, "Crop must fit inside normalized 0..1 bounds.");
  }
}

function validateMask(value: unknown, path: string, issues: CreativeValidationIssue[]) {
  if (!isRecord(value)) {
    addIssue(issues, "invalid_element", path, "Mask must be an object.");
    return;
  }
  if (!inList(value.kind, CREATIVE_MASK_KINDS)) {
    addIssue(issues, "invalid_element", `${path}.kind`, "Mask kind is invalid.");
  }
  for (const key of ["x", "y"] as const) {
    if (!isFiniteNumber(value[key])) addIssue(issues, "invalid_element", `${path}.${key}`, `Mask ${key} must be finite.`);
  }
  for (const key of ["width", "height"] as const) {
    if (!isFiniteNumber(value[key]) || (value[key] as number) <= 0) {
      addIssue(issues, "invalid_element", `${path}.${key}`, `Mask ${key} must be positive.`);
    }
  }
  if (value.feather !== undefined && (!isFiniteNumber(value.feather) || value.feather < 0 || value.feather > 1)) {
    addIssue(issues, "invalid_element", `${path}.feather`, "Mask feather must be between zero and one.");
  }
  if (value.invert !== undefined && typeof value.invert !== "boolean") {
    addIssue(issues, "invalid_element", `${path}.invert`, "Mask invert must be a boolean.");
  }
  if (value.radius !== undefined && (!isFiniteNumber(value.radius) || value.radius < 0 || value.radius > 1)) {
    addIssue(issues, "invalid_element", `${path}.radius`, "Mask radius must be between zero and one.");
  }
  if (value.kind === "polygon") {
    if (!Array.isArray(value.points) || value.points.length < 3) {
      addIssue(issues, "invalid_element", `${path}.points`, "Polygon mask requires at least three normalized points.");
    } else {
      value.points.forEach((point, index) => {
        const pointPath = `${path}.points[${index}]`;
        if (!isRecord(point) || !isFiniteNumber(point.x) || !isFiniteNumber(point.y) || point.x < 0 || point.x > 1 || point.y < 0 || point.y > 1) {
          addIssue(issues, "invalid_element", pointPath, "Polygon mask points must be normalized x/y values between zero and one.");
        }
      });
    }
    if ((isFiniteNumber(value.feather) && value.feather > 0) || value.invert === true) {
      addIssue(issues, "invalid_element", path, "Polygon masks are hard-edged in V1; feather and invert are supported by rect/ellipse masks.");
    }
  }
}

function validateMotionBlur(value: unknown, path: string, issues: CreativeValidationIssue[]) {
  if (!isRecord(value)) {
    addIssue(issues, "invalid_element", path, "Motion blur must be an object.");
    return;
  }
  if (!isFiniteNumber(value.shutterAngle) || value.shutterAngle < 0 || value.shutterAngle > 720) {
    addIssue(issues, "invalid_element", `${path}.shutterAngle`, "Shutter angle must be between zero and 720 degrees.");
  }
  if (value.maxBlurPx !== undefined && (!isFiniteNumber(value.maxBlurPx) || value.maxBlurPx < 0)) {
    addIssue(issues, "invalid_element", `${path}.maxBlurPx`, "Maximum blur must be non-negative.");
  }
}

function validateSpeedRamp(value: unknown, path: string, issues: CreativeValidationIssue[]) {
  if (!isRecord(value) || !Array.isArray(value.keyframes)) {
    addIssue(issues, "invalid_animation", path, "Speed ramp must have a keyframes array.");
    return;
  }
  if (value.keyframes.length < 2) {
    addIssue(issues, "invalid_animation", `${path}.keyframes`, "Speed ramp requires at least two keyframes.");
    return;
  }
  let previous = -1;
  value.keyframes.forEach((keyframe, index) => {
    const keyPath = `${path}.keyframes[${index}]`;
    if (!isRecord(keyframe)) {
      addIssue(issues, "invalid_animation", keyPath, "Speed keyframe must be an object.");
      return;
    }
    if (!isInteger(keyframe.atMs) || keyframe.atMs < 0 || keyframe.atMs <= previous) {
      addIssue(issues, "invalid_animation", `${keyPath}.atMs`, "Speed keyframe times must be ordered and non-negative.");
    }
    if (isInteger(keyframe.atMs)) previous = keyframe.atMs;
    // Zero would stall the clip forever; negative would run it backwards.
    if (!isFiniteNumber(keyframe.speed) || keyframe.speed <= 0) {
      addIssue(issues, "invalid_animation", `${keyPath}.speed`, "Speed must be positive.");
    }
  });
}

function validateAdjustments(value: unknown, path: string, issues: CreativeValidationIssue[]) {
  if (!isRecord(value)) {
    addIssue(issues, "invalid_element", path, "Adjustments must be an object.");
    return;
  }
  // Ranges are clamped at render time; validation only rejects values that
  // are not numbers at all, so a grade can never make a document unloadable.
  for (const key of ["exposure", "contrast", "saturation", "temperature", "blurPx", "vignette", "grain", "backdropBlurPx", "backdropSaturation"] as const) {
    if (value[key] !== undefined && !isFiniteNumber(value[key])) {
      addIssue(issues, "invalid_element", `${path}.${key}`, `Adjustment ${key} must be finite.`);
    }
  }
}

function validateTextAnimation(
  value: unknown,
  path: string,
  visibleDurationMs: number,
  issues: CreativeValidationIssue[],
) {
  if (!isRecord(value)) {
    addIssue(issues, "invalid_animation", path, "Text animation must be an object.");
    return;
  }
  if (!inList(value.granularity, TEXT_ANIMATION_GRANULARITIES)) {
    addIssue(issues, "invalid_animation", `${path}.granularity`, "Text animation granularity is invalid.");
  }
  if (!inList(value.mode, TEXT_ANIMATION_MODES)) {
    addIssue(issues, "invalid_animation", `${path}.mode`, "Text animation mode is invalid.");
  }
  if (!isValidEasing(value.easing)) {
    addIssue(issues, "invalid_animation", `${path}.easing`, "Text animation easing is invalid.");
  }
  if (!isInteger(value.startMs) || value.startMs < 0) {
    addIssue(issues, "invalid_animation", `${path}.startMs`, "Text animation start must be a non-negative integer.");
  }
  if (!isInteger(value.durationMs) || value.durationMs <= 0) {
    addIssue(issues, "invalid_animation", `${path}.durationMs`, "Text animation duration must be a positive integer.");
  }
  if (!isInteger(value.staggerMs) || value.staggerMs < 0) {
    addIssue(issues, "invalid_animation", `${path}.staggerMs`, "Text animation stagger must be a non-negative integer.");
  }
  if (value.distance !== undefined && !isFiniteNumber(value.distance)) {
    addIssue(issues, "invalid_animation", `${path}.distance`, "Text animation distance must be finite.");
  }
  // The run must be able to finish inside the element's visible window,
  // otherwise the text never reaches its resting state on screen.
  if (isInteger(value.startMs) && isInteger(value.durationMs) && visibleDurationMs > 0) {
    if (value.startMs + value.durationMs > visibleDurationMs) {
      addIssue(issues, "invalid_animation", path, "Text animation must finish inside the element visible window.");
    }
  }
}

function validateGlass(
  value: unknown,
  path: string,
  colors: Record<string, string>,
  issues: CreativeValidationIssue[],
) {
  if (!isRecord(value)) {
    addIssue(issues, "invalid_element", path, "Glass must be an object.");
    return;
  }
  if (!isFiniteNumber(value.blurPx) || value.blurPx < 0) {
    addIssue(issues, "invalid_element", `${path}.blurPx`, "Glass blur must be a non-negative number.");
  }
  for (const key of ["tintOpacity", "borderOpacity", "highlight", "shadow"] as const) {
    if (value[key] !== undefined && (!isFiniteNumber(value[key]) || (value[key] as number) < 0 || (value[key] as number) > 1)) {
      addIssue(issues, "invalid_element", `${path}.${key}`, `Glass ${key} must be between zero and one.`);
    }
  }
  if (value.saturation !== undefined && (!isFiniteNumber(value.saturation) || value.saturation < 0 || value.saturation > 3)) {
    addIssue(issues, "invalid_element", `${path}.saturation`, "Glass saturation must be between zero and three.");
  }
  if (value.radius !== undefined && (!isFiniteNumber(value.radius) || value.radius < 0)) {
    addIssue(issues, "invalid_element", `${path}.radius`, "Glass radius must be a non-negative number.");
  }
  if (value.tint !== undefined) {
    // A tint renders as a flat CSS layer over the backdrop, so it cannot be a
    // gradient - the highlight is the only gradient a glass panel wants.
    validateColorValue(value.tint, `${path}.tint`, colors, issues, false);
  }
}

function validateCounter(
  value: unknown,
  path: string,
  visibleDurationMs: number,
  issues: CreativeValidationIssue[],
) {
  if (!isRecord(value)) {
    addIssue(issues, "invalid_element", path, "Counter must be an object.");
    return;
  }
  if (!isFiniteNumber(value.from)) addIssue(issues, "invalid_element", `${path}.from`, "Counter from must be finite.");
  if (!isFiniteNumber(value.to)) addIssue(issues, "invalid_element", `${path}.to`, "Counter to must be finite.");
  if (!isInteger(value.startMs) || value.startMs < 0) {
    addIssue(issues, "invalid_element", `${path}.startMs`, "Counter start must be a non-negative integer.");
  }
  if (!isInteger(value.durationMs) || value.durationMs <= 0) {
    addIssue(issues, "invalid_element", `${path}.durationMs`, "Counter duration must be a positive integer.");
  }
  if (!isValidEasing(value.easing)) {
    addIssue(issues, "invalid_element", `${path}.easing`, "Counter easing is invalid.");
  }
  if (value.format !== undefined && !inList(value.format, CHART_LABEL_FORMATS)) {
    addIssue(issues, "invalid_element", `${path}.format`, "Counter format is invalid.");
  }
  if (value.precision !== undefined && (!isFiniteNumber(value.precision) || value.precision < 0 || value.precision > 6)) {
    addIssue(issues, "invalid_element", `${path}.precision`, "Counter precision must be between zero and six.");
  }
  if (value.prefix !== undefined && typeof value.prefix !== "string") {
    addIssue(issues, "invalid_element", `${path}.prefix`, "Counter prefix must be a string.");
  }
  if (value.suffix !== undefined && typeof value.suffix !== "string") {
    addIssue(issues, "invalid_element", `${path}.suffix`, "Counter suffix must be a string.");
  }
  // Same rule apply_text_animation already enforces on its own run, and for
  // the same reason: without it a count could still be climbing toward `to`
  // the instant the text element itself disappears.
  if (isInteger(value.startMs) && isInteger(value.durationMs) && visibleDurationMs > 0) {
    if (value.startMs + value.durationMs > visibleDurationMs) {
      addIssue(issues, "invalid_element", path, "Counter must finish inside the element visible window.");
    }
  }
}

/**
 * A degenerate outline - fewer than three points, or a coordinate that is
 * not a finite number - is rejected here rather than left for the resolver
 * to discover. resamplePolygon and alignToReference both divide by measured
 * distances between points; an outline the resolver could not walk would
 * either throw well after the transaction that created it committed, or
 * silently produce NaN geometry a renderer draws as nothing at all. Points
 * are NOT clamped to 0..1 the way a mask's polygon points are - see
 * CreativeShapeOutline in schema.ts for why a shape outline is allowed to
 * spike past its own box and a mask is not.
 */
function validateShapeOutline(value: unknown, path: string, issues: CreativeValidationIssue[]) {
  if (!isRecord(value)) {
    addIssue(issues, "invalid_element", path, "Shape outline must be an object.");
    return;
  }
  if (!Array.isArray(value.points) || value.points.length < 3) {
    addIssue(issues, "invalid_element", `${path}.points`, "Shape outline requires at least three points.");
    return;
  }
  value.points.forEach((point, index) => {
    const pointPath = `${path}.points[${index}]`;
    if (!isRecord(point) || !isFiniteNumber(point.x) || !isFiniteNumber(point.y)) {
      addIssue(issues, "invalid_element", pointPath, "Shape outline points must have finite x/y coordinates.");
    }
  });
}

function validateShapeMorph(
  value: unknown,
  path: string,
  visibleDurationMs: number,
  issues: CreativeValidationIssue[],
) {
  if (!isRecord(value)) {
    addIssue(issues, "invalid_element", path, "Shape morph must be an object.");
    return;
  }
  validateShapeOutline(value.from, `${path}.from`, issues);
  validateShapeOutline(value.to, `${path}.to`, issues);
  if (!isInteger(value.startMs) || value.startMs < 0) {
    addIssue(issues, "invalid_element", `${path}.startMs`, "Shape morph start must be a non-negative integer.");
  }
  if (!isInteger(value.durationMs) || value.durationMs <= 0) {
    addIssue(issues, "invalid_element", `${path}.durationMs`, "Shape morph duration must be a positive integer.");
  }
  if (!isValidEasing(value.easing)) {
    addIssue(issues, "invalid_element", `${path}.easing`, "Shape morph easing is invalid.");
  }
  // Same rule set_counter's own run already follows against its element's
  // visible window, and for the same reason: without it a morph could still
  // be mid-transition the instant the shape itself disappears.
  if (isInteger(value.startMs) && isInteger(value.durationMs) && visibleDurationMs > 0) {
    if (value.startMs + value.durationMs > visibleDurationMs) {
      addIssue(issues, "invalid_element", path, "Shape morph must finish inside the element visible window.");
    }
  }
}

function validateTextFit(value: unknown, path: string, issues: CreativeValidationIssue[]) {
  if (!isRecord(value)) {
    addIssue(issues, "invalid_element", path, "Text fit must be an object.");
    return;
  }
  if (!inList(value.mode, TEXT_FIT_MODES)) {
    addIssue(issues, "invalid_element", `${path}.mode`, "Text fit mode is invalid.");
  }
  if (!isFiniteNumber(value.minFontSize) || value.minFontSize <= 0) {
    addIssue(issues, "invalid_element", `${path}.minFontSize`, "Text fit minimum font size must be positive.");
  }
}

function validateUiFrame(value: unknown, path: string, issues: CreativeValidationIssue[]) {
  if (!isRecord(value)) {
    addIssue(issues, "invalid_element", path, "UI node frame must be an object.");
    return;
  }
  for (const key of ["x", "y"] as const) {
    if (!isFiniteNumber(value[key])) addIssue(issues, "invalid_element", `${path}.${key}`, `UI node frame ${key} must be finite.`);
  }
  for (const key of ["width", "height"] as const) {
    if (!isFiniteNumber(value[key]) || value[key] <= 0) {
      addIssue(issues, "invalid_element", `${path}.${key}`, `UI node frame ${key} must be positive.`);
    }
  }
}

function validateUiNode(
  value: unknown,
  path: string,
  depth: number,
  ids: Set<string>,
  colors: Record<string, string>,
  typography: Record<string, unknown>,
  issues: CreativeValidationIssue[],
  parentUsesLayout = false,
) {
  if (!isRecord(value)) {
    addIssue(issues, "invalid_element", path, "UI node must be an object.");
    return;
  }
  if (depth > CREATIVE_UI_MAX_DEPTH) {
    addIssue(issues, "invalid_element", path, `UI nodes may not nest deeper than ${CREATIVE_UI_MAX_DEPTH} levels.`);
    return;
  }
  if (!nonEmptyString(value.id)) {
    addIssue(issues, "invalid_element", `${path}.id`, "UI node id is required.");
  } else if (ids.has(value.id)) {
    addIssue(issues, "duplicate_id", `${path}.id`, "UI node id is duplicated.");
  } else {
    ids.add(value.id);
  }

  validateUiFrame(value.frame, `${path}.frame`, issues);
  if (parentUsesLayout && value.constraints !== undefined) {
    addIssue(issues, "invalid_element", `${path}.constraints`, "UI constraints cannot be combined with a parent flex/grid layout; layout controls the child frame.");
  }
  if (value.constraints !== undefined && !isRecord(value.constraints)) {
    addIssue(issues, "invalid_element", `${path}.constraints`, "UI constraints must be an object.");
  } else if (isRecord(value.constraints)) {
    for (const key of ["left", "right", "top", "bottom"] as const) {
      if (value.constraints[key] !== undefined && !isFiniteNumber(value.constraints[key])) addIssue(issues, "invalid_element", `${path}.constraints.${key}`, `UI constraint ${key} must be finite.`);
    }
    if (value.constraints.horizontal !== undefined && !inList(value.constraints.horizontal, ["start", "center", "end", "stretch"])) addIssue(issues, "invalid_element", `${path}.constraints.horizontal`, "UI horizontal constraint is invalid.");
    if (value.constraints.vertical !== undefined && !inList(value.constraints.vertical, ["start", "center", "end", "stretch"])) addIssue(issues, "invalid_element", `${path}.constraints.vertical`, "UI vertical constraint is invalid.");
    const horizontal = value.constraints.horizontal;
    if (
      (horizontal === "start" && value.constraints.right !== undefined) ||
      (horizontal === "center" && (value.constraints.left !== undefined || value.constraints.right !== undefined)) ||
      (horizontal === "end" && value.constraints.left !== undefined)
    ) {
      addIssue(issues, "invalid_element", `${path}.constraints.horizontal`, `UI horizontal ${String(horizontal)} cannot be combined with the supplied edge offsets; use its matching edge, stretch, or omit horizontal.`);
    }
    const vertical = value.constraints.vertical;
    if (
      (vertical === "start" && value.constraints.bottom !== undefined) ||
      (vertical === "center" && (value.constraints.top !== undefined || value.constraints.bottom !== undefined)) ||
      (vertical === "end" && value.constraints.top !== undefined)
    ) {
      addIssue(issues, "invalid_element", `${path}.constraints.vertical`, `UI vertical ${String(vertical)} cannot be combined with the supplied edge offsets; use its matching edge, stretch, or omit vertical.`);
    }
  }
  if (value.layoutItem !== undefined && !isRecord(value.layoutItem)) {
    addIssue(issues, "invalid_element", `${path}.layoutItem`, "UI layout item must be an object.");
  } else if (isRecord(value.layoutItem)) {
    if (value.layoutItem.grow !== undefined && (!isFiniteNumber(value.layoutItem.grow) || value.layoutItem.grow < 0)) addIssue(issues, "invalid_element", `${path}.layoutItem.grow`, "UI grow must be non-negative.");
    if (value.layoutItem.columnSpan !== undefined && (!isInteger(value.layoutItem.columnSpan) || value.layoutItem.columnSpan < 1)) addIssue(issues, "invalid_element", `${path}.layoutItem.columnSpan`, "UI columnSpan must be a positive integer.");
    if (value.layoutItem.alignSelf !== undefined && !inList(value.layoutItem.alignSelf, ["start", "center", "end", "stretch"])) addIssue(issues, "invalid_element", `${path}.layoutItem.alignSelf`, "UI alignSelf is invalid.");
  }
  if (value.opacity !== undefined && (!isFiniteNumber(value.opacity) || value.opacity < 0 || value.opacity > 1)) {
    addIssue(issues, "invalid_element", `${path}.opacity`, "UI node opacity must be between zero and one.");
  }
  if (value.borderRadius !== undefined && (!isFiniteNumber(value.borderRadius) || value.borderRadius < 0)) {
    addIssue(issues, "invalid_element", `${path}.borderRadius`, "UI node border radius must be non-negative.");
  }
  if (value.clip !== undefined && typeof value.clip !== "boolean") {
    addIssue(issues, "invalid_element", `${path}.clip`, "UI node clip must be a boolean.");
  }

  if (!inList(value.kind, CREATIVE_UI_NODE_KINDS)) {
    addIssue(issues, "invalid_element", `${path}.kind`, "UI node kind is not supported.");
    return;
  }

  if (value.kind === "box") {
    // Renders as CSS `background`, so a gradient is fine here.
    if (value.background !== undefined) validateColorValue(value.background, `${path}.background`, colors, issues, true);
    if (value.border !== undefined) validateStroke(value.border, `${path}.border`, colors, issues);
    if (value.layout !== undefined) {
      if (!isRecord(value.layout) || !inList(value.layout.mode, ["flex", "grid"])) addIssue(issues, "invalid_element", `${path}.layout`, "UI layout must be flex or grid.");
      else {
        for (const key of ["gap", "padding"] as const) {
          if (value.layout[key] !== undefined && (!isFiniteNumber(value.layout[key]) || value.layout[key] < 0)) addIssue(issues, "invalid_element", `${path}.layout.${key}`, `UI layout ${key} must be non-negative.`);
        }
        if (value.layout.mode === "grid") {
          if (!isInteger(value.layout.columns) || value.layout.columns < 1) addIssue(issues, "invalid_element", `${path}.layout.columns`, "UI grid columns must be a positive integer.");
          if (value.layout.rowHeight !== undefined && (!isFiniteNumber(value.layout.rowHeight) || value.layout.rowHeight <= 0)) addIssue(issues, "invalid_element", `${path}.layout.rowHeight`, "UI grid rowHeight must be positive.");
        } else {
          if (value.layout.direction !== undefined && !inList(value.layout.direction, ["row", "column"])) addIssue(issues, "invalid_element", `${path}.layout.direction`, "UI flex direction is invalid.");
          if (value.layout.align !== undefined && !inList(value.layout.align, ["start", "center", "end", "stretch"])) addIssue(issues, "invalid_element", `${path}.layout.align`, "UI flex alignment is invalid.");
          if (value.layout.justify !== undefined && !inList(value.layout.justify, ["start", "center", "end"])) addIssue(issues, "invalid_element", `${path}.layout.justify`, "UI flex justification is invalid.");
        }
      }
    }
    if (value.children === undefined) return;
    if (!Array.isArray(value.children)) {
      addIssue(issues, "invalid_element", `${path}.children`, "UI node children must be an array.");
      return;
    }
    value.children.forEach((child, index) => {
      validateUiNode(child, `${path}.children[${index}]`, depth + 1, ids, colors, typography, issues, value.layout !== undefined);
    });
    return;
  }

  if (value.kind === "text") {
    if (typeof value.text !== "string") addIssue(issues, "invalid_element", `${path}.text`, "UI text must be a string.");
    if (!isRecord(value.style) || !nonEmptyString(value.style.token)) {
      addIssue(issues, "invalid_element", `${path}.style`, "UI text style reference is required.");
    } else if (!(value.style.token in typography)) {
      addIssue(issues, "missing_reference", `${path}.style.token`, "Typography token does not exist.");
    } else if (value.style.overrides !== undefined && !isRecord(value.style.overrides)) {
      addIssue(issues, "invalid_element", `${path}.style.overrides`, "UI text style overrides must be an object.");
    } else if (isRecord(value.style.overrides) && value.style.overrides.color !== undefined) {
      // Text colour, CSS `color` — cannot take a gradient.
      validateColorValue(value.style.overrides.color, `${path}.style.overrides.color`, colors, issues, false);
    }
    return;
  }

  if (!nonEmptyString(value.assetId)) {
    addIssue(issues, "missing_reference", `${path}.assetId`, "UI image asset id is required.");
  }
  if (!inList(value.fit, ["cover", "contain", "fill"])) {
    addIssue(issues, "invalid_element", `${path}.fit`, "UI image fit is invalid.");
  }
}

function countUiNodes(nodes: unknown[]): number {
  return nodes.reduce<number>((total, node) => {
    if (!isRecord(node)) return total + 1;
    const children = node.kind === "box" && Array.isArray(node.children) ? node.children : [];
    return total + 1 + countUiNodes(children);
  }, 0);
}

function validateUiScroll(
  value: unknown,
  path: string,
  visibleStartMs: number,
  visibleEndMs: number,
  issues: CreativeValidationIssue[],
) {
  if (!isRecord(value)) {
    addIssue(issues, "invalid_element", path, "UI scroll must be an object.");
    return;
  }
  for (const key of ["fromY", "toY"] as const) {
    if (!isFiniteNumber(value[key])) addIssue(issues, "invalid_element", `${path}.${key}`, `UI scroll ${key} must be finite.`);
  }
  const ordered =
    isInteger(value.startMs) &&
    isInteger(value.endMs) &&
    value.startMs < value.endMs &&
    value.startMs >= visibleStartMs &&
    value.endMs <= visibleEndMs;
  if (!ordered) {
    addIssue(issues, "invalid_timing", path, "UI scroll must satisfy visible start <= startMs < endMs <= visible end.");
  }
  if (!isValidEasing(value.easing)) {
    addIssue(issues, "invalid_element", `${path}.easing`, "UI scroll easing is invalid.");
  }
}

function validateUiPointer(
  value: unknown,
  path: string,
  visibleStartMs: number,
  visibleEndMs: number,
  colors: Record<string, string>,
  issues: CreativeValidationIssue[],
) {
  if (!isRecord(value)) {
    addIssue(issues, "invalid_element", path, "UI pointer must be an object.");
    return;
  }
  if (!isFiniteNumber(value.radius) || value.radius <= 0) {
    addIssue(issues, "invalid_element", `${path}.radius`, "UI pointer radius must be positive.");
  }
  // The tap indicator is a filled circle, rendered as CSS `background`.
  validateColorValue(value.color, `${path}.color`, colors, issues, true);
  if (!Array.isArray(value.keyframes) || value.keyframes.length === 0) {
    addIssue(issues, "invalid_element", `${path}.keyframes`, "UI pointer requires at least one keyframe.");
    return;
  }
  let previousTime = -1;
  value.keyframes.forEach((keyframe, index) => {
    const keyframePath = `${path}.keyframes[${index}]`;
    if (!isRecord(keyframe)) {
      addIssue(issues, "invalid_element", keyframePath, "UI pointer keyframe must be an object.");
      return;
    }
    if (
      !isInteger(keyframe.timeMs) ||
      keyframe.timeMs <= previousTime ||
      keyframe.timeMs < visibleStartMs ||
      keyframe.timeMs > visibleEndMs
    ) {
      addIssue(issues, "invalid_element", `${keyframePath}.timeMs`, "UI pointer keyframe time must be ordered and inside the visible window.");
    }
    if (isInteger(keyframe.timeMs)) previousTime = keyframe.timeMs;
    for (const key of ["x", "y"] as const) {
      if (!isFiniteNumber(keyframe[key])) {
        addIssue(issues, "invalid_element", `${keyframePath}.${key}`, `UI pointer keyframe ${key} must be finite.`);
      }
    }
    if (typeof keyframe.pressed !== "boolean") {
      addIssue(issues, "invalid_element", `${keyframePath}.pressed`, "UI pointer keyframe pressed must be a boolean.");
    }
  });
}

function validateUiElement(
  value: RecordValue,
  path: string,
  visibleStartMs: number,
  visibleEndMs: number,
  colors: Record<string, string>,
  typography: Record<string, unknown>,
  issues: CreativeValidationIssue[],
) {
  if (!isRecord(value.viewport)) {
    addIssue(issues, "invalid_element", `${path}.viewport`, "UI viewport must be an object.");
  } else {
    for (const key of ["width", "height"] as const) {
      const size = value.viewport[key];
      if (!isInteger(size) || size <= 0 || size > CREATIVE_UI_MAX_VIEWPORT) {
        addIssue(issues, "invalid_element", `${path}.viewport.${key}`, `UI viewport ${key} must be an integer from 1 to ${CREATIVE_UI_MAX_VIEWPORT}.`);
      }
    }
  }

  // Renders as CSS `background` on the viewport wrapper.
  if (value.background !== undefined) validateColorValue(value.background, `${path}.background`, colors, issues, true);

  if (!Array.isArray(value.nodes)) {
    addIssue(issues, "invalid_element", `${path}.nodes`, "UI nodes must be an array.");
  } else if (countUiNodes(value.nodes) > CREATIVE_UI_MAX_NODES) {
    addIssue(issues, "invalid_element", `${path}.nodes`, `A UI element may not contain more than ${CREATIVE_UI_MAX_NODES} nodes.`);
  } else {
    const ids = new Set<string>();
    value.nodes.forEach((node, index) => {
      validateUiNode(node, `${path}.nodes[${index}]`, 1, ids, colors, typography, issues);
    });
  }

  if (value.scroll !== undefined) validateUiScroll(value.scroll, `${path}.scroll`, visibleStartMs, visibleEndMs, issues);
  if (value.pointer !== undefined) {
    validateUiPointer(value.pointer, `${path}.pointer`, visibleStartMs, visibleEndMs, colors, issues);
  }
}

function validateChartAxes(
  value: unknown,
  path: string,
  seriesLength: number,
  issues: CreativeValidationIssue[],
) {
  if (!isRecord(value)) {
    addIssue(issues, "invalid_element", path, "Chart axes must be an object.");
    return;
  }
  if (value.yTicks !== undefined && (!isFiniteNumber(value.yTicks) || value.yTicks < 0 || !Number.isInteger(value.yTicks))) {
    addIssue(issues, "invalid_element", `${path}.yTicks`, "Chart axis tick count must be a non-negative integer.");
  }
  if (value.format !== undefined && !inList(value.format, CHART_LABEL_FORMATS)) {
    addIssue(issues, "invalid_element", `${path}.format`, "Chart label format is invalid.");
  }
  if (value.precision !== undefined && (!isFiniteNumber(value.precision) || value.precision < 0 || value.precision > 6)) {
    addIssue(issues, "invalid_element", `${path}.precision`, "Chart label precision must be between zero and six.");
  }
  if (value.categories !== undefined) {
    if (!Array.isArray(value.categories) || value.categories.some((entry) => typeof entry !== "string")) {
      addIssue(issues, "invalid_element", `${path}.categories`, "Chart categories must be an array of strings.");
    } else if (value.categories.length > seriesLength) {
      // Extra labels are dropped silently at render time; saying so at
      // authoring time is the difference between a typo and a mystery.
      addIssue(
        issues,
        "invalid_element",
        `${path}.categories`,
        `Chart has ${value.categories.length} categories for ${seriesLength} data points.`,
      );
    }
  }
}

function validateChartCallouts(
  value: unknown,
  path: string,
  seriesLength: number,
  visibleStartMs: number,
  visibleEndMs: number,
  issues: CreativeValidationIssue[],
) {
  if (!Array.isArray(value)) {
    addIssue(issues, "invalid_element", path, "Chart callouts must be an array.");
    return;
  }
  value.forEach((entry, index) => {
    const entryPath = `${path}[${index}]`;
    if (!isRecord(entry)) {
      addIssue(issues, "invalid_element", entryPath, "Chart callout must be an object.");
      return;
    }
    if (!Number.isInteger(entry.index) || (entry.index as number) < 0 || (entry.index as number) >= seriesLength) {
      addIssue(issues, "invalid_element", `${entryPath}.index`, "Chart callout index must reference a point in the series.");
    }
    if (!nonEmptyString(entry.text)) {
      addIssue(issues, "invalid_element", `${entryPath}.text`, "Chart callout text is required.");
    }
    for (const key of ["dx", "dy"] as const) {
      if (entry[key] !== undefined && !isFiniteNumber(entry[key])) {
        addIssue(issues, "invalid_element", `${entryPath}.${key}`, `Chart callout ${key} must be finite.`);
      }
    }
    // startMs is scene-local, the same clock the owning chart element's own
    // timing is on - see CREATIVE_TIME_BASES - so "fits" means inside that
    // element's own visible window, the same rule set_counter's run already
    // follows against ITS window. A callout with no startMs at all is the
    // pre-#69 shape and skips every check below untouched.
    const hasStart = entry.startMs !== undefined;
    if (hasStart) {
      if (!isInteger(entry.startMs) || (entry.startMs as number) < 0) {
        addIssue(issues, "invalid_element", `${entryPath}.startMs`, "Chart callout start must be a non-negative integer.");
      } else if ((entry.startMs as number) < visibleStartMs || (entry.startMs as number) >= visibleEndMs) {
        addIssue(issues, "invalid_element", `${entryPath}.startMs`, "Chart callout must start inside the chart element's own visible window.");
      }
    }
    if (entry.durationMs !== undefined) {
      if (!hasStart) {
        addIssue(issues, "invalid_element", `${entryPath}.durationMs`, "Chart callout durationMs needs startMs to measure from.");
      } else if (!isInteger(entry.durationMs) || (entry.durationMs as number) <= 0) {
        addIssue(issues, "invalid_element", `${entryPath}.durationMs`, "Chart callout duration must be a positive integer.");
      } else if (isInteger(entry.startMs) && (entry.startMs as number) + (entry.durationMs as number) > visibleEndMs) {
        addIssue(issues, "invalid_element", entryPath, "Chart callout must finish inside the chart element's own visible window.");
      }
    }
    if (entry.fadeMs !== undefined) {
      if (!hasStart) {
        addIssue(issues, "invalid_element", `${entryPath}.fadeMs`, "Chart callout fadeMs needs startMs to measure from.");
      } else if (!isInteger(entry.fadeMs) || (entry.fadeMs as number) < 0) {
        addIssue(issues, "invalid_element", `${entryPath}.fadeMs`, "Chart callout fade must be a non-negative integer.");
      } else if (isInteger(entry.durationMs) && (entry.fadeMs as number) > (entry.durationMs as number)) {
        // Same rule audio clip fadeInMs/fadeOutMs already follow: a fade
        // longer than the run it belongs to would never reach full opacity.
        addIssue(issues, "invalid_element", `${entryPath}.fadeMs`, "Chart callout fade cannot exceed its own duration.");
      }
    }
  });
}

function validateChartPointEmphasis(
  value: unknown,
  path: string,
  seriesLength: number,
  colors: Record<string, string>,
  issues: CreativeValidationIssue[],
) {
  if (!Array.isArray(value)) {
    addIssue(issues, "invalid_element", path, "Chart point emphasis must be an array.");
    return;
  }
  const seenIndices = new Set<number>();
  value.forEach((entry, entryIndex) => {
    const entryPath = `${path}[${entryIndex}]`;
    if (!isRecord(entry)) {
      addIssue(issues, "invalid_element", entryPath, "Chart point emphasis entry must be an object.");
      return;
    }
    if (!isInteger(entry.index) || entry.index < 0 || entry.index >= seriesLength) {
      addIssue(issues, "invalid_element", `${entryPath}.index`, "Chart point emphasis index must reference a point in the series.");
    } else if (seenIndices.has(entry.index)) {
      addIssue(issues, "duplicate_id", `${entryPath}.index`, "Chart point emphasis index is duplicated.");
    } else {
      seenIndices.add(entry.index);
    }
    if (entry.scale !== undefined && (!isFiniteNumber(entry.scale) || entry.scale <= 0)) {
      addIssue(issues, "invalid_element", `${entryPath}.scale`, "Chart point emphasis scale must be positive.");
    }
    // A marker/bar override renders as an SVG fill attribute, not a CSS
    // background, so it cannot take a gradient function either.
    if (entry.color !== undefined) validateColorValue(entry.color, `${entryPath}.color`, colors, issues, false);
  });
}

function validateElement(
  value: unknown,
  path: string,
  sceneDurationMs: number,
  colors: Record<string, string>,
  typography: Record<string, unknown>,
  issues: CreativeValidationIssue[],
  /** Composite nesting depth. 0 for a scene's own top-level elements. */
  depth = 0,
  /**
   * Child ids already seen in the CURRENT composite's whole tree - one Set
   * per top-level composite, threaded through every nested composite
   * descendant, exactly like validateUiNode threads one `ids` Set through a
   * whole ui node tree. Undefined for a top-level scene element; created
   * fresh the moment a composite is first encountered (see the "composite"
   * branch below) and reused for every descendant from there down, so a
   * child's id only has to be unique within its own owning composite's
   * subtree - the scope the (elementId, childId) addressing design actually
   * needs - not document-wide.
   */
  compositeIds?: Set<string>,
) {
  if (!isRecord(value)) {
    addIssue(issues, "invalid_element", path, "Element must be an object.");
    return;
  }
  if (!nonEmptyString(value.id)) addIssue(issues, "invalid_element", `${path}.id`, "Element id is required.");
  if (typeof value.name !== "string") addIssue(issues, "invalid_element", `${path}.name`, "Element name must be a string.");
  if (value.alias !== undefined && !nonEmptyString(value.alias)) addIssue(issues, "invalid_element", `${path}.alias`, "Element alias must be a non-empty string.");
  if (value.tags !== undefined) {
    if (!Array.isArray(value.tags) || value.tags.length === 0 || value.tags.some((tag) => !nonEmptyString(tag))) {
      addIssue(issues, "invalid_element", `${path}.tags`, "Element tags must be a non-empty array of non-empty strings.");
    } else if (new Set(value.tags).size !== value.tags.length) {
      addIssue(issues, "invalid_element", `${path}.tags`, "Element tags must not contain duplicates.");
    }
  }
  validateTransform(value.transform, `${path}.transform`, issues);

  let visibleStartMs = 0;
  let visibleEndMs = sceneDurationMs;
  if (value.timing !== undefined) {
    const timing = validateTiming(value.timing, `${path}.timing`, sceneDurationMs, issues);
    if (timing.valid) {
      visibleStartMs = timing.startMs;
      visibleEndMs = timing.endMs;
    }
  }
  if (value.animations !== undefined) {
    validateAnimations(value.animations, `${path}.animations`, visibleStartMs, visibleEndMs, issues);
  }
  if (value.adjustments !== undefined) validateAdjustments(value.adjustments, `${path}.adjustments`, issues);
  if (value.glass !== undefined) validateGlass(value.glass, `${path}.glass`, colors, issues);
  if (value.mask !== undefined) validateMask(value.mask, `${path}.mask`, issues);
  if (value.motionBlur !== undefined) validateMotionBlur(value.motionBlur, `${path}.motionBlur`, issues);
  if (value.blendMode !== undefined && !inList(value.blendMode, BLEND_MODES)) {
    addIssue(issues, "invalid_element", `${path}.blendMode`, "Blend mode is invalid.");
  }

  if (value.type === "text") {
    if (typeof value.text !== "string") addIssue(issues, "invalid_element", `${path}.text`, "Text must be a string.");
    if (value.animation !== undefined) validateTextAnimation(value.animation, `${path}.animation`, visibleEndMs - visibleStartMs, issues);
    if (value.fit !== undefined) validateTextFit(value.fit, `${path}.fit`, issues);
    if (value.counter !== undefined) validateCounter(value.counter, `${path}.counter`, visibleEndMs - visibleStartMs, issues);
    if (!isRecord(value.style) || !nonEmptyString(value.style.token)) {
      addIssue(issues, "invalid_element", `${path}.style`, "Text style reference is required.");
    } else if (!(value.style.token in typography)) {
      addIssue(issues, "missing_reference", `${path}.style.token`, "Typography token does not exist.");
    } else if (value.style.overrides !== undefined && !isRecord(value.style.overrides)) {
      addIssue(issues, "invalid_element", `${path}.style.overrides`, "Text style overrides must be an object.");
    } else if (isRecord(value.style.overrides) && value.style.overrides.color !== undefined) {
      // Text colour, CSS `color` — cannot take a gradient.
      validateColorValue(value.style.overrides.color, `${path}.style.overrides.color`, colors, issues, false);
    }
    return;
  }

  if (value.type === "image") {
    if (!nonEmptyString(value.assetId)) addIssue(issues, "missing_reference", `${path}.assetId`, "Image asset id is required.");
    if (!inList(value.fit, ["cover", "contain", "fill"])) addIssue(issues, "invalid_element", `${path}.fit`, "Image fit is invalid.");
    if (value.crop !== undefined) validateCrop(value.crop, `${path}.crop`, issues);
    if (value.borderRadius !== undefined && (!isFiniteNumber(value.borderRadius) || value.borderRadius < 0)) addIssue(issues, "invalid_element", `${path}.borderRadius`, "Border radius must be non-negative.");
    return;
  }

  if (value.type === "video") {
    if (!nonEmptyString(value.assetId)) addIssue(issues, "missing_reference", `${path}.assetId`, "Video asset id is required.");
    if (!inList(value.fit, ["cover", "contain", "fill"])) addIssue(issues, "invalid_element", `${path}.fit`, "Video fit is invalid.");
    if (value.crop !== undefined) validateCrop(value.crop, `${path}.crop`, issues);
    if (!isInteger(value.sourceStartMs) || value.sourceStartMs < 0) addIssue(issues, "invalid_element", `${path}.sourceStartMs`, "Video source start must be a non-negative integer.");
    if (value.sourceEndMs !== undefined && (!isInteger(value.sourceEndMs) || !isInteger(value.sourceStartMs) || value.sourceEndMs <= value.sourceStartMs)) addIssue(issues, "invalid_element", `${path}.sourceEndMs`, "Video source end must be greater than source start.");
    if (value.speedRamp !== undefined) validateSpeedRamp(value.speedRamp, `${path}.speedRamp`, issues);
    if (value.freezeAtSourceMs !== undefined) {
      if (!isFiniteNumber(value.freezeAtSourceMs) || value.freezeAtSourceMs < 0) {
        addIssue(issues, "invalid_element", `${path}.freezeAtSourceMs`, "Freeze point must be a non-negative source millisecond.");
      } else if (isFiniteNumber(value.sourceStartMs) && value.freezeAtSourceMs < value.sourceStartMs) {
        addIssue(issues, "invalid_element", `${path}.freezeAtSourceMs`, "Freeze point must be at or after the clip source start.");
      } else if (value.sourceEndMs !== undefined && isFiniteNumber(value.sourceEndMs) && value.freezeAtSourceMs >= value.sourceEndMs) {
        addIssue(issues, "invalid_element", `${path}.freezeAtSourceMs`, "Freeze point must be before the clip source end.");
      }
    }
    if (!isFiniteNumber(value.volume) || value.volume < 0 || value.volume > 1) addIssue(issues, "invalid_element", `${path}.volume`, "Video volume must be between zero and one.");
    if (!isFiniteNumber(value.playbackRate) || value.playbackRate <= 0) addIssue(issues, "invalid_element", `${path}.playbackRate`, "Playback rate must be positive.");
    return;
  }

  if (value.type === "ui") {
    validateUiElement(value, path, visibleStartMs, visibleEndMs, colors, typography, issues);
    return;
  }

  if (value.type === "shape") {
    if (!inList(value.shape, ["rect", "ellipse"])) addIssue(issues, "invalid_element", `${path}.shape`, "Shape kind is invalid.");
    // Renders as CSS `background`, so a gradient fill is the headline case
    // this feature exists for.
    validateColorValue(value.fill, `${path}.fill`, colors, issues, true);
    if (value.gradientAnimation !== undefined) {
      if (!isRecord(value.fill) || value.fill.kind !== "gradient" || !isRecord(value.fill.gradient)) {
        addIssue(issues, "invalid_animation", `${path}.gradientAnimation`, "Gradient animation requires a gradient shape fill.");
      } else {
        validateGradientAnimation(value.gradientAnimation, `${path}.gradientAnimation`, value.fill.gradient, visibleStartMs, visibleEndMs, colors, issues);
      }
    }
    if (value.stroke !== undefined) validateStroke(value.stroke, `${path}.stroke`, colors, issues);
    if (value.borderRadius !== undefined && (!isFiniteNumber(value.borderRadius) || value.borderRadius < 0)) addIssue(issues, "invalid_element", `${path}.borderRadius`, "Border radius must be non-negative.");
    if (value.morph !== undefined) validateShapeMorph(value.morph, `${path}.morph`, visibleEndMs - visibleStartMs, issues);
    return;
  }

  if (value.type === "connector") {
    if (!nonEmptyString(value.fromElementId)) addIssue(issues, "missing_reference", `${path}.fromElementId`, "Connector source id is required.");
    if (!nonEmptyString(value.toElementId)) addIssue(issues, "missing_reference", `${path}.toElementId`, "Connector destination id is required.");
    if (value.fromElementId === value.toElementId) addIssue(issues, "invalid_element", `${path}.toElementId`, "Connector endpoints must be different elements.");
    if (!inList(value.curve, CONNECTOR_CURVES)) addIssue(issues, "invalid_element", `${path}.curve`, "Connector curve is invalid.");
    validateStroke(value.stroke, `${path}.stroke`, colors, issues);
    if (value.drawProgress !== undefined && (!isFiniteNumber(value.drawProgress) || value.drawProgress < 0 || value.drawProgress > 1)) {
      addIssue(issues, "invalid_element", `${path}.drawProgress`, "Connector draw progress must be between zero and one.");
    }
    return;
  }

  if (value.type === "chart") {
    if (!inList(value.chartKind, CREATIVE_CHART_KINDS)) {
      addIssue(issues, "invalid_element", `${path}.chartKind`, "Chart kind is invalid.");
    }
    const seriesValid = Array.isArray(value.series) && value.series.length > 0 && value.series.every(isFiniteNumber);
    if (!seriesValid) {
      addIssue(issues, "invalid_element", `${path}.series`, "Chart series must be a non-empty array of finite numbers.");
    }
    if (value.axisMin !== undefined && !isFiniteNumber(value.axisMin)) {
      addIssue(issues, "invalid_element", `${path}.axisMin`, "Chart axis minimum must be finite.");
    }
    if (value.axisMax !== undefined && !isFiniteNumber(value.axisMax)) {
      addIssue(issues, "invalid_element", `${path}.axisMax`, "Chart axis maximum must be finite.");
    }
    if (isFiniteNumber(value.axisMin) && isFiniteNumber(value.axisMax) && value.axisMin > value.axisMax) {
      addIssue(issues, "invalid_element", `${path}.axisMax`, "Chart axis bounds are inverted: axisMin must not exceed axisMax.");
    }
    if (value.drawProgress !== undefined && (!isFiniteNumber(value.drawProgress) || value.drawProgress < 0 || value.drawProgress > 1)) {
      addIssue(issues, "invalid_element", `${path}.drawProgress`, "Chart draw progress must be between zero and one.");
    }
    if (value.fillProgress !== undefined && (!isFiniteNumber(value.fillProgress) || value.fillProgress < 0 || value.fillProgress > 1)) {
      addIssue(issues, "invalid_element", `${path}.fillProgress`, "Chart fill progress must be between zero and one.");
    }
    if (value.staggerPoints !== undefined && (!isFiniteNumber(value.staggerPoints) || value.staggerPoints < 0 || value.staggerPoints > 1)) {
      addIssue(issues, "invalid_element", `${path}.staggerPoints`, "Chart staggerPoints must be between zero and one.");
    }
    if (value.chartKind === "donut" && Array.isArray(value.series) && value.series.some((entry) => !isFiniteNumber(entry) || entry < 0)) {
      addIssue(issues, "invalid_element", `${path}.series`, "Donut chart values must be non-negative finite numbers.");
    }
    validateStroke(value.stroke, `${path}.stroke`, colors, issues);
    // A chart's fill renders as an SVG fill attribute, not a CSS background,
    // so it cannot take a gradient function either.
    if (value.fill !== undefined) validateColorValue(value.fill, `${path}.fill`, colors, issues, false);
    const seriesLength = Array.isArray(value.series) ? value.series.length : 0;
    if (value.axes !== undefined) validateChartAxes(value.axes, `${path}.axes`, seriesLength, issues);
    if (value.callouts !== undefined) validateChartCallouts(value.callouts, `${path}.callouts`, seriesLength, visibleStartMs, visibleEndMs, issues);
    if ((value.axes !== undefined || value.callouts !== undefined) && value.labelStyle !== undefined) {
      if (!isRecord(value.labelStyle) || !nonEmptyString(value.labelStyle.token)) {
        addIssue(issues, "invalid_element", `${path}.labelStyle`, "Chart label style reference is required.");
      } else if (!(value.labelStyle.token in typography)) {
        addIssue(issues, "missing_reference", `${path}.labelStyle.token`, "Typography token does not exist.");
      }
    }
    // Chart text has no element of its own to inherit from, so a chart that
    // asks for labels and gives no style would render nothing and look like a
    // layout bug rather than a missing field.
    const wantsText = isRecord(value.axes)
      && (value.axes.categories !== undefined || value.axes.valueLabels === true || (value.axes.yTicks as number) >= 2);
    if ((wantsText || (Array.isArray(value.callouts) && value.callouts.length > 0)) && value.labelStyle === undefined) {
      addIssue(issues, "invalid_element", `${path}.labelStyle`, "Chart labels require labelStyle.");
    }
    if (value.pointEmphasis !== undefined) {
      validateChartPointEmphasis(
        value.pointEmphasis,
        `${path}.pointEmphasis`,
        seriesValid ? (value.series as unknown[]).length : 0,
        colors,
        issues,
      );
    }
    return;
  }

  if (value.type === "composite") {
    // Fresh the moment a composite is first reached from a scene's own
    // elements (depth 0, no inherited Set yet); reused unchanged for every
    // nested composite descendant, so ids stay unique across the WHOLE
    // subtree of the outermost composite rather than resetting per level.
    validateCompositeElement(value, path, sceneDurationMs, colors, typography, issues, depth, compositeIds ?? new Set<string>());
    return;
  }

  addIssue(issues, "invalid_element", `${path}.type`, "Element type is not supported by V1.");
}

/**
 * Total descendants (children, grandchildren, ...) of a composite's
 * `children` array, regardless of shape - the structural counterpart to
 * `countUiNodes` just above, operating on the same not-yet-typed `unknown`
 * shape validation always works against. Kept separate from
 * `collectCreativeCompositeDescendants` in composite.ts, which walks an
 * already-validated, fully-typed CreativeCompositeElement and has no business
 * being handed a document that has not passed this check yet - the same
 * separation `countUiNodes` (here) and `countCreativeUiNodes` (ui-element.ts)
 * already keep.
 */
function countCompositeDescendants(children: unknown[]): number {
  return children.reduce<number>((total, child) => {
    if (!isRecord(child)) return total + 1;
    const grandchildren = child.type === "composite" && Array.isArray(child.children) ? child.children : [];
    return total + 1 + countCompositeDescendants(grandchildren);
  }, 0);
}

/**
 * A `composite` element: a fixed local viewport (validated exactly like
 * `ui`'s - same size ceiling, CREATIVE_UI_MAX_VIEWPORT, reused rather than
 * duplicated) holding real element children, each validated by this very
 * function one level deeper. See the design-decision comment on
 * CreativeCompositeElement in schema.ts for why this exists instead of
 * nested groups, and why connector is the one child type excluded.
 */
function validateCompositeElement(
  value: RecordValue,
  path: string,
  sceneDurationMs: number,
  colors: Record<string, string>,
  typography: Record<string, unknown>,
  issues: CreativeValidationIssue[],
  depth: number,
  ids: Set<string>,
) {
  if (depth >= CREATIVE_COMPOSITE_MAX_DEPTH) {
    addIssue(issues, "invalid_element", path, `Composite elements may not nest deeper than ${CREATIVE_COMPOSITE_MAX_DEPTH} levels.`);
    return;
  }

  if (!isRecord(value.viewport)) {
    addIssue(issues, "invalid_element", `${path}.viewport`, "Composite viewport must be an object.");
  } else {
    for (const key of ["width", "height"] as const) {
      const size = value.viewport[key];
      if (!isInteger(size) || size <= 0 || size > CREATIVE_UI_MAX_VIEWPORT) {
        addIssue(issues, "invalid_element", `${path}.viewport.${key}`, `Composite viewport ${key} must be an integer from 1 to ${CREATIVE_UI_MAX_VIEWPORT}.`);
      }
    }
  }

  if (!Array.isArray(value.children) || value.children.length === 0) {
    addIssue(issues, "invalid_element", `${path}.children`, "A composite element requires at least one child.");
    return;
  }
  if (countCompositeDescendants(value.children) > CREATIVE_COMPOSITE_MAX_DESCENDANTS) {
    addIssue(
      issues,
      "invalid_element",
      `${path}.children`,
      `A composite's whole tree may not contain more than ${CREATIVE_COMPOSITE_MAX_DESCENDANTS} elements.`,
    );
    return;
  }

  value.children.forEach((child, index) => {
    const childPath = `${path}.children[${index}]`;
    if (isRecord(child) && nonEmptyString(child.id)) {
      if (ids.has(child.id)) {
        addIssue(issues, "duplicate_id", `${childPath}.id`, "Composite child id is duplicated within this composite's own tree.");
      } else {
        ids.add(child.id);
      }
    }
    if (isRecord(child) && child.type === "connector") {
      // Named explicitly rather than left to the generic "not supported"
      // fallback: this IS a real element type, only not a valid child here,
      // because a connector addresses scene-level element ids
      // (fromElementId/toElementId) and a composite child has no such id to
      // be pointed at.
      addIssue(
        issues,
        "invalid_element",
        `${childPath}.type`,
        "A connector cannot be a composite child - it addresses scene-level element ids, which a composite child is not.",
      );
      return;
    }
    validateElement(child, childPath, sceneDurationMs, colors, typography, issues, depth + 1, ids);
  });
}

function validateJsonValue(value: unknown, path: string, issues: CreativeValidationIssue[]) {
  if (value === null || typeof value === "string" || typeof value === "boolean") return;
  if (typeof value === "number") {
    if (!Number.isFinite(value)) addIssue(issues, "invalid_document", path, "Metadata numbers must be finite.");
    return;
  }
  if (Array.isArray(value)) {
    value.forEach((item, index) => validateJsonValue(item, `${path}[${index}]`, issues));
    return;
  }
  if (isRecord(value)) {
    Object.entries(value).forEach(([key, item]) => validateJsonValue(item, `${path}.${key}`, issues));
    return;
  }
  addIssue(issues, "invalid_document", path, "Metadata must be JSON serializable.");
}

function validateAudioClips(value: unknown, path: string, issues: CreativeValidationIssue[]) {
  if (!Array.isArray(value)) {
    addIssue(issues, "invalid_document", path, "Audio must be an array of clips.");
    return;
  }
  const ids = new Set<string>();
  value.forEach((clip, index) => {
    const clipPath = `${path}[${index}]`;
    if (!isRecord(clip)) {
      addIssue(issues, "invalid_document", clipPath, "Audio clip must be an object.");
      return;
    }
    if (!nonEmptyString(clip.id)) {
      addIssue(issues, "invalid_document", `${clipPath}.id`, "Audio clip id is required.");
    } else if (ids.has(clip.id)) {
      addIssue(issues, "duplicate_id", `${clipPath}.id`, "Audio clip id is duplicated.");
    } else {
      ids.add(clip.id);
    }
    if (typeof clip.name !== "string") addIssue(issues, "invalid_document", `${clipPath}.name`, "Audio clip name must be a string.");
    if (!nonEmptyString(clip.assetId)) addIssue(issues, "missing_reference", `${clipPath}.assetId`, "Audio clip asset id is required.");
    if (!inList(clip.kind, CREATIVE_AUDIO_KINDS)) addIssue(issues, "invalid_document", `${clipPath}.kind`, "Audio clip kind is invalid.");
    if (!isInteger(clip.startMs) || clip.startMs < 0) addIssue(issues, "invalid_timing", `${clipPath}.startMs`, "Audio clip start must be a non-negative integer.");
    if (!isInteger(clip.endMs) || !isInteger(clip.startMs) || clip.endMs <= clip.startMs) addIssue(issues, "invalid_timing", `${clipPath}.endMs`, "Audio clip end must be greater than its start.");
    if (!isInteger(clip.sourceStartMs) || clip.sourceStartMs < 0) addIssue(issues, "invalid_timing", `${clipPath}.sourceStartMs`, "Audio clip source start must be a non-negative integer.");
    if (!isFiniteNumber(clip.gain) || clip.gain < 0 || clip.gain > 2) addIssue(issues, "invalid_document", `${clipPath}.gain`, "Audio clip gain must be between zero and two.");
    for (const key of ["fadeInMs", "fadeOutMs"] as const) {
      if (clip[key] !== undefined && (!isInteger(clip[key]) || (clip[key] as number) < 0)) {
        addIssue(issues, "invalid_timing", `${clipPath}.${key}`, `Audio clip ${key} must be a non-negative integer.`);
      }
    }
    // A fade longer than the clip would never reach full gain.
    if (isInteger(clip.startMs) && isInteger(clip.endMs) && clip.endMs > clip.startMs) {
      const durationMs = clip.endMs - clip.startMs;
      for (const key of ["fadeInMs", "fadeOutMs"] as const) {
        if (isInteger(clip[key]) && (clip[key] as number) > durationMs) {
          addIssue(issues, "invalid_timing", `${clipPath}.${key}`, `Audio clip ${key} cannot exceed the clip duration.`);
        }
      }
    }
    if (clip.gainKeyframes !== undefined) {
      if (!Array.isArray(clip.gainKeyframes) || clip.gainKeyframes.length === 0) {
        addIssue(issues, "invalid_animation", `${clipPath}.gainKeyframes`, "Gain automation must be a non-empty array.");
      } else {
        let previousTime = -1;
        clip.gainKeyframes.forEach((point, pointIndex) => {
          const pointPath = `${clipPath}.gainKeyframes[${pointIndex}]`;
          if (!isRecord(point)) {
            addIssue(issues, "invalid_animation", pointPath, "Gain keyframe must be an object.");
            return;
          }
          if (!isInteger(point.timeMs) || point.timeMs <= previousTime) {
            addIssue(issues, "invalid_animation", `${pointPath}.timeMs`, "Gain keyframe times must be ordered.");
          }
          if (isInteger(point.timeMs)) previousTime = point.timeMs;
          if (!isFiniteNumber(point.gain) || point.gain < 0 || point.gain > 2) {
            addIssue(issues, "invalid_animation", `${pointPath}.gain`, "Gain must be between zero and two.");
          }
        });
      }
    }
    if (clip.duckToGain !== undefined && (!isFiniteNumber(clip.duckToGain) || clip.duckToGain < 0 || clip.duckToGain > 1)) {
      addIssue(issues, "invalid_document", `${clipPath}.duckToGain`, "Audio duck gain must be between zero and one.");
    }
  });
}

function validateMarkers(value: unknown, path: string, issues: CreativeValidationIssue[]) {
  if (!Array.isArray(value)) {
    addIssue(issues, "invalid_document", path, "Markers must be an array.");
    return;
  }
  const ids = new Set<string>();
  value.forEach((marker, index) => {
    const markerPath = `${path}[${index}]`;
    if (!isRecord(marker)) {
      addIssue(issues, "invalid_document", markerPath, "Marker must be an object.");
      return;
    }
    if (!nonEmptyString(marker.id)) {
      addIssue(issues, "invalid_document", `${markerPath}.id`, "Marker id is required.");
    } else if (ids.has(marker.id)) {
      addIssue(issues, "duplicate_id", `${markerPath}.id`, "Marker id is duplicated.");
    } else {
      ids.add(marker.id);
    }
    if (!isInteger(marker.timeMs) || marker.timeMs < 0) {
      addIssue(issues, "invalid_timing", `${markerPath}.timeMs`, "Marker time must be a non-negative integer.");
    }
    if (!inList(marker.kind, CREATIVE_MARKER_KINDS)) {
      addIssue(issues, "invalid_document", `${markerPath}.kind`, "Marker kind is invalid.");
    }
    if (marker.label !== undefined && typeof marker.label !== "string") {
      addIssue(issues, "invalid_document", `${markerPath}.label`, "Marker label must be a string.");
    }
  });
}

export function validateCreativeDocument(input: unknown): CreativeValidationResult {
  const issues: CreativeValidationIssue[] = [];
  if (!isRecord(input)) {
    addIssue(issues, "invalid_document", "", "Creative document must be an object.");
    return { valid: false, issues };
  }

  if (input.version !== 1) addIssue(issues, "unsupported_version", "version", "Only CreativeDocument version 1 is supported.");
  if (!nonEmptyString(input.id)) addIssue(issues, "invalid_document", "id", "Document id is required.");
  if (typeof input.title !== "string") addIssue(issues, "invalid_document", "title", "Document title must be a string.");

  const design = validateDesignSystem(input.designSystem, "designSystem", issues);

  if (!isRecord(input.canvas)) {
    addIssue(issues, "invalid_canvas", "canvas", "Canvas must be an object.");
  } else {
    if (!isInteger(input.canvas.width) || input.canvas.width <= 0 || input.canvas.width > CREATIVE_CANVAS_MAX_DIMENSION) addIssue(issues, "invalid_canvas", "canvas.width", `Canvas width must be an integer from 1 to ${CREATIVE_CANVAS_MAX_DIMENSION}.`);
    if (!isInteger(input.canvas.height) || input.canvas.height <= 0 || input.canvas.height > CREATIVE_CANVAS_MAX_DIMENSION) addIssue(issues, "invalid_canvas", "canvas.height", `Canvas height must be an integer from 1 to ${CREATIVE_CANVAS_MAX_DIMENSION}.`);
    if (!isInteger(input.canvas.fps) || input.canvas.fps < 1 || input.canvas.fps > 120) addIssue(issues, "invalid_canvas", "canvas.fps", "Canvas fps must be an integer from 1 to 120.");
    // Renders as CSS `background`.
    validateColorValue(input.canvas.background, "canvas.background", design.colors, issues, true);
  }

  if (!Array.isArray(input.scenes) || input.scenes.length === 0) {
    addIssue(issues, "invalid_document", "scenes", "Creative document requires at least one scene.");
  } else {
    const sceneIds = new Set<string>();
    const elementAliases = new Set<string>();
    input.scenes.forEach((scene, sceneIndex) => {
      const scenePath = `scenes[${sceneIndex}]`;
      if (!isRecord(scene)) {
        addIssue(issues, "invalid_scene", scenePath, "Scene must be an object.");
        return;
      }
      if (!nonEmptyString(scene.id)) {
        addIssue(issues, "invalid_scene", `${scenePath}.id`, "Scene id is required.");
      } else if (sceneIds.has(scene.id)) {
        addIssue(issues, "duplicate_id", `${scenePath}.id`, "Scene id is duplicated.");
      } else {
        sceneIds.add(scene.id);
      }
      if (typeof scene.name !== "string") addIssue(issues, "invalid_scene", `${scenePath}.name`, "Scene name must be a string.");
      const sceneDurationMs = isInteger(scene.durationMs) && scene.durationMs > 0 ? scene.durationMs : 0;
      if (sceneDurationMs === 0) addIssue(issues, "invalid_scene", `${scenePath}.durationMs`, "Scene duration must be a positive integer.");
      // Renders as CSS `background`.
      if (scene.background !== undefined) validateColorValue(scene.background, `${scenePath}.background`, design.colors, issues, true);
      if (scene.transitionOut !== undefined) validateTransition(scene.transitionOut, `${scenePath}.transitionOut`, sceneDurationMs, issues);
      if (scene.camera !== undefined) validateCamera(scene.camera, `${scenePath}.camera`, sceneDurationMs, issues);

      const elementIds = new Set<string>();
      const elementRecords = new Map<string, RecordValue>();
      if (!Array.isArray(scene.elements)) {
        addIssue(issues, "invalid_scene", `${scenePath}.elements`, "Scene elements must be an array.");
      } else {
        scene.elements.forEach((element, elementIndex) => {
          const elementPath = `${scenePath}.elements[${elementIndex}]`;
          if (isRecord(element) && nonEmptyString(element.id)) {
            if (elementIds.has(element.id)) addIssue(issues, "duplicate_id", `${elementPath}.id`, "Element id is duplicated.");
            else { elementIds.add(element.id); elementRecords.set(element.id, element); }
          }
          if (isRecord(element) && nonEmptyString(element.alias)) {
            if (elementAliases.has(element.alias)) addIssue(issues, "duplicate_id", `${elementPath}.alias`, "Element alias must be unique across the project.");
            else elementAliases.add(element.alias);
          }
          validateElement(element, elementPath, sceneDurationMs, design.colors, design.typography, issues);
        });
      }

      for (const [elementId, element] of elementRecords) {
        if (element.type !== "connector") continue;
        for (const [field, target] of [["fromElementId", element.fromElementId], ["toElementId", element.toElementId]] as const) {
          if (!nonEmptyString(target) || !elementIds.has(target)) {
            addIssue(issues, "missing_reference", `${scenePath}.elements.${elementId}.${field}`, "Connector endpoint must exist in the same scene.");
          } else if (elementRecords.get(target)?.type === "connector") {
            addIssue(issues, "invalid_element", `${scenePath}.elements.${elementId}.${field}`, "A connector endpoint must be a visual node, not another connector.");
          }
        }
      }

      const groupIds = new Set<string>();
      const groupedElements = new Set<string>();
      if (!Array.isArray(scene.groups)) {
        addIssue(issues, "invalid_scene", `${scenePath}.groups`, "Scene groups must be an array.");
      } else {
        scene.groups.forEach((group, groupIndex) => {
          const groupPath = `${scenePath}.groups[${groupIndex}]`;
          if (!isRecord(group)) {
            addIssue(issues, "invalid_group", groupPath, "Group must be an object.");
            return;
          }
          if (!nonEmptyString(group.id)) {
            addIssue(issues, "invalid_group", `${groupPath}.id`, "Group id is required.");
          } else if (groupIds.has(group.id)) {
            addIssue(issues, "duplicate_id", `${groupPath}.id`, "Group id is duplicated.");
          } else {
            groupIds.add(group.id);
          }
          if (typeof group.name !== "string") addIssue(issues, "invalid_group", `${groupPath}.name`, "Group name must be a string.");
          if (group.locked !== undefined && typeof group.locked !== "boolean") addIssue(issues, "invalid_group", `${groupPath}.locked`, "Group locked must be a boolean.");
          if (group.hidden !== undefined && typeof group.hidden !== "boolean") addIssue(issues, "invalid_group", `${groupPath}.hidden`, "Group hidden must be a boolean.");
          if (group.transform !== undefined) validateHierarchyTransform(group.transform, `${groupPath}.transform`, issues);
          if (group.animations !== undefined) validateAnimations(group.animations, `${groupPath}.animations`, 0, sceneDurationMs, issues);
          if (!Array.isArray(group.elementIds) || group.elementIds.length === 0) {
            addIssue(issues, "invalid_group", `${groupPath}.elementIds`, "Group requires at least one element.");
            return;
          }
          const localIds = new Set<string>();
          group.elementIds.forEach((elementId, elementIdIndex) => {
            const memberPath = `${groupPath}.elementIds[${elementIdIndex}]`;
            if (!nonEmptyString(elementId) || !elementIds.has(elementId)) {
              addIssue(issues, "missing_reference", memberPath, "Grouped element does not exist in this scene.");
              return;
            }
            if (elementRecords.get(elementId)?.type === "connector") {
              addIssue(issues, "invalid_group", memberPath, "Connectors are scene overlays and cannot belong to groups.");
              return;
            }
            if (localIds.has(elementId) || groupedElements.has(elementId)) {
              addIssue(issues, "invalid_group", memberPath, "An element can belong to at most one group in V1.");
              return;
            }
            localIds.add(elementId);
            groupedElements.add(elementId);
          });
        });
      }
    });
  }

  if (input.audio !== undefined) validateAudioClips(input.audio, "audio", issues);
  if (input.markers !== undefined) validateMarkers(input.markers, "markers", issues);
  if (input.metadata !== undefined) validateJsonValue(input.metadata, "metadata", issues);

  // A continuation that cannot happen is a silent visual bug: the morph reads
  // as a cut and nothing anywhere says why. Rejecting it here means the error
  // arrives while the author is still holding the intent, and the message names
  // the transition to lengthen rather than only the fault. Only run once the
  // scenes themselves are sound, so a broken document reports its real problem
  // instead of a cascade of downstream ones.
  if (issues.length === 0 && Array.isArray(input.groupContinuations)) {
    for (const issue of inspectGroupContinuations(input as never)) {
      addIssue(issues, "invalid_transition", `groupContinuations.${issue.continuationId}`, issue.message);
    }
  }

  if (issues.length === 0 && Array.isArray(input.continuations)) {
    for (const issue of inspectContinuations(input as never)) {
      // invalid_transition rather than a new code: a continuation lives inside
      // a transition's overlap, and lengthening that transition is almost
      // always the fix the message is pointing at.
      addIssue(issues, "invalid_transition", `continuations.${issue.continuationId}`, issue.message);
    }
  }

  return { valid: issues.length === 0, issues };
}
