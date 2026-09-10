export type JsonPrimitive = string | number | boolean | null;
export type JsonValue = JsonPrimitive | JsonValue[] | { [key: string]: JsonValue };

export type CreativeDocumentVersion = 1;

export const GRADIENT_KINDS = ["linear", "radial", "conic"] as const;
export type GradientKind = (typeof GRADIENT_KINDS)[number];

/**
 * One color at a position along a gradient.
 *
 * `offset` is normalized 0..1, matching every other position in this schema
 * (crop, mask, anchor) rather than a CSS percentage — translating it is
 * `lib/creative/gradient.ts`'s job, not the author's. Stops need not be
 * pre-sorted; the resolver orders them by offset, so inserting one new stop
 * never requires re-ordering the rest.
 *
 * `color` is literal or token only, never itself a gradient — a stop has to
 * resolve to one CSS `<color>`, so nesting is rejected the same way a
 * gradient is rejected anywhere else only a flat colour can render.
 */
export interface GradientStop {
  offset: number;
  color: ColorValue;
}

/**
 * Linear, radial or conic gradient, resolved to a CSS gradient function by
 * `lib/creative/gradient.ts`.
 *
 * `angle` is degrees, CSS convention (0 = up, clockwise), and applies to
 * linear and conic. `centerX`/`centerY` are normalized 0..1 against the
 * element's own box, matching the mask and pivot conventions elsewhere, and
 * apply to radial and conic. A field the chosen kind does not use is ignored
 * rather than rejected — the same tolerance `hierarchy.ts` gives an animation
 * track a camera does not own — so a preset built for one kind degrades
 * gracefully if reused for another.
 */
export interface ColorGradient {
  kind: GradientKind;
  /** At least two. */
  stops: GradientStop[];
  angle?: number;
  centerX?: number;
  centerY?: number;
}

export type FlatColorValue =
  | { kind: "literal"; value: string }
  | { kind: "token"; token: string };

export type ColorValue = FlatColorValue | { kind: "gradient"; gradient: ColorGradient };

/** One colour keyframe inside a gradient stop. */
export interface GradientColorKeyframe {
  timeMs: number;
  color: FlatColorValue;
  easing: EasingSpec;
}

/** Animates one existing stop without replacing the whole gradient. */
export interface GradientStopAnimation {
  stopIndex: number;
  offset?: AnimationKeyframe[];
  colorKeyframes?: GradientColorKeyframe[];
}

/** Dedicated gradient animation without widening numeric ElementAnimation. */
export interface CreativeGradientAnimation {
  angle?: AnimationKeyframe[];
  centerX?: AnimationKeyframe[];
  centerY?: AnimationKeyframe[];
  stops?: GradientStopAnimation[];
}

export type TextAlign = "left" | "center" | "right";

export interface TextStyleToken {
  fontFamily: string;
  fontSize: number;
  fontWeight: number;
  lineHeight: number;
  letterSpacing: number;
  align: TextAlign;
  color: ColorValue;
}

export interface TextStyleRef {
  token: string;
  overrides?: Partial<TextStyleToken>;
}

export interface StrokeToken {
  width: number;
  color: ColorValue;
}

export interface CreativeMediaDirection {
  photographicStyle?: string;
  lighting?: string;
  subjectTreatment?: string;
  negativeSpace?: string;
  motionIntensity?: "low" | "medium" | "high";
  avoid?: string[];
  audioCharacter?: string;
}

export const EASING_NAMES = [
  "linear",
  "ease-in",
  "ease-out",
  "ease-in-out",
  "spring-soft",
  "spring-snappy",
] as const;

export type EasingName = (typeof EASING_NAMES)[number];

/**
 * Custom easing curve, matching the CSS `cubic-bezier(x1, y1, x2, y2)` form.
 * x values are clamped to 0..1; y may overshoot to allow anticipation and
 * follow-through.
 */
export interface CubicBezierEasing {
  kind: "cubic-bezier";
  x1: number;
  y1: number;
  x2: number;
  y2: number;
}

/**
 * Anywhere an easing is accepted, either a named preset or a custom curve
 * will do. Documents written before custom curves existed use the string
 * form and keep working unchanged.
 */
export type EasingSpec = EasingName | CubicBezierEasing;

export const ANIMATION_PROPERTIES = [
  "x",
  "y",
  "scaleX",
  "scaleY",
  "rotation",
  "opacity",
  "z",
  "rotationX",
  "rotationY",
  // Animated crop drives reframes and punch-ins on image and video elements.
  // Values are normalized 0..1 like CropRect itself.
  "cropX",
  "cropY",
  "cropWidth",
  "cropHeight",
  // Blur is a compositional device, not only a grade: focus pulls, depth
  // stacking and glass interstitials all animate it. Pixels, >= 0.
  "blurPx",
  // Reveals a chart's line/bars as it draws. 0..1, clamped. Only chart
  // elements own it; a track for it on anything else is ignored, like any
  // property a target does not have.
  "drawProgress",
  // Reveals an area chart's fill under the curve, independently of
  // drawProgress - so the line can finish drawing and the fill can catch up
  // after, or the two can run together. Meaningful only for chartKind
  // "area"; ignored elsewhere. 0..1, clamped.
  "fillProgress",
] as const;

export type AnimationProperty = (typeof ANIMATION_PROPERTIES)[number];

export interface AnimationKeyframe {
  timeMs: number;
  value: number;
  easing: EasingSpec;
}

export interface ElementAnimation {
  id: string;
  property: AnimationProperty;
  keyframes: AnimationKeyframe[];
}

export type MotionValueMode = "absolute" | "delta" | "multiplier";

export interface MotionPresetTrack {
  property: AnimationProperty;
  mode: MotionValueMode;
  from: number;
  to: number;
}

export interface MotionPreset {
  durationMs: number;
  easing: EasingSpec;
  tracks: MotionPresetTrack[];
}

export const SCENE_TRANSITION_KINDS = [
  "cut",
  "fade",
  "slide-left",
  "slide-right",
  "wipe-left",
  "push-left",
  "push-right",
  "push-up",
  "zoom-in",
  "zoom-out",
  "blur",
  "flash",
  "whip-left",
  "whip-right",
] as const;

export type SceneTransitionKind = (typeof SCENE_TRANSITION_KINDS)[number];

export interface SceneTransitionPreset {
  kind: SceneTransitionKind;
  durationMs: number;
  easing: EasingSpec;
}

export interface SceneTransition {
  kind: SceneTransitionKind;
  durationMs: number;
  easing: EasingSpec;
}

export interface CreativeMotionSystem {
  presets: Record<string, MotionPreset>;
  sceneTransitions: Record<string, SceneTransitionPreset>;
}

/**
 * A frosted-glass surface: backdrop blur, tint, hairline edge, top highlight
 * and shadow, resolved together so two panels authored a week apart are the
 * same material. See glass.ts for why these are one primitive rather than six
 * adjustments.
 */
export interface CreativeGlass {
  /** Backdrop blur in px. */
  blurPx: number;
  /** Tint laid over the blurred backdrop. Defaults to white. Cannot be a gradient. */
  tint?: ColorValue;
  /** 0..1 tint strength. Defaults to 0.12. */
  tintOpacity?: number;
  /** 0..1 hairline edge strength. Defaults to 0.18; zero hides it. */
  borderOpacity?: number;
  /** Corner radius in px. Omit to leave the element's own corners alone. */
  radius?: number;
  /** 0..1 specular along the top edge. Defaults to 0.25. */
  highlight?: number;
  /** Backdrop saturation multiplier. Defaults to 1.4 - glass enriches what shows through. */
  saturation?: number;
  /** 0..1 soft shadow beneath the panel. Defaults to 0.18. */
  shadow?: number;
}

export interface CreativeDesignSystem {
  colors: Record<string, string>;
  typography: Record<string, TextStyleToken>;
  spacing: Record<string, number>;
  radii: Record<string, number>;
  strokes: Record<string, StrokeToken>;
  motion: CreativeMotionSystem;
  mediaDirection?: CreativeMediaDirection;
}

/** Maximum width or height of a render canvas in pixels. */
export const CREATIVE_CANVAS_MAX_DIMENSION = 8192;

export interface CreativeCanvas {
  width: number;
  height: number;
  fps: number;
  background: ColorValue;
}

export interface ElementTiming {
  startMs: number;
  endMs: number;
}

export interface CreativeTransform {
  x: number;
  y: number;
  width: number;
  height: number;
  rotation: number;
  opacity: number;
  anchorX: number;
  anchorY: number;
  zIndex: number;
  /** Camera-space depth in pixels; zero preserves legacy 2D rendering. */
  z?: number;
  rotationX?: number;
  rotationY?: number;
}

/**
 * Deterministic visual adjustments applied to an element.
 *
 * Every field is neutral at zero, so an omitted or zeroed block costs
 * nothing and renders nothing. Ranges are documented per field and clamped
 * at resolution time — an out-of-range value is corrected, not rejected,
 * because a grade is a taste control rather than a structural one.
 */
export interface CreativeAdjustments {
  /** -1..1. Brightness around neutral. */
  exposure?: number;
  /** -1..1. */
  contrast?: number;
  /** -1..1. -1 is fully desaturated. */
  saturation?: number;
  /** -1..1. Positive warms, negative cools. */
  temperature?: number;
  /** Pixels, >= 0. */
  blurPx?: number;
  /** 0..1. Edge darkening. */
  vignette?: number;
  /** 0..1. Film grain opacity. */
  grain?: number;
  /** Pixels of backdrop blur behind this element; use with translucent fills for glass. */
  backdropBlurPx?: number;
  /** Backdrop saturation multiplier where 1 is neutral. */
  backdropSaturation?: number;
}

export const CREATIVE_MASK_KINDS = ["rect", "ellipse", "polygon"] as const;
export type CreativeMaskKind = (typeof CREATIVE_MASK_KINDS)[number];

/**
 * A mask limiting where an element is visible.
 *
 * Geometry is normalized 0..1 against the element's own box, so a mask
 * survives resizing the element. Invert flips which side is kept.
 *
 * Feather is a fraction of the mask's own extent on each axis, applied
 * independently — not of the shorter axis, which is what this comment claimed
 * for a long time while the code did something else. The softened band on one
 * edge is `feather / 2 * extent` on that axis:
 *
 *     a mask 0.4 tall with feather 0.3, on a 2100px element
 *     -> 0.3 / 2 * 0.4 * 2100 = 126px of fade at the top, and 126px at the bottom
 *
 * A wide flat band therefore feathers over a shorter distance vertically than
 * horizontally, which is usually what a scrim wants. Both kinds behave this
 * way: a rect composites one gradient per axis, and an ellipse's stops run
 * along each radius.
 */
export interface CreativeMask {
  kind: CreativeMaskKind;
  x: number;
  y: number;
  width: number;
  height: number;
  /** 0..1, fraction of the mask's extent on each axis. See above for the arithmetic. */
  feather?: number;
  invert?: boolean;
  /** Rounded-rect corner radius, normalized to the element's shorter side. Rect only. */
  radius?: number;
  /** Normalized points inside x/y/width/height. Polygon only; at least three. */
  points?: Array<{ x: number; y: number }>;
}

/**
 * Velocity-derived directional blur.
 *
 * `shutterAngle` follows the film convention: 180 degrees is a normal
 * cinematic shutter, higher smears more. Blur direction and strength come
 * from how fast the element is actually moving, so a still element costs
 * nothing.
 */
export interface CreativeMotionBlur {
  shutterAngle: number;
  /** Upper bound in pixels, so a fast move cannot smear into mush. */
  maxBlurPx?: number;
}

/**
 * CSS `mix-blend-mode` keywords this engine resolves. "normal" is included
 * explicitly, alongside being the value an omitted `blendMode` behaves as,
 * so an agent has an explicit way to set an element back to it rather than
 * only ever being able to clear the field.
 */
export const BLEND_MODES = [
  "normal",
  "multiply",
  "screen",
  "overlay",
  "darken",
  "lighten",
  "color-dodge",
  "color-burn",
  "hard-light",
  "soft-light",
  "difference",
  "exclusion",
  "hue",
  "saturation",
  "color",
  "luminosity",
] as const;
export type BlendMode = (typeof BLEND_MODES)[number];

export interface CreativeElementBase {
  id: string;
  name: string;
  /** Optional project-wide human/agent-friendly stable handle. */
  alias?: string;
  /** Semantic labels used by selectors; ids remain the canonical identity. */
  tags?: string[];
  transform: CreativeTransform;
  hidden?: boolean;
  locked?: boolean;
  /**
   * Marks an element as scenery rather than content. A background plate or a
   * scrim is deliberately full-bleed, so the layout inspector's out-of-canvas
   * and safe-area checks do not apply to it — reporting them buries the
   * warnings that do mean something.
   */
  role?: "background";
  timing?: ElementTiming;
  animations?: ElementAnimation[];
  adjustments?: CreativeAdjustments;
  /** Frosted-glass surface behind this element's own content. */
  glass?: CreativeGlass;
  mask?: CreativeMask;
  motionBlur?: CreativeMotionBlur;
  /**
   * Composites this element against whatever is behind it with a CSS
   * `mix-blend-mode`. Omitted behaves as "normal", so a document written
   * before this existed renders unchanged.
   */
  blendMode?: BlendMode;
}

export const TEXT_ANIMATION_GRANULARITIES = ["block", "line", "word", "character"] as const;
export type TextAnimationGranularity = (typeof TEXT_ANIMATION_GRANULARITIES)[number];

export const TEXT_ANIMATION_MODES = [
  "fade",
  "rise",
  "fall",
  "slide-left",
  "slide-right",
  "scale",
  "punch",
  "mask-reveal",
  "tracking",
] as const;
export type TextAnimationMode = (typeof TEXT_ANIMATION_MODES)[number];

/**
 * Kinetic typography: one animation description applied to every unit of a
 * text element, offset by `staggerMs` so the units cascade.
 */
export interface CreativeTextAnimation {
  granularity: TextAnimationGranularity;
  mode: TextAnimationMode;
  /** Offset of the whole run from the start of the element's visible window. */
  startMs: number;
  /** How long each individual unit takes. */
  durationMs: number;
  /** Delay between consecutive units. Zero animates them together. */
  staggerMs: number;
  easing: EasingSpec;
  /** Pixels for rise/fall/slide, or letter-spacing for tracking. Unused elsewhere. */
  distance?: number;
}

export const TEXT_FIT_MODES = ["none", "shrink"] as const;
export type TextFitMode = (typeof TEXT_FIT_MODES)[number];

/** Deterministic text fitting; estimates are shared by renderer and validator. */
export interface CreativeTextFit {
  mode: TextFitMode;
  minFontSize: number;
}

/**
 * Native counting-number text: interpolates between two values over a
 * duration and formats the result, so a count-up in a metrics scene is one
 * text element instead of the six or seven timed swaps it used to take -
 * three figures used to cost twenty elements.
 *
 * `startMs` is measured from the start of the element's own visible window,
 * matching CreativeTextAnimation.startMs - not scene-local, the one clock
 * apply_text_animation already differs on. Before startMs the element shows
 * `from`; once startMs + durationMs has passed it holds at `to` rather than
 * overshooting past it.
 *
 * `format` and `precision` share chart.ts's vocabulary (plain/compact/percent)
 * instead of a second copy of the same problem - a KPI counter and a chart's
 * value label both just need to write a number the same way on every machine.
 * `prefix`/`suffix` wrap the formatted number, e.g. "$" and " users".
 *
 * When present, `counter` is authoritative for what renders. The element's own
 * `text` stays the schema-required authored baseline - something sane for a
 * human editing the project to see, or for a caller that never resolves it -
 * but is not what preview or Remotion draw once a counter is set. Omit
 * `counter` entirely to go back to rendering `text` as authored.
 */
export interface CreativeTextCounter {
  from: number;
  to: number;
  /** Element-local milliseconds before the count begins. */
  startMs: number;
  durationMs: number;
  easing: EasingSpec;
  /** Defaults to "plain". */
  format?: ChartLabelFormat;
  /** Decimal places, 0-6. Defaults to 0. */
  precision?: number;
  /** Prepended to every rendered value, e.g. "$". */
  prefix?: string;
  /** Appended to every rendered value, e.g. "%" or " users". */
  suffix?: string;
}

export interface CreativeTextElement extends CreativeElementBase {
  type: "text";
  text: string;
  style: TextStyleRef;
  animation?: CreativeTextAnimation;
  fit?: CreativeTextFit;
  counter?: CreativeTextCounter;
}

export interface CropRect {
  x: number;
  y: number;
  width: number;
  height: number;
}

export type MediaFit = "cover" | "contain" | "fill";

export interface CreativeImageElement extends CreativeElementBase {
  type: "image";
  assetId: string;
  fit: MediaFit;
  crop?: CropRect;
  borderRadius?: number;
}

export interface CreativeSpeedKeyframe {
  /** Offset from the start of the clip's visible window. */
  atMs: number;
  /** Playback multiplier at this point. Must be positive. */
  speed: number;
}

/** At least two keyframes, ordered by time. */
export interface CreativeSpeedRamp {
  keyframes: CreativeSpeedKeyframe[];
}

export interface CreativeVideoElement extends CreativeElementBase {
  type: "video";
  assetId: string;
  sourceStartMs: number;
  sourceEndMs?: number;
  /**
   * Variable-speed playback. When present it supersedes `playbackRate`:
   * speed is interpolated linearly between keyframes and integrated over
   * time to find the source position, so a ramp consumes exactly the
   * footage the curve describes.
   */
  speedRamp?: CreativeSpeedRamp;
  /**
   * Hold a single source frame for the clip's whole visible window.
   * Resolved to an exact source millisecond so preview and final render
   * freeze on the same frame.
   */
  freezeAtSourceMs?: number;
  fit: MediaFit;
  crop?: CropRect;
  volume: number;
  playbackRate: number;
  muted?: boolean;
  loop?: boolean;
}

/**
 * One vertex of a shape outline, normalized against the element's own box -
 * 0,0 is the box's top-left corner and 1,1 its bottom-right, the same
 * convention CreativeMask's `polygon` kind already uses for point geometry.
 * Not clamped to 0..1 the way a mask's points are: a mask exists to redact
 * strictly within its own box, but a shape outline is free to spike past its
 * edges - a star whose points overshoot the box - so only finite coordinates
 * are required.
 */
export interface CreativeShapeOutlinePoint {
  x: number;
  y: number;
}

/**
 * A closed vector outline as a normalized point list. At least three points.
 *
 * DESIGN DECISION 1 - representation. A point list, not an SVG path string
 * with curve commands. CreativeMask already proved this shape works in this
 * schema (its `polygon` kind, points normalized to the owning box), and
 * chart.ts already proved this schema's convention of deriving SVG geometry
 * from small structured inputs rather than authoring path strings by hand. A
 * point list interpolates by construction: two lists of the same length lerp
 * coordinate by coordinate, and nothing about that operation can produce an
 * invalid path. An SVG path string with C/Q/A curve commands is strictly more
 * expressive - it can author a true circle or a rounded corner no polygon can
 * exactly reproduce - but morphing between two arbitrary path strings has no
 * general correct answer: different command counts, different curve types
 * and different control-point counts all have to be reconciled before the two
 * paths can be blended at all, and getting that reconciliation wrong produces
 * a shape that visibly tears rather than one that fails to compile. Be honest
 * about what this buys: every edge of a morphing shape is a straight line. A
 * circle, an ellipse, a rounded blob - any endpoint that wants a true curve -
 * is authored as a many-sided polygon standing in for one, not an arc. This
 * does not, and will not, advertise cubic-curve morphing.
 */
export interface CreativeShapeOutline {
  points: CreativeShapeOutlinePoint[];
}

/**
 * Deterministic outline morph: a shape element's own geometry interpolates
 * from `from` to `to` over an element-local window, resolved by the pure
 * `lib/creative/shape-morph.ts` so preview and Remotion draw the identical
 * outline on the identical frame - the same guarantee chart.ts's drawProgress
 * and counter.ts's count-up already give their own element types.
 *
 * Both `from` and `to` are explicit outlines rather than one authored shape
 * plus an implicit "whatever this element currently looks like": a triangle
 * becoming a hexagon is the case that exercises every hard part of this
 * feature (DESIGN DECISIONS 2 and 3 below), and an implicit starting shape
 * would hide that behind a rect/ellipse-to-polygon conversion this feature
 * does not need to have an opinion about. `shape`/`fill`/`stroke` still
 * describe the element's paint; `morph`, when present, replaces only how its
 * outline is drawn - `borderRadius` does not apply to a path built from
 * `from`/`to`, the same way a chart has no `borderRadius` of its own because
 * it draws its own geometry too.
 *
 * DESIGN DECISION 2 - point-count mismatch. `from` and `to` need not have the
 * same number of points (a triangle morphing into a hexagon is 3 points
 * becoming 6). Resolution resamples the SHORTER list up to the longer count
 * by walking its own perimeter at even arc-length steps - "resample to the
 * higher count" is the usual rule - and the longer list is left completely
 * untouched, so an author who already sent exactly the vertex count they
 * wanted never sees it redistributed. See `resamplePolygon` in
 * shape-morph.ts, and its tests for the exact coordinates this produces on a
 * triangle padded to six points.
 *
 * DESIGN DECISION 3 - winding and start-point alignment. Two same-length
 * outlines authored starting at different vertices, or wound in opposite
 * directions, would lerp point by point into a shape that visibly spins
 * through the morph instead of settling directly into place - the classic
 * shape-tweening rotation artifact. Resolution auto-aligns `to` onto `from`:
 * it searches every cyclic starting shift of `to`, in both its authored and
 * reversed winding direction, and keeps whichever pairing minimizes total
 * point-to-point displacement against `from`. This is unconditional and not
 * author-configurable - the same "resolved once, not a per-call choice"
 * stance a gradient's stop ordering already takes elsewhere in this schema.
 * See `alignToReference` in shape-morph.ts.
 *
 * DESIGN DECISION 4 - timing. `startMs`/`durationMs` are ELEMENT-local,
 * measured from the start of this element's own visible window - the same
 * clock `CreativeTextCounter.startMs` and `apply_text_animation.startMs`
 * already use, not scene-local like a chart's drawProgress keyframes or a
 * chart callout's startMs. The reasoning follows set_counter's precedent
 * rather than the chart one: a morph is a self-contained beat belonging to
 * one element, with nothing on another element's own clock to line up
 * against, so there is no reason to force an author through
 * `element.timing.startMs + offset` scene-local arithmetic the way a callout
 * timed against a chart's own draw-on keyframes needs to be. See the
 * published time-base table in schema-guide.ts.
 *
 * Before startMs the shape shows exactly `from`; once startMs + durationMs
 * has passed it holds at `to` rather than overshooting past it - the same
 * before/during/after shape CreativeTextCounter already established.
 */
export interface CreativeShapeMorph {
  from: CreativeShapeOutline;
  to: CreativeShapeOutline;
  /** Element-local milliseconds before the morph begins. See DESIGN DECISION 4 above. */
  startMs: number;
  durationMs: number;
  easing: EasingSpec;
}

export interface CreativeShapeElement extends CreativeElementBase {
  type: "shape";
  shape: "rect" | "ellipse";
  fill: ColorValue;
  /** Only meaningful when fill.kind is gradient. */
  gradientAnimation?: CreativeGradientAnimation;
  stroke?: StrokeToken;
  borderRadius?: number;
  /**
   * Deterministic outline morph. Omit for the plain rect/ellipse this
   * element has always drawn - a shape with no morph takes exactly the old
   * rendering path, byte-identical to before this field existed. See
   * CreativeShapeMorph for the four decisions behind its design.
   */
  morph?: CreativeShapeMorph;
}

export const CONNECTOR_CURVES = ["straight", "smooth", "orthogonal"] as const;
export type ConnectorCurve = (typeof CONNECTOR_CURVES)[number];

/**
 * A semantic edge between two elements. Geometry is never authored: the
 * renderer derives endpoint positions from the elements at the current time,
 * so moving, scaling or group-transforming a node automatically moves its edge.
 * The connector itself evaluates as a scene-sized overlay; its stored transform
 * supplies zIndex/opacity only and is normalized by evaluate.ts.
 */
export interface CreativeConnectorElement extends CreativeElementBase {
  type: "connector";
  fromElementId: string;
  toElementId: string;
  curve: ConnectorCurve;
  stroke: StrokeToken;
  /** 0..1 reveal of the path; animate with the existing drawProgress property. */
  drawProgress?: number;
}

export const CREATIVE_CHART_KINDS = ["line", "area", "bar", "sparkline", "progress", "donut"] as const;
export type CreativeChartKind = (typeof CREATIVE_CHART_KINDS)[number];

/**
 * Calls out one point in a chart's series for emphasis - a larger marker on
 * a line/area point, or a colour override on a bar - addressed by its index
 * in `series` rather than by authoring a separate object per point. Sparse:
 * only points worth calling out need an entry.
 */
export interface CreativeChartPointEmphasis {
  /** Index into the owning chart's `series`. */
  index: number;
  /** Marker radius multiplier for line/area. Ignored for bar. Defaults to 1. */
  scale?: number;
  /** Marker colour (line/area) or fill override (bar). Defaults to the chart's own stroke/fill. */
  color?: ColorValue;
}

/**
 * A line, area or bar chart drawn from one numeric series.
 *
 * Charts assembled from rectangles and lines are expensive to author and
 * cannot animate coherently - resizing the element, changing the data or
 * emphasising one point meant recomputing every rectangle's x/y/width/
 * rotation by hand. Here the element carries only the data and the plot
 * bounds; geometry is derived from those in `lib/creative/chart.ts` and
 * never authored, so resizing or editing `series` costs nothing to redraw.
 *
 * The generated parts stay individually addressable rather than being one
 * opaque picture: `chart.ts` derives a stable id for the series line, the
 * area fill and every point from `id` and the point's index, so a caller can
 * point at "point 3 of chart-1" without that point being a stored object.
 * `pointEmphasis` uses exactly that addressing to call out one point without
 * authoring it separately. See `chart.ts` for how axis bounds are derived
 * when omitted, and why line and area/bar derive them differently.
 *
 * Scoped to a single series and to line/area/bar for the first increment;
 * multi-series, donut, scatter and sparkline are follow-ups.
 */
export const CHART_LABEL_FORMATS = ["plain", "compact", "percent"] as const;
export type ChartLabelFormat = (typeof CHART_LABEL_FORMATS)[number];

/**
 * Native axes, gridlines and labels.
 *
 * Without these an analytics scene needs a hand-placed text element beside
 * every tick and every bar, which then has to be repositioned by hand whenever
 * the data or the plot box changes - the same authoring cost charts themselves
 * were added to remove.
 *
 * Tick marks are deliberately gridlines rather than short stubs. The chart's
 * normalized space is stretched non-uniformly onto the element box, so a stub
 * of fixed normalized length renders at a different size on a wide chart than
 * on a tall one; a full-width rule is unaffected by the stretch and is easier
 * to read a value against besides.
 */
export interface CreativeChartAxes {
  /** Ticks across the value axis, both bounds included. Under 2 draws none. */
  yTicks?: number;
  /** Draw a rule at each tick, across the plot. */
  gridlines?: boolean;
  /** Draw the value axis edge. */
  yLine?: boolean;
  /** Draw the category axis at the zero line. */
  xLine?: boolean;
  /** One per series point, drawn beneath the category axis. Extra entries are ignored. */
  categories?: string[];
  /** Draw each revealed point's own value beside it. */
  valueLabels?: boolean;
  /** How every number in this chart is written. Defaults to "plain". */
  format?: ChartLabelFormat;
  /** Decimal places. Defaults to 0. */
  precision?: number;
}

/**
 * A note anchored to one series point, with a leader line back to it.
 *
 * Offsets are in normalized chart space so a callout keeps its position
 * relative to the plot when the element is resized.
 *
 * Timing is scene-local - the same clock the chart's own drawProgress
 * keyframes and the element's own timing use (see CREATIVE_TIME_BASES in
 * schema-guide.ts), not element-local like apply_text_animation/set_counter.
 * A chart callout is authored beside the drawProgress track that reveals the
 * point it annotates, both as keyframes on the same element, so "the callout
 * lands a second after the bars finish drawing" is startMs = (the keyframe
 * that reaches drawProgress 1) + 1000 - one clock, no translation into an
 * offset from the element's own visible-window start. All three fields are
 * optional and sparse: a callout with none of them appears exactly as soon as
 * its point is revealed and never leaves, precisely the behaviour every
 * callout had before this field existed, so an already-published film with
 * untimed callouts renders unchanged.
 */
export interface CreativeChartCallout {
  /** Index into `series`. */
  index: number;
  text: string;
  /** Offset from the point. Defaults to slightly above it. */
  dx?: number;
  dy?: number;
  /**
   * Scene-local ms this callout begins to appear. Omit to show it as soon as
   * its point is revealed, like every callout before this field existed.
   */
  startMs?: number;
  /**
   * How long the callout stays up after startMs, in ms. Omit to hold it for
   * the rest of the chart element's own visible window. Requires startMs.
   */
  durationMs?: number;
  /**
   * Crossfades in over this many ms starting at startMs, and - when
   * durationMs is set - fades back out over the same span before it ends.
   * Omit for a hard cut. Requires startMs.
   */
  fadeMs?: number;
}

export interface CreativeChartElement extends CreativeElementBase {
  type: "chart";
  chartKind: CreativeChartKind;
  /** Values only; points are spaced evenly along the x axis. */
  series: number[];
  /** Value the y axis starts at. Omit to derive from the series - see resolveChartAxisBounds in chart.ts. */
  axisMin?: number;
  /** Value the y axis ends at. Omit to derive from the series. */
  axisMax?: number;
  /**
   * 0..1, how much of the line/bars is drawn. Defaults to 1 (fully drawn).
   * Animate through the "drawProgress" keyframe property, the same
   * vocabulary x/y/opacity/blurPx use, to draw the chart on over time.
   */
  drawProgress?: number;
  /**
   * 0..1, how much of the area fill is revealed (chartKind "area" only).
   * Omit to mirror the resolved drawProgress, so the line and its fill draw
   * together by default; animate "fillProgress" separately to have the fill
   * catch up after the line finishes, or lead it.
   */
  fillProgress?: number;
  /**
   * 0..1 share of the draw window devoted to cascading generated points/bars.
   * Zero means all bars grow together; one yields the strongest sequential cascade.
   */
  staggerPoints?: number;
  /** Line edge (line, area) or each bar's outline (bar - a zero width hides it). */
  stroke: StrokeToken;
  /** Fill under the curve (area) or of each bar (bar). Ignored for line. */
  fill?: ColorValue;
  /** Sparse per-point emphasis, addressed by index into `series`. */
  pointEmphasis?: CreativeChartPointEmphasis[];
  /** Native axes, gridlines and labels, so the scene needs no hand-placed text. */
  axes?: CreativeChartAxes;
  /** Notes anchored to series points. */
  callouts?: CreativeChartCallout[];
  /**
   * Typography for every piece of chart text. Required once anything draws a
   * label: chart text has no element of its own to inherit a style from.
   */
  labelStyle?: TextStyleRef;
}

/**
 * Deterministic UI/HTML clip contract.
 *
 * ChatGPT authors real product interface as a closed, validated node tree
 * instead of shipping raw HTML or asking a generative video model to
 * hallucinate a UI. There is no markup string, no script, no external URL
 * and no server command in this contract — Studio lays the nodes out
 * itself, in a fixed viewport, from registered assets and design tokens
 * only, so the same tree renders identically in preview and final render.
 *
 * Use this for interface motion, overlays and native typography. Keep
 * generative/cinematic footage on the video worker.
 */
export const CREATIVE_UI_NODE_KINDS = ["box", "text", "image"] as const;
export type CreativeUiNodeKind = (typeof CREATIVE_UI_NODE_KINDS)[number];

/** Maximum nesting depth of a UI node tree. */
export const CREATIVE_UI_MAX_DEPTH = 6;
/** Maximum number of nodes in one UI element. */
export const CREATIVE_UI_MAX_NODES = 200;
/** Maximum width or height of a UI viewport in pixels. */
export const CREATIVE_UI_MAX_VIEWPORT = CREATIVE_CANVAS_MAX_DIMENSION;

/** Position and size in viewport pixels, relative to the parent node. */
export interface CreativeUiFrame {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface CreativeUiConstraints {
  left?: number; right?: number; top?: number; bottom?: number;
  horizontal?: "start" | "center" | "end" | "stretch";
  vertical?: "start" | "center" | "end" | "stretch";
}

export interface CreativeUiLayoutItem {
  grow?: number;
  alignSelf?: "start" | "center" | "end" | "stretch";
  columnSpan?: number;
}

export type CreativeUiLayout =
  | { mode: "flex"; direction?: "row" | "column"; gap?: number; padding?: number; align?: "start" | "center" | "end" | "stretch"; justify?: "start" | "center" | "end" }
  | { mode: "grid"; columns: number; gap?: number; padding?: number; rowHeight?: number };

export interface CreativeUiNodeBase {
  id: string;
  frame: CreativeUiFrame;
  constraints?: CreativeUiConstraints;
  layoutItem?: CreativeUiLayoutItem;
  opacity?: number;
  borderRadius?: number;
  /** Clip descendants to this node's frame. */
  clip?: boolean;
  /**
   * When this node is on screen, in scene-local milliseconds — the same clock
   * the owning element's own timing uses, so one film has one timebase.
   * Omitted means the node is visible whenever its element is.
   *
   * Hiding a node hides its children with it: they are nested inside it.
   */
  timing?: ElementTiming;
  /**
   * Keyframe tracks over this node alone, so rows, labels, values and controls
   * choreograph independently without the interface being torn apart into
   * separate elements.
   *
   * x and y are viewport pixels relative to the parent node, matching `frame`.
   * scaleX, scaleY and rotation pivot about the node's own centre. Tracks for
   * anything else are ignored rather than rejected.
   */
  animations?: ElementAnimation[];
}

export interface CreativeUiBoxNode extends CreativeUiNodeBase {
  kind: "box";
  background?: ColorValue;
  border?: StrokeToken;
  children?: CreativeUiNode[];
  layout?: CreativeUiLayout;
}

export interface CreativeUiTextNode extends CreativeUiNodeBase {
  kind: "text";
  text: string;
  style: TextStyleRef;
}

export interface CreativeUiImageNode extends CreativeUiNodeBase {
  kind: "image";
  assetId: string;
  fit: MediaFit;
}

export type CreativeUiNode = CreativeUiBoxNode | CreativeUiTextNode | CreativeUiImageNode;

/** Deterministic vertical scroll of the node canvas inside the viewport. */
export interface CreativeUiScroll {
  fromY: number;
  toY: number;
  startMs: number;
  endMs: number;
  easing: EasingSpec;
}

export interface CreativeUiPointerKeyframe {
  timeMs: number;
  x: number;
  y: number;
  pressed: boolean;
}

/** Optional pointer/tap indicator drawn over the UI viewport. */
export interface CreativeUiPointer {
  radius: number;
  color: ColorValue;
  keyframes: CreativeUiPointerKeyframe[];
}

export interface CreativeUiElement extends CreativeElementBase {
  type: "ui";
  /** Fixed layout viewport; scaled to exactly fill the element transform box. */
  viewport: { width: number; height: number };
  nodes: CreativeUiNode[];
  background?: ColorValue;
  scroll?: CreativeUiScroll;
  pointer?: CreativeUiPointer;
}

/** Maximum nesting depth of a composite element tree - a composite whose child is itself a composite, and so on. Matches CREATIVE_UI_MAX_DEPTH's precedent. */
export const CREATIVE_COMPOSITE_MAX_DEPTH = 6;
/** Maximum descendants (children, grandchildren, ...) in one composite's whole tree, regardless of shape. Matches CREATIVE_UI_MAX_NODES's precedent - a depth cap alone does not bound a wide, shallow tree. */
export const CREATIVE_COMPOSITE_MAX_DESCENDANTS = 200;

/**
 * A composite element: one addressable node whose children are real element
 * shapes - a genuine chart, genuine text, genuine shapes and images, glass and
 * all - laid out on the composite's own local coordinate system, sharing the
 * composite's one transform and the scene's one clock. roadmap #59/#57.
 *
 * WHY THIS SHAPE, NOT NESTED GROUPS. The flat-group rule stands unmodified: an
 * element belongs to at most one group and groups do not nest (validate.ts,
 * operations.ts). That rule is about GROUPS, a purely organisational wrapper
 * over otherwise-independent elements. Nesting groups would have meant
 * teaching every one of findOwningGroup, the hidden-group cascade, group
 * continuation, and the connector/safe-area/timeline-state/document-summary
 * group lookups - around ten call sites - to compose an unbounded chain of
 * ancestor transforms instead of assuming at most one; every one of them
 * would have produced a wrong picture, not an error, the moment that stopped
 * being true. A composite touches none of them: from the scene's own
 * perspective it is one element with a `transform` like any other, so
 * findOwningGroup, stagger_group, orbit_group, connectors and every
 * safe-area/timeline-state reader keep working completely unmodified - a card
 * now genuinely IS one element rather than a workaround pretending to be one.
 *
 * WHY A NEW ELEMENT TYPE, NOT "AUTHOR IT AS UI". `glass` lives on
 * CreativeElementBase, not CreativeUiNodeBase, and CREATIVE_UI_NODE_KINDS is
 * box/text/image only - there has never been a chart node. "A card = glass +
 * text + chart" could not be built as a `ui` element; the schema-guide
 * invariant and capability-map gap that told callers to try anyway were wrong
 * the whole time, and are corrected alongside this type. `ui` remains the
 * right tool for a different job and is not replaced: closed, hand-laid-out
 * product interface (a phone screen, dashboard chrome) with its own
 * restricted, HTML-free node vocabulary, meant for interface motion and
 * screen recreation. Composite is for a cluster of REAL creative elements -
 * the same chart, text, shape, image, video, connector-free glass panel and
 * even nested composite a top-level scene already has - that need to move,
 * fade and be addressed as one unit. Reach for `ui` to fake a product screen;
 * reach for composite for a card, a KPI tile, a labelled chart, anything that
 * is genuinely built from this engine's own element vocabulary.
 *
 * FOUR DESIGN DECISIONS, made deliberately:
 *
 * 1. ADDRESSING. A child is reached from outside only through its owning
 *    composite: (elementId of the composite, childId of a direct child) - the
 *    same two-part shape animate_ui_node etc. already use for a ui node,
 *    reused rather than reinvented. No operation is extended to accept a
 *    childId by this change; #68 (apply_text_animation reaching into a
 *    composite child) is left as a named follow-up now that the shape exists
 *    to extend. Child ids are unique within their owning composite's own
 *    subtree (validate.ts), not document-wide, because that pair is all any
 *    future childId-bearing operation needs to disambiguate - matching how a
 *    ui node id is scoped to its own ui element rather than to the document.
 *
 * 2. COORDINATES. Local, like `ui`'s viewport - not canvas-relative. A
 *    child's transform.x/y/width/height are pixels in the composite's own
 *    `viewport`, independently scaled onto the composite's actual on-screen
 *    box exactly the way ui.viewport already is (resolveCreativeComposite
 *    Element in composite.ts mirrors resolveCreativeUiElement's scaleX/
 *    scaleY). Canvas-relative children would mean re-authoring every child
 *    whenever the composite moved or was reused elsewhere, defeating the
 *    point of it being one relocatable unit: move the composite and every
 *    child comes with it, no numbers touched.
 *
 * 3. NESTING AND DEPTH. Children may themselves be composites (everything but
 *    connector is permitted - see CreativeCompositeElement.children). Because
 *    a child is an embedded value, not an id reference, a cycle is
 *    structurally unreachable - nothing can make a composite contain itself.
 *    CREATIVE_COMPOSITE_MAX_DEPTH is still enforced because an unbounded tree
 *    is a real validate/render cost independent of cycles, and
 *    CREATIVE_COMPOSITE_MAX_DESCENDANTS bounds a wide, shallow tree the depth
 *    cap alone would not catch.
 *
 * 4. OPACITY: ONE SURFACE, NOT MULTIPLIED THROUGH. A composite's children
 *    render as ordinary nested DOM inside one wrapper box that the
 *    composite's own (possibly animated) opacity applies to once, letting the
 *    browser flatten the whole subtree before compositing it - standard CSS
 *    opacity behaviour for an element with descendants. That is the opposite
 *    of a group's wrapper (see CreativeScenePreview.tsx's HierarchyLayer
 *    comment): a group wraps each child in its OWN copy of the group's
 *    transform to preserve z-order against sibling elements that are not
 *    group members and can sit between two group children in the scene's
 *    stacking order - which is exactly why a group's opacity multiplies
 *    through every child independently, so a translucent card inside a
 *    fading row goes double-faint. A composite's children can never be
 *    interleaved with anything outside the composite - that is the entire
 *    point of being reachable only through it - so nothing forces per-child
 *    wrapping, and the one-surface approach is not merely simpler but
 *    correct: it is what fixes the compounding-opacity bug this row exists to
 *    fix, rather than reproducing it one level deeper the way nested groups
 *    would have.
 */
export interface CreativeCompositeElement extends CreativeElementBase {
  type: "composite";
  /** Fixed local layout viewport; independently scaled to fill the element's transform box, exactly like ui.viewport. */
  viewport: { width: number; height: number };
  /**
   * Real elements - any CreativeElement type except "connector" - positioned
   * in viewport pixels, each with its own transform, timing, animations and
   * adjustments on the scene's shared clock. Connector is the one exclusion:
   * its geometry is derived from two SCENE-level element ids
   * (fromElementId/toElementId resolved against `scene.elements`), and a
   * composite child has no such address to be pointed at - a deliberate scope
   * cut, not a structural one, and nothing here rules it out for later.
   */
  children: CreativeElement[];
}

/**
 * Element types, as a constant so the MCP schema can be spread from it.
 *
 * This list was hand-written in two places until now — once here as a union and
 * once in the advertised schema — which is the drift that has caused four
 * incidents in this repo. Adding `chart` happened to update both; the next one
 * might not.
 */
export const CREATIVE_ELEMENT_TYPES = ["text", "image", "video", "shape", "ui", "chart", "connector", "composite"] as const;
export type CreativeElementType = (typeof CREATIVE_ELEMENT_TYPES)[number];

export type CreativeElement =
  | CreativeTextElement
  | CreativeImageElement
  | CreativeVideoElement
  | CreativeShapeElement
  | CreativeUiElement
  | CreativeChartElement
  | CreativeConnectorElement
  | CreativeCompositeElement;

/**
 * A transform applied to many elements at once — a group's children, or every
 * element in a scene when it is used as a camera.
 *
 * Translation is in canvas pixels and rotation in degrees, matching
 * CreativeTransform. Opacity multiplies each child's own rather than replacing
 * it, so hiding a cluster does not discard the composition inside it.
 *
 * The pivot is normalized 0..1 against the CANVAS, not against the group's
 * bounding box. A group's bounds move as its children animate, so a
 * bounds-relative pivot would be time-varying and a steady push-in would
 * visibly drift. 0.5, 0.5 is the centre of frame, which is what a camera move
 * almost always wants; a cluster scaled about its own middle sets the anchor to
 * where that middle sits.
 */
export interface CreativeHierarchyTransform {
  x: number;
  y: number;
  scaleX: number;
  scaleY: number;
  rotation: number;
  opacity: number;
  anchorX: number;
  anchorY: number;
  /** Pixels of compositional blur over this whole hierarchy. Defaults to zero. */
  blurPx?: number;
}

/**
 * A scene-level transform over every element in the scene.
 *
 * Push-ins, pull-backs, pans and drifts are one animated camera rather than the
 * same move authored onto twenty elements in lockstep — which is both far
 * cheaper to express and impossible to get subtly out of sync.
 */
export interface CreativeCamera {
  transform: CreativeHierarchyTransform;
  /** Animated with the same keyframes and easing as any element. */
  animations?: ElementAnimation[];
  /** CSS perspective distance. Omitted keeps the legacy flat camera. */
  perspectivePx?: number;
  perspectiveOriginX?: number;
  perspectiveOriginY?: number;
}

export interface CreativeGroup {
  id: string;
  name: string;
  elementIds: string[];
  locked?: boolean;
  hidden?: boolean;
  /**
   * Moves, scales and rotates every child together while each keeps its own
   * local coordinates. Omitted means the group is organisational only, which
   * is what every group was before this existed.
   */
  transform?: CreativeHierarchyTransform;
  animations?: ElementAnimation[];
}

export interface CreativeScene {
  id: string;
  name: string;
  durationMs: number;
  /** Applies to every element in the scene, above any group transform. */
  camera?: CreativeCamera;
  background?: ColorValue;
  elements: CreativeElement[];
  groups: CreativeGroup[];
  transitionOut?: SceneTransition;
}

export interface CreativeDocumentMetadata {
  [key: string]: JsonValue;
}

export interface CreativeGainKeyframe {
  timeMs: number;
  gain: number;
}

export const CREATIVE_MARKER_KINDS = ["beat", "transient", "cue", "chapter", "word", "sentence", "custom"] as const;
export type CreativeMarkerKind = (typeof CREATIVE_MARKER_KINDS)[number];

/**
 * A point of interest on the rendered timeline.
 *
 * Markers are editing metadata: they never affect rendering. They exist so an
 * assistant can align cuts to detected musical transients rather than to
 * guessed timestamps.
 */
export interface CreativeMarker {
  id: string;
  timeMs: number;
  kind: CreativeMarkerKind;
  label?: string;
}

export const CREATIVE_AUDIO_KINDS = ["music", "voiceover", "sfx"] as const;
export type CreativeAudioKind = (typeof CREATIVE_AUDIO_KINDS)[number];

/**
 * An audio clip on the document timeline.
 *
 * Audio lives on the document rather than inside a scene because a music bed
 * runs the length of the film and would otherwise have to be chopped at every
 * scene boundary. Times are measured on the rendered, overlap-aware timeline,
 * the same clock `studio_render_creative_frame` uses.
 */
export interface CreativeAudioClip {
  id: string;
  name: string;
  /** Registered audio asset. */
  assetId: string;
  kind: CreativeAudioKind;
  /** Window on the rendered timeline. */
  startMs: number;
  endMs: number;
  /** In-point inside the source asset. */
  sourceStartMs: number;
  /** 0..2, where 1 is unity. */
  gain: number;
  fadeInMs?: number;
  fadeOutMs?: number;
  /**
   * Gain automation. When present it supersedes the scalar `gain`; values are
   * interpolated linearly between points, in rendered-timeline milliseconds.
   */
  gainKeyframes?: CreativeGainKeyframe[];
  muted?: boolean;
  /** Drop this clip while any voiceover is playing. */
  duckUnderVoice?: boolean;
  /** Gain multiplier applied while ducked. Defaults to 0.3. */
  duckToGain?: number;
}

/**
 * One element becoming another across a scene boundary.
 *
 * The incoming element is the one that continues: for the first `durationMs` of
 * its scene it is drawn interpolating from where the outgoing element finished
 * toward where it belongs, so the eye tracks one object through the cut.
 *
 * It must fit inside the scenes' overlap, which is the outgoing scene's
 * `transitionOut` duration. Without that overlap the two elements are never on
 * screen together and the morph is a cut with extra steps, so the validator
 * rejects it and says which transition to lengthen.
 *
 * Lives on the document rather than in a scene because it is a relationship
 * between two scenes and belongs to neither.
 */
export interface CreativeContinuation {
  id: string;
  fromSceneId: string;
  fromElementId: string;
  /** Must be the scene immediately after `fromSceneId`. */
  toSceneId: string;
  toElementId: string;
  durationMs: number;
  /** Defaults to ease-out, which reads as arriving rather than departing. */
  easing?: EasingSpec;
}

/**
 * One group becoming another across a scene boundary.
 *
 * `continue_element` carries a single object through a cut. A cluster is
 * different: continuing the disc while its label stays a separate element left
 * "Enterprise Knowledge" and "Sales Intelligence" legible at the same time
 * during the handoff, which is the doubling this exists to remove.
 *
 * The incoming group's transform interpolates from where the outgoing group's
 * finished, so the cluster moves as one composited object. `childMapping` says
 * which incoming children already have a counterpart on screen; anything
 * unmapped has no predecessor to hand off from and stays hidden until the
 * handoff completes, rather than fading up alongside the thing it replaces.
 *
 * Mapping is explicit on purpose. Heuristic matching would be guessing at
 * authorial intent, and every other decision in this system is stated.
 */
export interface CreativeGroupContinuation {
  id: string;
  fromSceneId: string;
  fromGroupId: string;
  /** Must be the scene immediately after `fromSceneId`. */
  toSceneId: string;
  toGroupId: string;
  durationMs: number;
  easing?: EasingSpec;
  /**
   * Incoming children that already have a counterpart in the outgoing group.
   * These stay visible through the handoff; everything else in the incoming
   * group waits for it to finish.
   *
   * `morphGeometry` opts a pair into more than visibility: that child's own
   * position/size/rotation/opacity interpolates from its predecessor's
   * resolved end state toward its own, on the group's own window and easing —
   * the same blend `continue_element` gives a whole element, reused here
   * rather than rebuilt (see `findGroupChildMorphSource` in continuation.ts).
   * Default is off, so every continuation written before this field existed
   * keeps rendering exactly as it did: a mapped child travels with the group
   * but does not itself move within it. A child also named by its own
   * top-level `continue_element` ignores this flag — the explicit
   * continuation is the more specific instruction and wins outright, rather
   * than the two compounding into a doubled blend.
   */
  childMapping?: Array<{ fromElementId: string; toElementId: string; morphGeometry?: boolean }>;
}

export interface CreativeDocument {
  version: 1;
  id: string;
  title: string;
  canvas: CreativeCanvas;
  designSystem: CreativeDesignSystem;
  scenes: CreativeScene[];
  /** Optional; documents written before audio existed simply omit it. */
  audio?: CreativeAudioClip[];
  /** Editing metadata only; markers never affect rendering. */
  markers?: CreativeMarker[];
  /** Cross-scene element handoffs; omitted on every document written before they existed. */
  continuations?: CreativeContinuation[];
  /** Cross-scene group handoffs, for clusters that move and change as one. */
  groupContinuations?: CreativeGroupContinuation[];
  metadata?: CreativeDocumentMetadata;
}
