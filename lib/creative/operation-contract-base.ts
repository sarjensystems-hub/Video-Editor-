import {
  ANIMATION_PROPERTIES,
  CREATIVE_ELEMENT_TYPES,
  BLEND_MODES,
  CREATIVE_AUDIO_KINDS,
  CREATIVE_CANVAS_MAX_DIMENSION,
  CREATIVE_CHART_KINDS,
  CHART_LABEL_FORMATS,
  CONNECTOR_CURVES,
  CREATIVE_MARKER_KINDS,
  CREATIVE_MASK_KINDS,
  CREATIVE_UI_MAX_VIEWPORT,
  CREATIVE_UI_NODE_KINDS,
  GRADIENT_KINDS,
  SCENE_TRANSITION_KINDS,
  TEXT_ANIMATION_GRANULARITIES,
  TEXT_ANIMATION_MODES,
  TEXT_FIT_MODES,
} from "./schema";

import type { CreativeTransactionOperation } from "./transactions";

type JsonSchema = Record<string, unknown>;

const str = (description?: string): JsonSchema => ({ type: "string", minLength: 1, ...(description ? { description } : {}) });
const num = (description?: string): JsonSchema => ({ type: "number", ...(description ? { description } : {}) });
const integer = (description?: string): JsonSchema => ({ type: "integer", ...(description ? { description } : {}) });
const bool = (description?: string): JsonSchema => ({ type: "boolean", ...(description ? { description } : {}) });
const obj = (description?: string): JsonSchema => ({ type: "object", additionalProperties: true, ...(description ? { description } : {}) });

const easingSchema: JsonSchema = {
  oneOf: [
    { type: "string", enum: ["linear", "ease-in", "ease-out", "ease-in-out", "spring-soft", "spring-snappy"] },
    {
      type: "object",
      additionalProperties: false,
      properties: {
        kind: { type: "string", enum: ["cubic-bezier"] },
        x1: num(), y1: num(), x2: num(), y2: num(),
      },
      required: ["kind", "x1", "y1", "x2", "y2"],
    },
  ],
};

// A gradient stop's own colour can never be a gradient - it has to resolve to
// one CSS <color> - so stops are typed against flatColorSchema, not the full
// colorSchema below, and nesting is structurally unreachable rather than
// merely discouraged.
const flatColorSchema: JsonSchema = {
  oneOf: [
    {
      type: "object",
      additionalProperties: false,
      properties: { kind: { type: "string", enum: ["literal"] }, value: str() },
      required: ["kind", "value"],
    },
    {
      type: "object",
      additionalProperties: false,
      properties: { kind: { type: "string", enum: ["token"] }, token: str() },
      required: ["kind", "token"],
    },
  ],
};

const gradientStopSchema: JsonSchema = {
  type: "object",
  additionalProperties: false,
  properties: {
    offset: num("Normalized 0-1 position along the gradient."),
    color: flatColorSchema,
  },
  required: ["offset", "color"],
};

const gradientSchema: JsonSchema = {
  type: "object",
  additionalProperties: false,
  description:
    "Linear, radial or conic gradient. angle is degrees (CSS convention: 0 = up, clockwise) and applies to linear and conic; centerX/centerY are normalized 0-1 against the element's own box (default 0.5, 0.5 - the centre) and apply to radial and conic. A field the chosen kind does not use is ignored rather than rejected. Stops need not be pre-sorted - the resolver orders them by offset, so inserting one new stop never requires re-sending the rest in order.",
  properties: {
    kind: { type: "string", enum: [...GRADIENT_KINDS] },
    stops: { type: "array", minItems: 2, items: gradientStopSchema, description: "At least two." },
    angle: num("Degrees. Linear and conic only; ignored otherwise."),
    centerX: num("Normalized 0-1. Radial and conic only; ignored otherwise."),
    centerY: num("Normalized 0-1. Radial and conic only; ignored otherwise."),
  },
  required: ["kind", "stops"],
};

/**
 * Every colour-bearing field in the document uses this one schema, and it is
 * enforced only where a gradient can actually render - CSS `background` -
 * because `lib/creative/validate.ts` rejects a gradient anywhere the field
 * resolves to a plain CSS `color` or a border shorthand string (a stroke
 * colour, a text colour, a gradient stop's own colour). The schema stays the
 * same shape everywhere on purpose: which fields accept a gradient is a
 * document-validation question, the same way it is not this schema's job to
 * know that a cut transition's durationMs must be zero.
 */
const colorSchema: JsonSchema = {
  oneOf: [
    ...(flatColorSchema.oneOf as JsonSchema[]),
    {
      type: "object",
      additionalProperties: false,
      properties: { kind: { type: "string", enum: ["gradient"] }, gradient: gradientSchema },
      required: ["kind", "gradient"],
    },
  ],
};

const gradientNumberTrackSchema: JsonSchema = {
  type: "array", minItems: 2,
  items: { type: "object", additionalProperties: false, properties: { timeMs: num(), value: num(), easing: easingSchema }, required: ["timeMs", "value", "easing"] },
};
const gradientColorTrackSchema: JsonSchema = {
  type: "array", minItems: 2,
  items: { type: "object", additionalProperties: false, properties: { timeMs: num(), color: flatColorSchema, easing: easingSchema }, required: ["timeMs", "color", "easing"] },
};
const gradientAnimationSchema: JsonSchema = {
  type: "object", additionalProperties: false,
  properties: {
    angle: gradientNumberTrackSchema, centerX: gradientNumberTrackSchema, centerY: gradientNumberTrackSchema,
    stops: { type: "array", items: { type: "object", additionalProperties: false, properties: { stopIndex: integer("Zero-based authored stop index."), offset: gradientNumberTrackSchema, colorKeyframes: gradientColorTrackSchema }, required: ["stopIndex"] } },
  },
};

const frameSchema: JsonSchema = {
  type: "object",
  additionalProperties: false,
  properties: { x: num(), y: num(), width: num(), height: num() },
  required: ["x", "y", "width", "height"],
};

const strokeSchema: JsonSchema = {
  type: "object",
  additionalProperties: false,
  properties: { width: num(), color: colorSchema },
  required: ["width", "color"],
};

const transformSchema: JsonSchema = {
  type: "object",
  additionalProperties: false,
  properties: {
    x: num(), y: num(), width: num(), height: num(), rotation: num(), opacity: num(),
    anchorX: num(), anchorY: num(), zIndex: integer(), z: num(), rotationX: num(), rotationY: num(),
  },
  required: ["x", "y", "width", "height", "rotation", "opacity", "anchorX", "anchorY", "zIndex"],
};

/**
 * UI nodes deliberately expose the whole deterministic vocabulary in MCP.
 * `children` is kept structurally open here because JSON Schema recursion is
 * poorly supported by several MCP clients; the canonical CreativeDocument
 * validator applies the same node contract recursively after input parsing.
 */
const uiNodeSchema: JsonSchema = {
  type: "object",
  additionalProperties: false,
  properties: {
    id: str("Unique within this UI element."),
    kind: { type: "string", enum: [...CREATIVE_UI_NODE_KINDS] },
    frame: frameSchema,
    constraints: {
      type: "object", additionalProperties: false,
      description: "Parent-relative placement used only when the parent has no flex/grid layout. start pairs with left/top, end with right/bottom, center accepts no edge offset, and stretch may use both edges; incompatible combinations are rejected.",
      properties: {
        left: num(), right: num(), top: num(), bottom: num(),
        horizontal: { type: "string", enum: ["start", "center", "end", "stretch"] },
        vertical: { type: "string", enum: ["start", "center", "end", "stretch"] },
      },
    },
    layoutItem: {
      type: "object", additionalProperties: false,
      properties: {
        grow: { type: "number", minimum: 0 },
        alignSelf: { type: "string", enum: ["start", "center", "end", "stretch"] },
        columnSpan: { type: "integer", minimum: 1 },
      },
    },
    opacity: num(),
    borderRadius: num(),
    clip: bool(),
    background: colorSchema,
    border: {
      type: "object", additionalProperties: false,
      // ColorValue, not a string. Advertising a string here made a valid-looking
      // border fail the document validator with "Color must be a literal or
      // token reference", and a caller trusting the schema had no correct form
      // to send — it dropped its borders instead.
      properties: { width: num(), color: colorSchema }, required: ["width", "color"],
    },
    children: { type: "array", items: obj("Nested deterministic UI node using this same node vocabulary.") },
    layout: {
      oneOf: [
        {
          type: "object", additionalProperties: false,
          properties: {
            mode: { type: "string", enum: ["flex"] }, direction: { type: "string", enum: ["row", "column"] },
            gap: { type: "number", minimum: 0 }, padding: { type: "number", minimum: 0 },
            align: { type: "string", enum: ["start", "center", "end", "stretch"] },
            justify: { type: "string", enum: ["start", "center", "end"] },
          },
          required: ["mode"],
        },
        {
          type: "object", additionalProperties: false,
          properties: {
            mode: { type: "string", enum: ["grid"] }, columns: { type: "integer", minimum: 1 },
            gap: { type: "number", minimum: 0 }, padding: { type: "number", minimum: 0 }, rowHeight: { type: "number", exclusiveMinimum: 0 },
          },
          required: ["mode", "columns"],
        },
      ],
      description: "Deterministic child flex or grid layout. Child constraints are rejected when a parent layout owns its frame.",
    },
    text: str(),
    style: obj("TextStyleRef: { token, overrides? }."),
    assetId: str("Registered Creative Studio image asset ID."),
    fit: { type: "string", enum: ["cover", "contain", "fill"] },
  },
  required: ["id", "kind", "frame"],
};

const glassSchema: JsonSchema = {
  type: "object",
  additionalProperties: false,
  properties: {
    blurPx: num("Backdrop blur in px."),
    tint: flatColorSchema,
    tintOpacity: num("0-1 tint strength. Defaults to 0.12."),
    borderOpacity: num("0-1 hairline edge strength. Defaults to 0.18; zero hides it."),
    radius: num("Corner radius in px."),
    highlight: num("0-1 specular along the top edge. Defaults to 0.25."),
    saturation: num("Backdrop saturation multiplier, 0-3. Defaults to 1.4."),
    shadow: num("0-1 soft shadow beneath the panel. Defaults to 0.18."),
  },
  required: ["blurPx"],
  description: "Frosted-glass surface: blur, tint, edge, highlight and shadow resolved together so panels match.",
};

const chartAxesSchema: JsonSchema = {
  type: "object",
  additionalProperties: false,
  properties: {
    yTicks: integer("Ticks across the value axis, both bounds included. Under 2 draws none."),
    gridlines: bool("Draw a rule at each tick, across the plot."),
    yLine: bool("Draw the value axis edge."),
    xLine: bool("Draw the category axis at the zero line."),
    categories: {
      type: "array",
      items: str(),
      description: "One label per series point, drawn beneath the category axis. Extra entries are ignored.",
    },
    valueLabels: bool("Draw each revealed point's own value beside it. Values appear only as drawProgress uncovers them."),
    format: { type: "string", enum: [...CHART_LABEL_FORMATS], description: "How every number in this chart is written. Defaults to plain." },
    precision: integer("Decimal places, 0-6. Defaults to 0."),
  },
};

const chartCalloutSchema: JsonSchema = {
  type: "object",
  additionalProperties: false,
  properties: {
    index: integer("Index into the chart's series, 0-based."),
    text: str("The note itself."),
    dx: num("Offset from the point in normalized chart space. Defaults to 0."),
    dy: num("Offset from the point in normalized chart space. Defaults to -0.12, just above it."),
    startMs: num("Scene-local ms this callout begins to appear - the same clock the chart's own drawProgress keyframes and element timing use, not element-local like apply_text_animation/set_counter. Omit to show it as soon as its point is revealed, like every callout before this field existed."),
    durationMs: num("How long the callout stays up after startMs, in ms. Omit to hold it for the rest of the chart element's own visible window. Requires startMs."),
    fadeMs: num("Crossfades in over this many ms starting at startMs, and - when durationMs is set - fades back out over the same span before it ends. Omit for a hard cut. Requires startMs."),
  },
  required: ["index", "text"],
};

const chartPointEmphasisSchema: JsonSchema = {
  type: "object",
  additionalProperties: false,
  properties: {
    index: integer("Index into the chart's series, 0-based."),
    scale: num("Marker radius multiplier for line/area. Ignored for bar. Defaults to 1."),
    color: colorSchema,
  },
  required: ["index"],
};

const shapeOutlineSchema: JsonSchema = {
  type: "object",
  additionalProperties: false,
  properties: {
    points: {
      type: "array", minItems: 3,
      items: { type: "object", additionalProperties: false, properties: { x: num(), y: num() }, required: ["x", "y"] },
      description: "Normalized against the element's own box, like a polygon mask's points - but not clamped to 0-1, since an outline is free to spike past its box.",
    },
  },
  required: ["points"],
};

const shapeMorphSchema: JsonSchema = {
  type: "object",
  additionalProperties: false,
  properties: {
    from: shapeOutlineSchema,
    to: shapeOutlineSchema,
    startMs: num("Element-local milliseconds before the morph begins - measured from the start of this element's own visible window, like set_counter.startMs, not scene-local."),
    durationMs: num("How long the morph takes, in milliseconds."),
    easing: easingSchema,
  },
  required: ["from", "to", "startMs", "durationMs", "easing"],
  description: "Interpolates this shape's own outline from one polygon to another over durationMs. Unequal point counts are resampled up to the higher count; outlines are auto-aligned to the pairing that moves least. Straight edges only - no curves. The run must finish inside the element's own visible window.",
};

const creativeElementSchema: JsonSchema = {
  type: "object",
  additionalProperties: true,
  description: "Canonical CreativeElement. Type-specific fields below are validated again by the CreativeDocument validator.",
  properties: {
    id: str(),
    name: str(),
    alias: str("Optional project-wide stable semantic handle."),
    tags: { type: "array", minItems: 1, items: str("Semantic selector tag.") },
    type: { type: "string", enum: [...CREATIVE_ELEMENT_TYPES] },
    transform: transformSchema,
    timing: {
      type: "object", additionalProperties: false,
      properties: { startMs: num(), endMs: num() }, required: ["startMs", "endMs"],
    },
    hidden: bool(), locked: bool(),
    text: str(), style: obj("TextStyleRef."),
    // `fit` means two different things. On image and video it is the media fit
    // string; on text it is a shrink-to-fit policy object. Declaring only the
    // object made every valid image and video element technically off-schema,
    // and it passed only because this object allows additional properties — a
    // stricter validator would have rejected correct documents.
    fit: {
      oneOf: [
        { type: "string", enum: ["cover", "contain", "fill"], description: "MediaFit, on image and video elements." },
        obj("CreativeTextFit shrink-to-fit policy, on text elements."),
      ],
    },
    role: { type: "string", enum: ["background"], description: "Marks scenery, which the layout inspector does not check for canvas or safe-area fit." },
    blendMode: { type: "string", enum: [...BLEND_MODES], description: "CSS mix-blend-mode against whatever is behind this element. Omit for normal." },
    assetId: str(), sourceStartMs: num(), sourceEndMs: num(), playbackRate: num(), muted: bool(), volume: num(),
    viewport: {
      type: "object", additionalProperties: false,
      properties: {
        width: { type: "integer", minimum: 1, maximum: CREATIVE_UI_MAX_VIEWPORT },
        height: { type: "integer", minimum: 1, maximum: CREATIVE_UI_MAX_VIEWPORT },
      },
      required: ["width", "height"],
    },
    background: colorSchema,
    nodes: { type: "array", minItems: 1, items: uiNodeSchema },
    // Composite only. viewport above is shared with ui - same shape, same
    // scale-to-box convention. children is kept structurally open for the
    // same reason uiNodeSchema.children is: JSON Schema recursion is poorly
    // supported by several MCP clients, and the canonical CreativeDocument
    // validator (validateCompositeElement) applies the real per-type element
    // contract recursively after input parsing, exactly as it already does
    // for a ui node tree.
    children: {
      type: "array",
      minItems: 1,
      items: obj("A real CreativeElement using this same element vocabulary, positioned in the composite's own viewport pixels - any type except connector, and any type may itself be a composite up to the nesting depth cap."),
      description: "Composite only: the real elements this composite is made of.",
    },
    scroll: {
      type: "object", additionalProperties: false,
      properties: { fromY: num(), toY: num(), startMs: num(), endMs: num(), easing: easingSchema },
      required: ["fromY", "toY", "startMs", "endMs", "easing"],
    },
    pointer: {
      type: "object", additionalProperties: false,
      properties: {
        radius: num(), color: colorSchema,
        keyframes: {
          type: "array", minItems: 1,
          items: {
            type: "object", additionalProperties: false,
            properties: { timeMs: num(), x: num(), y: num(), pressed: bool() },
            required: ["timeMs", "x", "y", "pressed"],
          },
        },
      },
      required: ["radius", "color", "keyframes"],
    },
    fromElementId: str("Connector source element id, in the same scene."),
    toElementId: str("Connector destination element id, in the same scene."),
    curve: { type: "string", enum: [...CONNECTOR_CURVES], description: "Connector routing: straight, smooth bezier, or orthogonal elbow." },
    glass: glassSchema,
    axes: chartAxesSchema,
    callouts: { type: "array", items: chartCalloutSchema, description: "Notes anchored to series points, each with a leader line back to its point." },
    labelStyle: {
      type: "object",
      additionalProperties: false,
      properties: { token: str("Typography token id."), overrides: obj("Partial TextStyleToken overrides.") },
      required: ["token"],
      description: "Typography for every piece of chart text. Required once axes or callouts draw a label.",
    },
    chartKind: {
      type: "string",
      enum: [...CREATIVE_CHART_KINDS],
      description: "line, area or bar. Scoped to these three for now.",
    },
    series: {
      type: "array", minItems: 1, items: num(),
      description: "Chart values only; points are spaced evenly along the x axis.",
    },
    axisMin: num("Chart y-axis minimum. Omit to derive from the series - line stays tight to the data, area/bar envelope zero so the fill/bars have a baseline."),
    axisMax: num("Chart y-axis maximum. Omit to derive from the series."),
    drawProgress: num("Chart-only, 0-1: how much of the line/bars is drawn. Defaults to 1 (fully drawn). Animate through the drawProgress keyframe property to draw the chart on over time."),
    fillProgress: num("Area-chart-only, 0-1: how much of the area fill is revealed. Omit to mirror drawProgress; animate it separately to have the fill lag the line or lead it."),
    staggerPoints: num("0-1 generated-point/bar cascade strength. Zero grows together; one is maximally sequential."),
    stroke: strokeSchema,
    fill: colorSchema,
    gradientAnimation: gradientAnimationSchema,
    morph: shapeMorphSchema,
    pointEmphasis: {
      type: "array",
      items: chartPointEmphasisSchema,
      description: "Sparse per-point chart emphasis, addressed by index into series. Only line/area draw the radius/colour marker; bar honours colour only, as a fill override for that bar.",
    },
  },
  required: ["id", "name", "type", "transform"],
};

const speedRampSchema: JsonSchema = {
  type: "object",
  additionalProperties: false,
  properties: {
    keyframes: {
      type: "array", minItems: 2,
      items: {
        type: "object", additionalProperties: false,
        properties: { atMs: num("Clip-local timeline millisecond."), speed: { type: "number", exclusiveMinimum: 0 } },
        required: ["atMs", "speed"],
      },
    },
  },
  required: ["keyframes"],
};

const maskSchema: JsonSchema = {
  type: "object",
  additionalProperties: false,
  properties: {
    kind: { type: "string", enum: [...CREATIVE_MASK_KINDS] },
    x: num("Normalized 0-1."), y: num("Normalized 0-1."), width: num("Normalized 0-1."), height: num("Normalized 0-1."),
    feather: num(), invert: bool(), radius: num("0-1 rounded-rect corner radius."),
    points: { type: "array", minItems: 3, items: { type: "object", additionalProperties: false, properties: { x: num(), y: num() }, required: ["x", "y"] }, description: "Polygon points normalized inside the mask rectangle." },
  },
  required: ["kind", "x", "y", "width", "height"],
};

const motionBlurSchema: JsonSchema = {
  type: "object",
  additionalProperties: false,
  properties: { shutterAngle: num("180 is a normal cinematic shutter."), maxBlur: num("Maximum directional blur in pixels.") },
  required: ["shutterAngle", "maxBlur"],
};

const transitionSchema: JsonSchema = {
  type: "object",
  additionalProperties: false,
  properties: {
    kind: { type: "string", enum: [...SCENE_TRANSITION_KINDS] },
    durationMs: num(), easing: easingSchema,
  },
  required: ["kind", "durationMs", "easing"],
};

const textAnimationSchema: JsonSchema = {
  type: "object",
  additionalProperties: false,
  properties: {
    granularity: { type: "string", enum: [...TEXT_ANIMATION_GRANULARITIES] },
    mode: { type: "string", enum: [...TEXT_ANIMATION_MODES] },
    startMs: num(), durationMs: num(), staggerMs: num(), distance: num(), easing: easingSchema,
  },
  required: ["granularity", "mode", "startMs", "durationMs", "staggerMs", "easing"],
};

const counterSchema: JsonSchema = {
  type: "object",
  additionalProperties: false,
  properties: {
    from: num("Starting value."),
    to: num("Ending value."),
    startMs: num("Element-local milliseconds before the count begins - measured from the start of this element's own visible window, like apply_text_animation.startMs, not scene-local."),
    durationMs: num("How long the count takes, in milliseconds."),
    easing: easingSchema,
    format: { type: "string", enum: [...CHART_LABEL_FORMATS], description: "How the number is written; shares chart.ts's vocabulary. Defaults to plain." },
    precision: integer("Decimal places, 0-6. Defaults to 0."),
    prefix: { type: "string", description: "Prepended to every rendered value, e.g. \"$\"." },
    suffix: { type: "string", description: "Appended to every rendered value, e.g. \"%\" or \" users\"." },
  },
  required: ["from", "to", "startMs", "durationMs", "easing"],
  description: "Interpolates between two numbers over durationMs and formats the result, so a count-up is one text element instead of six or seven timed swaps. The run must finish inside the element's own visible window.",
};

const animationSchema: JsonSchema = {
  type: "object", additionalProperties: false,
  properties: {
    id: str(),
    property: { type: "string", enum: [...ANIMATION_PROPERTIES] },
    keyframes: {
      type: "array", minItems: 2,
      items: {
        type: "object", additionalProperties: false,
        properties: { timeMs: num(), value: num(), easing: easingSchema },
        required: ["timeMs", "value", "easing"],
      },
    },
  },
  required: ["id", "property", "keyframes"],
};

const audioClipSchema: JsonSchema = {
  type: "object",
  additionalProperties: true,
  properties: {
    id: str(), name: str(), assetId: str(),
    kind: { type: "string", enum: [...CREATIVE_AUDIO_KINDS] },
    startMs: num(), endMs: num(), sourceStartMs: num(), gain: num(),
    fadeInMs: num(), fadeOutMs: num(), muted: bool(), duckUnderVoice: bool(), duckToGain: num(),
    gainKeyframes: {
      type: "array",
      items: {
        type: "object", additionalProperties: false,
        properties: { timeMs: num(), gain: num(), easing: easingSchema },
        required: ["timeMs", "gain", "easing"],
      },
    },
  },
  required: ["id", "assetId", "kind", "startMs", "endMs", "sourceStartMs", "gain"],
};

const markerSchema: JsonSchema = {
  type: "object", additionalProperties: false,
  properties: {
    id: str(), timeMs: num(), kind: { type: "string", enum: [...CREATIVE_MARKER_KINDS] }, label: str(),
  },
  required: ["id", "timeMs", "kind"],
};

function operation(type: string, properties: Record<string, JsonSchema>, required: string[] = []): JsonSchema {
  return {
    type: "object",
    additionalProperties: false,
    properties: { type: { type: "string", enum: [type] }, ...properties },
    required: ["type", ...required],
  };
}

const hierarchyTransformSchema: JsonSchema = {
  type: "object",
  additionalProperties: false,
  description:
    "A transform over many elements at once. x and y are canvas pixels, rotation is degrees, opacity multiplies each child's own. anchorX/anchorY are the pivot for scale and rotation, normalized 0-1 against the CANVAS (0.5, 0.5 is centre of frame) - not against the group's bounds, which move as its children animate and would make a steady push-in drift.",
  properties: {
    x: num(), y: num(), scaleX: num(), scaleY: num(),
    rotation: num(), opacity: num(), anchorX: num(), anchorY: num(),
    blurPx: num("Whole-group/scene compositional blur in pixels. Omit for zero."),
  },
  required: ["x", "y", "scaleX", "scaleY", "rotation", "opacity", "anchorX", "anchorY"],
};

const hierarchyAnimationsSchema: JsonSchema = {
  type: "array",
  items: animationSchema,
  description:
    "Keyframe tracks over the transform, using the same properties and easing an element animates with. x, y, scaleX, scaleY, rotation, opacity and blurPx apply; any other track is ignored rather than rejected.",
};

const operationSchemas: JsonSchema[] = [
  operation("set_canvas", {
    width: { type: "integer", minimum: 1, maximum: CREATIVE_CANVAS_MAX_DIMENSION },
    height: { type: "integer", minimum: 1, maximum: CREATIVE_CANVAS_MAX_DIMENSION },
    fps: { type: "integer", minimum: 1, maximum: 120 },
  }),
  operation("set_project_scratchpad", { scratchpad: { type: "string" } }, ["scratchpad"]),
  operation("set_asset_alias", { alias: str("Stable project-local asset handle such as hero-shot."), assetId: str("Registered owned asset id; omit to remove this alias.") }, ["alias"]),
  operation("set_project_attachment", { attachment: { type: "object", additionalProperties: false, properties: { id: str(), kind: { type: "string", enum: ["reference", "brand"] }, assetId: str(), label: str() }, required: ["id", "kind", "assetId"] } }, ["attachment"]),
  operation("remove_project_attachment", { attachmentId: str() }, ["attachmentId"]),
  operation("add_composition_template", { template: { type: "string", enum: ["hero", "split", "metric-grid"] }, sceneId: str(), durationMs: num(), index: integer() }, ["template", "sceneId"]),
  operation("normalize_timeline_duration", { targetMs: num("Exact overlap-aware rendered duration in milliseconds."), sceneId: str("Scene whose duration absorbs the delta; defaults to final scene.") }, ["targetMs"]),
  operation("add_element", { sceneId: str(), element: creativeElementSchema, index: integer() }, ["sceneId", "element"]),
  operation("update_element", { sceneId: str(), elementId: str(), patch: obj("Partial CreativeElement; id/type cannot change.") }, ["sceneId", "elementId", "patch"]),
  operation("update_elements", {
    targets: {
      type: "array",
      minItems: 1,
      items: {
        type: "object",
        additionalProperties: false,
        properties: { sceneId: str(), elementId: str() },
        required: ["sceneId", "elementId"],
      },
      description: "Explicit targets. Give this or elementIdEndsWith, not both.",
    },
    elementIdEndsWith: str("Selects every element whose id ends with this. A selector matching nothing is an error, not a no-op."),
    selector: {
      type: "object", additionalProperties: false,
      properties: {
        aliases: { type: "array", minItems: 1, items: str() },
        tags: { type: "array", minItems: 1, items: str() },
        type: { type: "string", enum: [...CREATIVE_ELEMENT_TYPES] },
        role: { type: "string", enum: ["background"] },
        nameContains: str(),
      },
      description: "Semantic selector; all supplied criteria must match.",
    },
    sceneIds: { type: "array", minItems: 1, items: str(), description: "Narrows suffix/semantic selectors to these scenes." },
    patch: obj("Partial CreativeElement applied to every matched element; id/type cannot change."),
  }, ["patch"]),
  operation("remove_element", { sceneId: str(), elementId: str() }, ["sceneId", "elementId"]),
  operation("reorder_element", { sceneId: str(), elementId: str(), toIndex: integer() }, ["sceneId", "elementId", "toIndex"]),
  operation("move_element", { sceneId: str(), elementId: str(), x: num(), y: num() }, ["sceneId", "elementId", "x", "y"]),
  operation("resize_element", { sceneId: str(), elementId: str(), width: num(), height: num() }, ["sceneId", "elementId", "width", "height"]),
  operation("set_text", { sceneId: str(), elementId: str(), text: { type: "string" } }, ["sceneId", "elementId", "text"]),
  operation("set_hidden", { sceneId: str(), elementId: str(), hidden: bool() }, ["sceneId", "elementId", "hidden"]),
  operation("set_locked", { sceneId: str(), elementId: str(), locked: bool() }, ["sceneId", "elementId", "locked"]),
  operation("set_timing", { sceneId: str(), elementId: str(), timing: { type: "object", additionalProperties: false, properties: { startMs: num(), endMs: num() }, required: ["startMs", "endMs"] } }, ["sceneId", "elementId"]),
  operation("set_animation", { sceneId: str(), elementId: str(), animations: { type: "array", items: animationSchema } }, ["sceneId", "elementId", "animations"]),
  operation("apply_motion_preset", { sceneId: str(), elementId: str(), presetName: str("Key from designSystem.motion.presets."), startMs: num() }, ["sceneId", "elementId", "presetName", "startMs"]),
  operation("stagger_group", {
    sceneId: str(), groupId: str(), elementIds: { type: "array", minItems: 1, items: str() },
    property: { type: "string", enum: [...ANIMATION_PROPERTIES] },
    from: num(), to: num(), mode: { type: "string", enum: ["absolute", "delta", "multiplier"] },
    startMs: num(), durationMs: num(), staggerMs: num(), easing: easingSchema,
  }, ["sceneId", "groupId", "property", "from", "to", "startMs", "durationMs", "staggerMs", "easing"]),
  operation("orbit_group", {
    sceneId: str(), groupId: str(), itemIds: { type: "array", minItems: 1, items: str() },
    centerElementId: str(), centerX: num(), centerY: num(), radius: num(), startAngleDeg: num(),
    radiusTo: num(), rotateByDeg: num(), startMs: num(), endMs: num(), easing: easingSchema,
  }, ["sceneId", "groupId", "radius"]),
  operation("explode_text", {
    sceneId: str(), elementId: str(), granularity: { type: "string", enum: ["word", "character"] }, groupId: str(),
  }, ["sceneId", "elementId", "granularity"]),
  operation("add_scene", { scene: obj("Canonical CreativeScene."), index: integer() }, ["scene"]),
  operation("update_scene", { sceneId: str(), patch: obj("Partial CreativeScene excluding id.") }, ["sceneId", "patch"]),
  operation("remove_scene", { sceneId: str() }, ["sceneId"]),
  operation("reorder_scene", { sceneId: str(), toIndex: integer() }, ["sceneId", "toIndex"]),
  operation("animate_ui_node", {
    sceneId: str(), elementId: str(), nodeId: str(),
    animations: {
      type: "array",
      items: animationSchema,
      description: "Keyframe tracks over this node alone. x and y are viewport pixels relative to the parent node; scaleX, scaleY and rotation pivot about the node's own centre. Other properties are ignored.",
    },
  }, ["sceneId", "elementId", "nodeId", "animations"]),
  operation("set_ui_node_timing", {
    sceneId: str(), elementId: str(), nodeId: str(),
    timing: {
      type: "object", additionalProperties: false,
      properties: { startMs: num(), endMs: num() }, required: ["startMs", "endMs"],
      description: "Scene-local milliseconds, the same clock the element's own timing uses. Omit to clear. Hiding a node hides its children with it.",
    },
  }, ["sceneId", "elementId", "nodeId"]),
  operation("move_ui_node", {
    sceneId: str(), elementId: str(), nodeId: str(), x: num(), y: num(),
  }, ["sceneId", "elementId", "nodeId", "x", "y"]),
  operation("resize_ui_node", {
    sceneId: str(), elementId: str(), nodeId: str(), width: num(), height: num(),
  }, ["sceneId", "elementId", "nodeId", "width", "height"]),
  operation("continue_element", {
    continuation: {
      type: "object",
      additionalProperties: false,
      description: "One element becoming another across a scene boundary. The incoming element is drawn interpolating from where the outgoing one finished toward where it belongs, so the eye tracks one object through the cut. Must fit inside the scenes' overlap, which is the outgoing scene's transitionOut duration - a continuation with no overlap to happen in is rejected, naming the transition to lengthen.",
      properties: {
        id: str(),
        fromSceneId: str(), fromElementId: str(),
        toSceneId: str("Must be the scene immediately after fromSceneId."),
        toElementId: str(),
        durationMs: num(),
        easing: easingSchema,
      },
      required: ["id", "fromSceneId", "fromElementId", "toSceneId", "toElementId", "durationMs"],
    },
  }, ["continuation"]),
  operation("remove_continuation", { continuationId: str() }, ["continuationId"]),
  operation("continue_group", {
    continuation: {
      type: "object",
      additionalProperties: false,
      description: "One group becoming another across a scene boundary. The incoming group's transform interpolates from where the outgoing group's finished, so the whole cluster arrives as one composited object rather than snapping into place. Both groups need a transform (set_group_transform) because the transform is what carries the motion. Same overlap rule as continue_element: it must fit inside the outgoing scene's transitionOut. Use this instead of continue_element when a cluster changes as a unit - continuing one element while its labels stay separate leaves the old and new labels legible at the same time.",
      properties: {
        id: str(),
        fromSceneId: str(), fromGroupId: str(),
        toSceneId: str("Must be the scene immediately after fromSceneId."),
        toGroupId: str(),
        durationMs: num(),
        easing: easingSchema,
        childMapping: {
          type: "array",
          items: {
            type: "object", additionalProperties: false,
            properties: { fromElementId: str(), toElementId: str(), morphGeometry: bool() },
            required: ["fromElementId", "toElementId"],
          },
          description: "Incoming children that already have a counterpart on screen. These stay visible through the handoff; every other child of the incoming group is held back until it completes, because a child with no predecessor has nothing to hand off from and showing it early is exactly the doubling this removes. Mapping is explicit on purpose - heuristic matching would be guessing at intent. morphGeometry additionally interpolates that child's own position/size/rotation/opacity from its predecessor toward its own, on this same window and easing - the same blend continue_element gives a whole element. Omit it for visibility only, which is v1's whole behaviour. A child also named by its own continue_element ignores morphGeometry; the explicit continuation wins.",
        },
      },
      required: ["id", "fromSceneId", "fromGroupId", "toSceneId", "toGroupId", "durationMs"],
    },
  }, ["continuation"]),
  operation("remove_group_continuation", { continuationId: str() }, ["continuationId"]),
  operation("set_scene_camera", {
    sceneId: str(),
    camera: {
      type: "object",
      additionalProperties: false,
      properties: {
        transform: hierarchyTransformSchema,
        animations: hierarchyAnimationsSchema,
        perspectivePx: num("Perspective distance in pixels; omit for flat 2D."),
        perspectiveOriginX: num("Normalized 0-1 horizontal vanishing point."),
        perspectiveOriginY: num("Normalized 0-1 vertical vanishing point."),
      },
      required: ["transform"],
      description: "Omit to remove the camera from this scene.",
    },
  }, ["sceneId"]),
  operation("set_group_transform", {
    sceneId: str(),
    groupId: str(),
    transform: hierarchyTransformSchema,
    animations: hierarchyAnimationsSchema,
  }, ["sceneId", "groupId"]),
  operation("set_transition", { sceneId: str(), transition: transitionSchema }, ["sceneId"]),
  operation("split_clip", { sceneId: str(), elementId: str(), atMs: num("Scene-local millisecond strictly inside clip window.") }, ["sceneId", "elementId", "atMs"]),
  operation("trim_clip", { sceneId: str(), elementId: str(), startMs: num(), endMs: num() }, ["sceneId", "elementId"]),
  operation("slip_clip", { sceneId: str(), elementId: str(), byMs: num() }, ["sceneId", "elementId", "byMs"]),
  operation("set_clip_speed", { sceneId: str(), elementId: str(), speed: { type: "number", exclusiveMinimum: 0 }, mode: { type: "string", enum: ["hold_source", "hold_duration"] } }, ["sceneId", "elementId", "speed"]),
  operation("freeze_clip", { sceneId: str(), elementId: str(), atMs: num() }, ["sceneId", "elementId", "atMs"]),
  operation("duplicate_clip", { sceneId: str(), elementId: str(), atMs: num() }, ["sceneId", "elementId", "atMs"]),
  operation("apply_text_animation", {
    sceneId: str(), elementId: str(), childId: str("Optional direct text child id when elementId names a composite."), animation: textAnimationSchema,
  }, ["sceneId", "elementId"]),
  operation("set_text_fit", {
    sceneId: str(),
    elementId: str(),
    // Advertised as its real shape rather than an opaque object: the validator
    // requires both fields and rejects any other mode, so an author reading the
    // contract could not discover what it takes.
    fit: {
      type: "object",
      additionalProperties: false,
      properties: {
        mode: { type: "string", enum: [...TEXT_FIT_MODES], description: "shrink reduces the size until the text fits its box; none leaves it alone." },
        minFontSize: num("Smallest size shrink may reach, in px."),
      },
      required: ["mode", "minFontSize"],
      description: "CreativeTextFit; omit to clear.",
    },
  }, ["sceneId", "elementId"]),
  operation("set_counter", { sceneId: str(), elementId: str(), counter: counterSchema }, ["sceneId", "elementId"]),
  operation("set_adjustments", { sceneId: str(), elementId: str(), adjustments: obj("CreativeAdjustments; omit to clear.") }, ["sceneId", "elementId"]),
  operation("add_audio_clip", { clip: audioClipSchema }, ["clip"]),
  operation("update_audio_clip", { clipId: str(), patch: obj("Partial CreativeAudioClip excluding id.") }, ["clipId", "patch"]),
  operation("remove_audio_clip", { clipId: str() }, ["clipId"]),
  operation("set_clip_speed_ramp", { sceneId: str(), elementId: str(), speedRamp: speedRampSchema }, ["sceneId", "elementId"]),
  operation("set_mask", { sceneId: str(), elementId: str(), mask: maskSchema }, ["sceneId", "elementId"]),
  operation("set_motion_blur", { sceneId: str(), elementId: str(), motionBlur: motionBlurSchema }, ["sceneId", "elementId"]),
  operation("set_fill", {
    sceneId: str(), elementId: str(), fill: colorSchema,
  }, ["sceneId", "elementId", "fill"]),
  operation("set_gradient_animation", { sceneId: str(), elementId: str(), animation: gradientAnimationSchema }, ["sceneId", "elementId"]),
  operation("set_shape_morph", {
    sceneId: str(), elementId: str(), morph: shapeMorphSchema,
  }, ["sceneId", "elementId"]),
  operation("set_connector", {
    sceneId: str(), elementId: str(),
    fromElementId: str(), toElementId: str(),
    curve: { type: "string", enum: [...CONNECTOR_CURVES] },
    stroke: strokeSchema,
    drawProgress: num("0-1 path reveal. Animate drawProgress for a draw-on edge."),
  }, ["sceneId", "elementId"]),
  operation("set_blend_mode", {
    sceneId: str(), elementId: str(),
    blendMode: { type: "string", enum: [...BLEND_MODES], description: "Omit to clear back to normal." },
  }, ["sceneId", "elementId"]),
  operation("set_chart_data", {
    sceneId: str(), elementId: str(),
    chartKind: { type: "string", enum: [...CREATIVE_CHART_KINDS] },
    series: { type: "array", minItems: 1, items: num(), description: "Chart values only; points are spaced evenly along the x axis." },
    axisMin: num("Omit to derive from the series - line stays tight to the data, area/bar envelope zero."),
    axisMax: num("Omit to derive from the series."),
    drawProgress: num("0-1, how much of the line/bars is drawn. Defaults to 1."),
    fillProgress: num("Optional 0-1 base area-fill reveal. Omit to mirror drawProgress."),
    staggerPoints: num("Optional 0-1 cascade strength for generated chart parts."),
    stroke: strokeSchema,
    fill: colorSchema,
  }, ["sceneId", "elementId", "chartKind", "series", "stroke"]),
  operation("set_glass", {
    sceneId: str(), elementId: str(),
    glass: glassSchema,
  }, ["sceneId", "elementId"]),
  operation("set_chart_axes", {
    sceneId: str(), elementId: str(),
    axes: chartAxesSchema,
    callouts: { type: "array", items: chartCalloutSchema },
    labelStyle: {
      type: "object", additionalProperties: false,
      properties: { token: str("Typography token id."), overrides: obj("Partial TextStyleToken overrides.") },
      required: ["token"],
    },
  }, ["sceneId", "elementId"]),
  operation("set_chart_point_emphasis", {
    sceneId: str(), elementId: str(),
    index: integer("Index into the chart's series, 0-based."),
    scale: num("Marker radius multiplier for line/area; ignored for bar. Omit together with color to remove emphasis from this point."),
    color: colorSchema,
  }, ["sceneId", "elementId", "index"]),
  operation("add_marker", { marker: markerSchema }, ["marker"]),
  operation("remove_marker", { markerId: str() }, ["markerId"]),
  operation("create_group", { sceneId: str(), group: obj("CreativeGroup { id, name, elementIds }." ) }, ["sceneId", "group"]),
  operation("update_group", { sceneId: str(), groupId: str(), patch: obj("Partial CreativeGroup excluding id.") }, ["sceneId", "groupId", "patch"]),
  operation("ungroup", { sceneId: str(), groupId: str() }, ["sceneId", "groupId"]),
  operation("set_design_token", {
    namespace: { type: "string", enum: ["colors", "spacing", "radii", "typography"] },
    token: str(), value: {},
  }, ["namespace", "token", "value"]),
];

export const CREATIVE_OPERATION_TYPES = operationSchemas.map((schema) =>
  ((schema.properties as Record<string, JsonSchema>).type as { enum: string[] }).enum[0],
);

export const CREATIVE_OPERATION_SCHEMA: JsonSchema = { oneOf: operationSchemas };

function inputObject(value: unknown, label = "operation"): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error(`${label} must be an object`);
  return value as Record<string, unknown>;
}

function requiredString(input: Record<string, unknown>, key: string): string {
  const value = typeof input[key] === "string" ? input[key].trim() : "";
  if (!value) throw new Error(`${key} is required`);
  return value;
}

function requiredNumber(input: Record<string, unknown>, key: string): number {
  const value = input[key];
  if (typeof value !== "number" || !Number.isFinite(value)) throw new Error(`${key} is required and must be a finite number`);
  return value;
}

function requiredBoolean(input: Record<string, unknown>, key: string): boolean {
  const value = input[key];
  if (typeof value !== "boolean") throw new Error(`${key} is required and must be boolean`);
  return value;
}

function requiredObject(input: Record<string, unknown>, key: string): Record<string, unknown> {
  const value = input[key];
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error(`${key} is required and must be an object`);
  return value as Record<string, unknown>;
}

function requiredArray(input: Record<string, unknown>, key: string): unknown[] {
  const value = input[key];
  if (!Array.isArray(value)) throw new Error(`${key} is required and must be an array`);
  return value;
}

function requireValue(input: Record<string, unknown>, key: string): void {
  if (input[key] === undefined) throw new Error(`${key} is required`);
}

function optionalObject(input: Record<string, unknown>, key: string): void {
  if (input[key] !== undefined) requiredObject(input, key);
}

function assertFiniteOptional(input: Record<string, unknown>, key: string): void {
  if (input[key] === undefined) return;
  requiredNumber(input, key);
}

/**
 * Runtime counterpart to the public JSON schema. This catches missing or
 * misspelled top-level arguments before any operation can dereference
 * `undefined` or attempt to JSON-clone it. Deep CreativeDocument semantics
 * remain the canonical validator's responsibility after the transaction.
 */
export function parseCreativeOperationInput(value: unknown): CreativeTransactionOperation {
  const input = inputObject(value);
  const type = requiredString(input, "type");
  if (!CREATIVE_OPERATION_TYPES.includes(type)) throw new Error(`Unsupported operation: ${type}`);

  const sceneElement = () => { requiredString(input, "sceneId"); requiredString(input, "elementId"); };
  switch (type) {
    case "set_canvas":
      if (input.width === undefined && input.height === undefined && input.fps === undefined) throw new Error("set_canvas requires width, height or fps");
      assertFiniteOptional(input, "width"); assertFiniteOptional(input, "height"); assertFiniteOptional(input, "fps");
      break;
    case "set_project_scratchpad": if (typeof input.scratchpad !== "string") throw new Error("scratchpad must be a string"); break;
    case "set_asset_alias": requiredString(input, "alias"); if (input.assetId !== undefined) requiredString(input, "assetId"); break;
    case "set_project_attachment": { const attachment = requiredObject(input, "attachment"); requiredString(attachment, "id"); requiredString(attachment, "kind"); requiredString(attachment, "assetId"); if (attachment.label !== undefined && typeof attachment.label !== "string") throw new Error("attachment.label must be a string"); break; }
    case "remove_project_attachment": requiredString(input, "attachmentId"); break;
    case "add_composition_template": requiredString(input, "template"); requiredString(input, "sceneId"); assertFiniteOptional(input, "durationMs"); assertFiniteOptional(input, "index"); break;
    case "normalize_timeline_duration": requiredNumber(input, "targetMs"); if (input.sceneId !== undefined && (typeof input.sceneId !== "string" || !input.sceneId.trim())) throw new Error("sceneId must be a non-empty string"); break;
    case "add_element": requiredString(input, "sceneId"); requiredObject(input, "element"); break;
    case "update_element": sceneElement(); requiredObject(input, "patch"); break;
    case "update_elements": {
      requiredObject(input, "patch");
      const hasTargets = input.targets !== undefined;
      const hasSuffix = input.elementIdEndsWith !== undefined;
      const hasSelector = input.selector !== undefined;
      if ([hasTargets, hasSuffix, hasSelector].filter(Boolean).length !== 1) throw new Error("update_elements requires exactly one of targets, elementIdEndsWith or selector");
      if (hasTargets) {
        const targets = requiredArray(input, "targets");
        if (!targets.length) throw new Error("update_elements targets must not be empty");
        targets.forEach((target, index) => {
          const entry = inputObject(target, `targets[${index}]`);
          requiredString(entry, "sceneId");
          requiredString(entry, "elementId");
        });
      } else if (hasSuffix) {
        requiredString(input, "elementIdEndsWith");
      } else {
        requiredObject(input, "selector");
      }
      if (input.sceneIds !== undefined) {
        const sceneIds = requiredArray(input, "sceneIds");
        if (!sceneIds.length) throw new Error("update_elements sceneIds must not be empty");
        sceneIds.forEach((id, index) => {
          if (typeof id !== "string" || !id.trim()) throw new Error(`sceneIds[${index}] must be a non-empty string`);
        });
      }
      break;
    }
    case "remove_element": sceneElement(); break;
    case "reorder_element": sceneElement(); requiredNumber(input, "toIndex"); break;
    case "move_element": sceneElement(); requiredNumber(input, "x"); requiredNumber(input, "y"); break;
    case "resize_element": sceneElement(); requiredNumber(input, "width"); requiredNumber(input, "height"); break;
    case "set_text": sceneElement(); if (typeof input.text !== "string") throw new Error("text is required and must be a string"); break;
    case "set_hidden": sceneElement(); requiredBoolean(input, "hidden"); break;
    case "set_locked": sceneElement(); requiredBoolean(input, "locked"); break;
    case "set_timing": sceneElement(); optionalObject(input, "timing"); break;
    case "set_animation": sceneElement(); requiredArray(input, "animations"); break;
    case "apply_motion_preset": sceneElement(); requiredString(input, "presetName"); requiredNumber(input, "startMs"); break;
    case "stagger_group":
      requiredString(input, "sceneId"); requiredString(input, "groupId"); requiredString(input, "property");
      requiredNumber(input, "from"); requiredNumber(input, "to"); requiredNumber(input, "startMs"); requiredNumber(input, "durationMs"); requiredNumber(input, "staggerMs");
      requireValue(input, "easing");
      if (input.elementIds !== undefined) requiredArray(input, "elementIds");
      break;
    case "orbit_group":
      requiredString(input, "sceneId"); requiredString(input, "groupId"); requiredNumber(input, "radius");
      if (input.itemIds !== undefined) requiredArray(input, "itemIds");
      if (input.centerElementId !== undefined && (typeof input.centerElementId !== "string" || !input.centerElementId.trim())) throw new Error("centerElementId must be a non-empty string");
      for (const key of ["centerX", "centerY", "startAngleDeg", "radiusTo", "rotateByDeg", "startMs", "endMs"] as const) assertFiniteOptional(input, key);
      break;
    case "explode_text":
      sceneElement(); requiredString(input, "granularity");
      if (input.groupId !== undefined && (typeof input.groupId !== "string" || !input.groupId.trim())) throw new Error("groupId must be a non-empty string");
      break;
    case "add_scene": requiredObject(input, "scene"); break;
    case "update_scene": requiredString(input, "sceneId"); requiredObject(input, "patch"); break;
    case "remove_scene": requiredString(input, "sceneId"); break;
    case "reorder_scene": requiredString(input, "sceneId"); requiredNumber(input, "toIndex"); break;
    case "animate_ui_node":
      sceneElement(); requiredString(input, "nodeId"); requiredArray(input, "animations");
      break;
    case "set_ui_node_timing":
      sceneElement(); requiredString(input, "nodeId"); optionalObject(input, "timing");
      break;
    case "move_ui_node":
      sceneElement(); requiredString(input, "nodeId");
      requiredNumber(input, "x"); requiredNumber(input, "y");
      break;
    case "resize_ui_node":
      sceneElement(); requiredString(input, "nodeId");
      requiredNumber(input, "width"); requiredNumber(input, "height");
      break;
    case "continue_element":
    case "continue_group":
      requiredObject(input, "continuation");
      break;
    case "remove_group_continuation":
      requiredString(input, "continuationId");
      break;
    case "remove_continuation":
      requiredString(input, "continuationId");
      break;
    case "set_scene_camera":
      requiredString(input, "sceneId");
      optionalObject(input, "camera");
      break;
    case "set_group_transform":
      requiredString(input, "sceneId");
      requiredString(input, "groupId");
      optionalObject(input, "transform");
      break;
    case "set_transition": requiredString(input, "sceneId"); optionalObject(input, "transition"); break;
    case "split_clip": sceneElement(); requiredNumber(input, "atMs"); break;
    case "trim_clip":
      sceneElement();
      if (input.startMs === undefined && input.endMs === undefined) throw new Error("trim_clip requires startMs or endMs");
      assertFiniteOptional(input, "startMs"); assertFiniteOptional(input, "endMs");
      break;
    case "slip_clip": sceneElement(); requiredNumber(input, "byMs"); break;
    case "set_clip_speed":
      sceneElement();
      if (requiredNumber(input, "speed") <= 0) throw new Error("speed must be positive");
      if (input.mode !== undefined && input.mode !== "hold_source" && input.mode !== "hold_duration") throw new Error("mode must be hold_source or hold_duration");
      break;
    case "freeze_clip": sceneElement(); requiredNumber(input, "atMs"); break;
    case "duplicate_clip": sceneElement(); requiredNumber(input, "atMs"); break;
    case "apply_text_animation":
      sceneElement(); optionalObject(input, "animation");
      if (input.childId !== undefined) requiredString(input, "childId");
      break;
    case "set_text_fit": sceneElement(); optionalObject(input, "fit"); break;
    case "set_counter": sceneElement(); optionalObject(input, "counter"); break;
    case "set_adjustments": sceneElement(); optionalObject(input, "adjustments"); break;
    case "add_audio_clip": requiredObject(input, "clip"); break;
    case "update_audio_clip": requiredString(input, "clipId"); requiredObject(input, "patch"); break;
    case "remove_audio_clip": requiredString(input, "clipId"); break;
    case "set_clip_speed_ramp": sceneElement(); optionalObject(input, "speedRamp"); break;
    case "set_mask": sceneElement(); optionalObject(input, "mask"); break;
    case "set_motion_blur": sceneElement(); optionalObject(input, "motionBlur"); break;
    case "set_fill": sceneElement(); requiredObject(input, "fill"); break;
    case "set_gradient_animation": sceneElement(); optionalObject(input, "animation"); break;
    case "set_shape_morph": sceneElement(); optionalObject(input, "morph"); break;
    case "set_connector":
      sceneElement();
      for (const key of ["fromElementId", "toElementId", "curve"] as const) {
        if (input[key] !== undefined && (typeof input[key] !== "string" || !String(input[key]).trim())) {
          throw new Error(`${key} must be a non-empty string`);
        }
      }
      optionalObject(input, "stroke");
      assertFiniteOptional(input, "drawProgress");
      break;
    case "set_blend_mode":
      sceneElement();
      if (input.blendMode !== undefined && typeof input.blendMode !== "string") throw new Error("blendMode must be a string");
      break;
    case "set_glass": sceneElement(); break;
    case "set_chart_axes": sceneElement(); break;
    case "set_chart_data":
      sceneElement();
      requiredString(input, "chartKind");
      requiredArray(input, "series");
      requiredObject(input, "stroke");
      break;
    case "set_chart_point_emphasis":
      sceneElement();
      requiredNumber(input, "index");
      break;
    case "add_marker": requiredObject(input, "marker"); break;
    case "remove_marker": requiredString(input, "markerId"); break;
    case "create_group": requiredString(input, "sceneId"); requiredObject(input, "group"); break;
    case "update_group": requiredString(input, "sceneId"); requiredString(input, "groupId"); requiredObject(input, "patch"); break;
    case "ungroup": requiredString(input, "sceneId"); requiredString(input, "groupId"); break;
    case "set_design_token":
      requiredString(input, "namespace"); requiredString(input, "token"); requireValue(input, "value");
      if (!["colors", "spacing", "radii", "typography"].includes(String(input.namespace))) throw new Error("namespace must be colors, spacing, radii or typography");
      break;
  }

  return input as unknown as CreativeTransactionOperation;
}
