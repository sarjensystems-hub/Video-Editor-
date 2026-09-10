/**
 * What the tool surface refuses to say out loud.
 *
 * Three separate build reports lost time to the same class of gap, and none of
 * them is a missing capability:
 *
 *  - The advertised schema for `add_element.element`, `update_element.patch`
 *    and `add_scene.scene` is `additionalProperties: true` with prose. Every
 *    value shape - element-per-type, `style { token, overrides }`, keyframe
 *    easing, `ui` node kinds - has to be reverse-engineered by sending a
 *    transaction and reading the rejection. (roadmap #61)
 *  - `apply_text_animation.startMs` is element-local while
 *    `apply_motion_preset.startMs` and every keyframe `timeMs` are scene-local,
 *    and audio clips are on the rendered timeline. Nothing said so; it was
 *    found by rendering a wrong frame. (roadmap #62)
 *  - Structural rules - one group per element, connectors are never grouped,
 *    `continue_group` needs a transform on both sides - each cost a whole
 *    rejected transaction. `dry_run` cannot help, because you cannot test for
 *    a rule you do not know exists. (roadmap #63)
 *
 * The fix is not more prose. Prose drifts, which is exactly how `set_text_fit`
 * came to advertise an opaque object for a value the validator required two
 * specific fields of. So every example here is executable: the guard test
 * applies each one through the real transaction pipeline against a fixture,
 * and an example that stops being valid fails the suite rather than misleading
 * a caller. Invariants name the operations they constrain and time bases name
 * the field they describe, and both are checked against the advertised schema.
 *
 * The examples deliberately use the same handful of ids throughout - scene-1,
 * scene-2, title, plate, panel, metric, edge, shot, still, card - so that
 * reading two operations side by side shows how they compose rather than
 * making the reader re-anchor on new names each time.
 */

import {
  ANIMATION_PROPERTIES,
  BLEND_MODES,
  CHART_LABEL_FORMATS,
  CONNECTOR_CURVES,
  CREATIVE_AUDIO_KINDS,
  CREATIVE_CHART_KINDS,
  CREATIVE_COMPOSITE_MAX_DEPTH,
  CREATIVE_COMPOSITE_MAX_DESCENDANTS,
  CREATIVE_ELEMENT_TYPES,
  CREATIVE_MARKER_KINDS,
  CREATIVE_MASK_KINDS,
  CREATIVE_UI_MAX_DEPTH,
  CREATIVE_UI_MAX_NODES,
  CREATIVE_UI_NODE_KINDS,
  EASING_NAMES,
  GRADIENT_KINDS,
  SCENE_TRANSITION_KINDS,
  TEXT_ANIMATION_GRANULARITIES,
  TEXT_ANIMATION_MODES,
  TEXT_FIT_MODES,
} from "./schema";
import { CREATIVE_OPERATION_TYPES } from "./operation-contract";

/**
 * Operations one transaction accepts. Advertised as `maxItems` on the edit
 * tool's operations array and stated nowhere else a reader would look; the
 * guard test holds this equal to the advertised value, and
 * `parseCreativeTransactionInput` (mcp-runtime-base.ts) is what actually
 * enforces it - the advertised schema alone never did, so a caller that did
 * not itself validate against it could previously send an unbounded array.
 *
 * Raised from 100 (roadmap #71) after the SARA production build hit the old
 * cap: missing group nesting (#59) forces one composite "card" into several
 * separate elements with independently duplicated keyframe tracks, which
 * inflates op count for reasons that have nothing to do with a transaction
 * of that size being expensive. It is not: `applyCreativeTransaction`
 * revalidates the whole document after every operation (there is no
 * incremental validation), so cost is transaction size times document size,
 * not transaction size alone - and measured against a document 2.5x larger
 * than the largest real production this roadmap has measured (500 elements
 * vs. SARA's ~200), a 500-operation transaction completes in the low
 * hundreds of milliseconds. 500 is five times the old cap: enough headroom
 * to absorb the #59 inflation without #59 itself being fixed, while staying
 * an order of magnitude under where cost would start to feel slow even
 * against that oversized document. See work/transaction-cost.json for the
 * measurements this number is based on.
 */
export const MAX_TRANSACTION_OPERATIONS = 500;

/** A time value's clock. Getting this wrong renders a correct-looking wrong frame. */
export type CreativeTimeBasis =
  | "scene-local"
  | "element-local"
  | "rendered-timeline"
  | "source-local"
  | "duration";

/** A positional value's frame of reference. */
export type CreativeCoordinateSpace =
  | "canvas-pixels"
  | "viewport-pixels"
  | "normalized-element"
  | "normalized-canvas"
  | "normalized-chart"
  | "relative-to-current";

export interface CreativeTimeBaseEntry {
  /** Dotted path from the operation object, e.g. "animation.startMs". */
  readonly field: string;
  /** Operation types this field appears on. */
  readonly operations: readonly string[];
  readonly basis: CreativeTimeBasis;
  readonly note: string;
}

export interface CreativeCoordinateEntry {
  readonly field: string;
  readonly operations: readonly string[];
  readonly space: CreativeCoordinateSpace;
  readonly note: string;
}

export interface CreativeStructuralInvariant {
  readonly id: string;
  /** The rule, stated as the thing that is true rather than the error text. */
  readonly rule: string;
  /** Operation types a caller can violate this with. */
  readonly operations: readonly string[];
  /** What it looks like when you hit it. */
  readonly symptom: string;
}

export interface CreativeOperationExample {
  readonly type: string;
  /** A complete, valid operation. Executable: the guard test applies it. */
  readonly example: Record<string, unknown>;
  /** Only where the shape alone does not carry the intent. */
  readonly note?: string;
}

/* -------------------------------------------------------------------------- */
/* #63 - structural invariants                                                 */
/* -------------------------------------------------------------------------- */

export const CREATIVE_STRUCTURAL_INVARIANTS: readonly CreativeStructuralInvariant[] = [
  {
    id: "one-group-per-element",
    rule: "An element belongs to at most one group, and groups do not nest - that has not changed and is not going to. It no longer matters for a card: author a glass panel with its heading and its chart as a single `composite` element (roadmap #59) - real children (chart/text/shape/image/video, even a nested composite), positioned on the composite's own local viewport, sharing the composite's one transform - then put the composite itself in a group. stagger_group and orbit_group then move the whole card as one unit, because the group has exactly one child: the composite. `ui` is a different tool, for closed hand-laid-out product interface (box/text/image nodes only, no chart, no glass on a node) - not a workaround for this rule, which is what this invariant used to say and was wrong.",
    operations: ["create_group", "update_group", "duplicate_group", "stagger_group", "orbit_group", "add_element"],
    symptom: "create_group is rejected naming the element already in another group.",
  },
  {
    id: "connectors-are-never-grouped",
    rule: "A connector element is derived from the two elements it joins and is never a member of a group. It follows its endpoints, so grouping it would move it twice.",
    operations: ["create_group", "update_group", "duplicate_group"],
    symptom: "A group listing a connector id is rejected.",
  },
  {
    id: "connector-endpoints-are-same-scene",
    rule: "fromElementId and toElementId must both name elements in the connector's own scene. An endpoint that is hidden or outside its timing window still routes, so an edge can be drawn to a node nobody can see.",
    operations: ["set_connector", "add_element"],
    symptom: "A connector to a missing id is rejected; a connector to a hidden element renders as an edge into empty space.",
  },
  {
    id: "continuation-needs-overlap",
    rule: "continue_element and continue_group must fit inside the overlap between the two scenes, which is the outgoing scene's transitionOut duration. toSceneId must be the scene immediately after fromSceneId.",
    operations: ["continue_element", "continue_group", "set_transition"],
    symptom: "Rejected naming the transition to lengthen. With no transition there is no overlap at all, so every continuation fails until set_transition runs first.",
  },
  {
    id: "continue-group-needs-both-transforms",
    rule: "continue_group requires a group transform on both the outgoing and the incoming group, because the transform is the thing that carries the motion. set_group_transform on each, then continue_group.",
    operations: ["continue_group", "set_group_transform"],
    symptom: "Rejected on a group that has children but no transform - which is the normal state of a freshly created group.",
  },
  {
    id: "group-child-morph-shares-the-groups-window",
    rule: "childMapping[].morphGeometry interpolates that child's own position/size/rotation/opacity from its predecessor's resolved end state toward its own, on the group continuation's own durationMs and easing - there is no separate window to set per child. A child also named by its own top-level continue_element ignores morphGeometry entirely: the explicit continuation is the more specific instruction and wins outright rather than the two blends compounding.",
    operations: ["continue_group", "continue_element"],
    symptom: "A morphGeometry pair that appears to do nothing - the element also carries its own continue_element, which is the one actually resolving its transform.",
  },
  {
    id: "create-seeds-a-scene",
    rule: "create_creative_project starts the document with one empty scene, scene-1, of 5000ms. It is a real scene: add_element into it rather than adding a second scene and leaving a blank five seconds at the head of the film.",
    operations: ["add_element", "add_scene", "remove_scene"],
    symptom: "A film that opens on five seconds of background because the first authored scene went in after the seeded one.",
  },
  {
    id: "composition-template-creates-its-scene",
    rule: "add_composition_template.sceneId names a scene it creates, not one it adds to. Its elements are namespaced under that id - grid.background, grid.metric-1 - so they can be selected afterwards with update_elements.",
    operations: ["add_composition_template"],
    symptom: "Passing an existing scene id is rejected as a duplicate scene, which reads like a bug in the template rather than a misread argument.",
  },
  {
    id: "group-motion-fits-the-visible-window",
    rule: "stagger_group and orbit_group run inside every child's own visible window. A group whose members appear at different times can only move together for the span they are all on screen.",
    operations: ["stagger_group", "orbit_group", "set_timing"],
    symptom: "Rejected naming the child and the window it fell outside - usually after timing was staggered but the group motion was left at the scene bounds.",
  },
  {
    id: "counter-fits-the-visible-window",
    rule: "set_counter's startMs + durationMs must finish inside the element's own visible window, the same rule apply_text_animation's run follows. The count reaches `to` while the text is still on screen rather than being cut off mid-count when it disappears.",
    operations: ["set_counter", "set_timing"],
    symptom: "Rejected naming the element and the window the count fell outside - usually after durationMs was lengthened but the element's own timing was left as authored.",
  },
  {
    id: "callout-timing-fits-the-chart-window",
    rule: "A callout's startMs, and startMs + durationMs when durationMs is set, must fall inside the owning chart element's own visible window - startMs is scene-local, unlike set_counter's element-local clock, but the fits-the-window shape is the same rule. durationMs and fadeMs both require startMs, since neither means anything without it, and fadeMs cannot exceed durationMs for the same reason an audio clip's fadeInMs/fadeOutMs cannot exceed the clip.",
    operations: ["set_chart_axes", "add_element", "set_timing"],
    symptom: "Rejected naming the callout and the chart element's own window it fell outside - usually after the chart's own timing was narrowed but the callout was left at its old numbers.",
  },
  {
    id: "clip-retiming-changes-the-slot",
    rule: "set_clip_speed in hold_source mode and any speed ramp change how long the clip occupies the scene. The scene must be long enough for the result; hold_duration keeps the slot fixed instead and changes which frames fill it.",
    operations: ["set_clip_speed", "set_clip_speed_ramp", "duplicate_clip", "update_scene"],
    symptom: "A half-speed clip is rejected on timing rather than on speed, because the failure is the scene being too short for the retimed clip.",
  },
  {
    id: "gradient-animation-needs-a-gradient",
    rule: "set_gradient_animation applies to a shape whose fill is already a gradient. Set the fill first with set_fill, then animate it.",
    operations: ["set_gradient_animation", "set_fill"],
    symptom: "Rejected naming the element as needing a shape with a gradient fill.",
  },
  {
    id: "document-keeps-one-scene",
    rule: "A document always has at least one scene; remove_scene on the last one is rejected.",
    operations: ["remove_scene"],
    symptom: "Clearing the seeded scene before authoring fails unless the replacement is added first.",
  },
  {
    id: "chart-paint-is-flat",
    rule: "Chart strokes, fills and point emphasis render as SVG paint and take a literal or token colour only. Gradients are valid for shape fills, element and scene backgrounds and `ui` surfaces, and are rejected everywhere else - including a gradient stop's own colour.",
    operations: ["set_chart_data", "set_chart_point_emphasis", "set_connector", "set_fill", "add_element"],
    symptom: "A gradient on a chart is rejected naming a literal or token colour as the fix.",
  },
  {
    id: "chart-labels-need-a-style",
    rule: "A chart that draws any text - value labels, categories, callouts - needs labelStyle. Chart text has no element of its own to inherit typography from.",
    operations: ["set_chart_axes", "add_element"],
    symptom: "Axes with categories or valueLabels are rejected until labelStyle names a typography token.",
  },
  {
    id: "ui-trees-are-closed",
    rule: `A ui element accepts no HTML, script or external URL. Nodes are box, text or image only; images reference registered asset ids; colour and typography are literal values or design tokens. Depth is capped at ${CREATIVE_UI_MAX_DEPTH} and node count at ${CREATIVE_UI_MAX_NODES}.`,
    operations: ["add_element", "update_element", "animate_ui_node"],
    symptom: "A markup string or remote URL inside a ui element is rejected outright.",
  },
  {
    id: "ui-layout-has-one-frame-owner",
    rule: "A UI child's frame is owned either by its parent flex/grid layout or by its own constraints, never both. Without parent layout, start pairs with left/top, end with right/bottom, center accepts no edge offset, and stretch may use both edges; incompatible combinations are rejected rather than silently ignored.",
    operations: ["add_element", "update_element", "move_ui_node", "resize_ui_node"],
    symptom: "A responsive node shifts differently from its authored offsets because two layout systems tried to own the same frame.",
  },
  {
    id: "ui-node-ids-are-element-scoped",
    rule: "animate_ui_node, set_ui_node_timing, move_ui_node and resize_ui_node address a node by id within one ui element, not by a document-wide id. Hiding a node hides its children with it.",
    operations: ["animate_ui_node", "set_ui_node_timing", "move_ui_node", "resize_ui_node"],
    symptom: "A node id that exists in a different ui element is reported as not found.",
  },
  {
    id: "composite-children-are-real-elements",
    rule: `A composite's children are ordinary CreativeElements - any type except connector, positioned in the composite's own viewport pixels (not canvas pixels) with their own transform, timing and animations on the SAME scene clock the composite and every top-level element use, one film one timebase. A child may itself be a composite, nested up to ${CREATIVE_COMPOSITE_MAX_DEPTH} levels deep and ${CREATIVE_COMPOSITE_MAX_DESCENDANTS} descendants in the whole tree. Connector is excluded because it addresses two scene-level element ids (fromElementId/toElementId resolved against scene.elements), and a composite child has no such id to be pointed at. A child's own id only has to be unique within its owning composite's subtree, not document-wide. apply_text_animation addresses a direct text child with elementId + childId; other child edits still replace the composite's children array with update_element.`,
    operations: ["add_element", "update_element"],
    symptom: "A connector inside composite.children, or nesting past the depth or descendant cap, is rejected naming the composite.",
  },
  {
    id: "ids-are-immutable",
    rule: "update_element and update_elements cannot change an element's id or type, and update_scene is scene-level only: it must not replace elements or groups. Use the dedicated element, timing, animation, reorder and group operations for layer edits.",
    operations: ["update_element", "update_elements", "update_scene"],
    symptom: "A patch carrying elements is rejected, or silently loses native layers if it were allowed.",
  },
  {
    id: "selectors-must-match",
    rule: "update_elements takes exactly one of targets, elementIdEndsWith or selector, and a selector matching nothing fails the transaction rather than quietly doing nothing.",
    operations: ["update_elements"],
    symptom: "A restyle that appears to succeed but changed nothing - which is what failing loudly prevents.",
  },
  {
    id: "transactions-are-atomic",
    rule: `A transaction applies whole or not at all, and carries at most ${MAX_TRANSACTION_OPERATIONS} operations. A rejection names the failing operation index and reports validated_count - how many leading operations, applied together, already produced a valid document - and no partial mutation is written either way.`,
    operations: [],
    symptom: "A late failure in a long transaction costs a wasted resend of the operations before it, unless the caller reads validated_count and resends only from there.",
  },
  {
    id: "media-needs-registered-assets",
    rule: "image, video and ui image nodes reference an assetId already registered with add_asset, generate_image_asset, generate_speech_asset, generate_music_asset or promote_video_asset. A raw URL is not an asset id.",
    operations: ["add_element", "update_element", "add_audio_clip"],
    symptom: "An element carrying a URL where an asset id belongs is rejected before anything is written.",
  },
  {
    id: "locked-layers-stay-put",
    rule: "A locked element is not mutated by ordinary edits. Unlock it with set_locked first if the change is intended.",
    operations: ["set_locked", "update_element", "update_elements", "move_element", "resize_element"],
    symptom: "An edit that appears to apply to every matched element but skips the locked ones.",
  },
] as const;

/* -------------------------------------------------------------------------- */
/* #62 - time bases and coordinate spaces                                      */
/* -------------------------------------------------------------------------- */

export const CREATIVE_TIME_BASES: readonly CreativeTimeBaseEntry[] = [
  {
    field: "animation.startMs / counter.startMs",
    operations: ["apply_text_animation", "set_counter"],
    basis: "element-local",
    note: "Measured from the start of the element's own visible window, not from the start of the scene. These, and morph.startMs below, are the operations that differ this way: a text element visible from 2000ms with animation.startMs 0 begins its cascade at scene time 2000ms, and one with counter.startMs 0 begins counting at scene time 2000ms too. See resolveTextUnitState in text-animation.ts and resolveCounterValue in counter.ts, both of which resolve against localMs, and the validator, which bounds each run by the element's own visible duration.",
  },
  {
    field: "morph.startMs / durationMs",
    operations: ["set_shape_morph"],
    basis: "element-local",
    note: "Measured from the start of the element's own visible window, the same clock counter.startMs and animation.startMs (just above) already use - deliberately NOT scene-local like a chart's drawProgress keyframes or a chart callout's startMs (just below), even though a shape morph is exactly the kind of 'one element's own beat' those two clocks were each named for once. The reasoning follows the counter precedent: a morph has nothing on another element's own clock to line up against, so there is no reason to force element.timing.startMs + offset arithmetic the way a chart callout timed against the chart's own draw-on keyframes needs. See resolveShapeMorphProgress in shape-morph.ts, and the validator, which bounds the run by the element's own visible duration exactly like set_counter's.",
  },
  {
    field: "callouts[].startMs / durationMs / fadeMs",
    operations: ["set_chart_axes", "add_element"],
    basis: "scene-local",
    note: "Deliberately NOT element-local like the entry just above, even though a callout sits inside a chart element the same way a counter sits inside a text element. A callout is authored beside the drawProgress keyframes that reveal the point it annotates, and those keyframes are scene-local (see animations[].keyframes[].timeMs below) - sharing that clock is what makes 'the callout lands a second after the bars finish drawing' a plain startMs = (that keyframe's own timeMs) + 1000, with no translation into an offset from the chart's own visible-window start. See resolveCalloutOpacity in chart.ts. A callout with none of these three fields renders exactly as it did before they existed.",
  },
  {
    field: "startMs",
    operations: ["apply_motion_preset", "stagger_group", "orbit_group"],
    basis: "scene-local",
    note: "Scene time, the same clock element timing uses. An element visible from 2000ms given a preset at startMs 0 animates before it appears.",
  },
  {
    field: "animations[].keyframes[].timeMs",
    operations: ["set_animation", "animate_ui_node", "set_scene_camera", "set_group_transform", "add_element"],
    basis: "scene-local",
    note: "Every keyframe on an element, a ui node, a scene camera or a group transform is scene time.",
  },
  {
    field: "timing.startMs / timing.endMs",
    operations: ["set_timing", "set_ui_node_timing", "add_element"],
    basis: "scene-local",
    note: "A ui node's timing is the same clock its owning element uses, so one film has one timebase inside a scene.",
  },
  {
    field: "atMs / startMs / endMs",
    operations: ["split_clip", "trim_clip", "freeze_clip", "duplicate_clip"],
    basis: "scene-local",
    note: "Clip edits are expressed on the scene timeline, not on the source footage. slip_clip.byMs is the exception: it is a signed shift of the source window, in source milliseconds.",
  },
  {
    field: "byMs",
    operations: ["slip_clip"],
    basis: "source-local",
    note: "Shifts which footage plays without moving the clip on the scene timeline.",
  },
  {
    field: "clip.startMs / clip.endMs / gainKeyframes[].timeMs",
    operations: ["add_audio_clip", "update_audio_clip"],
    basis: "rendered-timeline",
    note: "Audio lives on the document, not in a scene, because a music bed runs the length of the film. These are absolute film milliseconds on the overlap-aware rendered timeline - which is shorter than the sum of scene durations wherever transitions overlap. clip.sourceStartMs is the in-point inside the source asset.",
  },
  {
    field: "marker.timeMs",
    operations: ["add_marker"],
    basis: "rendered-timeline",
    note: "Markers sit on the document beside audio, on the same absolute film clock. They never affect rendering.",
  },
  {
    field: "targetMs",
    operations: ["normalize_timeline_duration"],
    basis: "rendered-timeline",
    note: "The exact overlap-aware rendered duration to land on. One scene absorbs the delta.",
  },
  {
    field: "continuation.durationMs",
    operations: ["continue_element", "continue_group"],
    basis: "duration",
    note: "A length, not an instant. It must fit inside the outgoing scene's transitionOut, which is the only overlap the handoff can happen in.",
  },
  {
    field: "scroll.startMs / scroll.endMs / pointer.keyframes[].timeMs",
    operations: ["add_element", "update_element"],
    basis: "scene-local",
    note: "A ui element's scroll and pointer run on the scene clock like everything else inside it.",
  },
  {
    field: "children[].timing.startMs/endMs, children[].animations[].keyframes[].timeMs",
    operations: ["add_element", "update_element"],
    basis: "scene-local",
    note: "A composite child's own timing and keyframes run on the exact scene clock the composite itself and every top-level element use - not an offset from when the composite or the child comes on screen. One film, one timebase, at any nesting depth.",
  },
] as const;

export const CREATIVE_COORDINATE_SPACES: readonly CreativeCoordinateEntry[] = [
  {
    field: "transform.x / transform.y, and x/y keyframe values",
    operations: ["add_element", "move_element", "set_animation"],
    space: "canvas-pixels",
    note: "Absolute canvas position, not an offset from where the element sits. A keyframe track on x animates to an absolute coordinate, so a nudge is authored as from: currentX, to: currentX + 40 - not from 0 to 40. A motion preset track is the exception: it declares its own mode.",
  },
  {
    field: "tracks[].mode, and stagger_group.mode",
    operations: ["apply_motion_preset", "stagger_group", "set_design_token"],
    space: "relative-to-current",
    note: "absolute sets the value, delta adds to the element's current value, multiplier scales it. This is why a preset can say y: 40 -> 0 and read as a rise from below, while the same numbers as raw keyframes would jump the element to the top of the canvas.",
  },
  {
    field: "anchorX / anchorY on a camera or group transform",
    operations: ["set_scene_camera", "set_group_transform"],
    space: "normalized-canvas",
    note: "The pivot for scale and rotation, 0-1 against the CANVAS - 0.5, 0.5 is centre of frame. Deliberately not against the group's own bounds, which move as its children animate and would make a steady push-in drift.",
  },
  {
    field: "node.frame.x / node.frame.y, and ui node x/y keyframes",
    operations: ["add_element", "move_ui_node", "animate_ui_node"],
    space: "viewport-pixels",
    note: "Pixels inside the ui element's own fixed viewport, relative to the parent node - not canvas pixels. The viewport is then scaled to fill the element's transform box. scaleX, scaleY and rotation on a node pivot about the node's own centre.",
  },
  {
    field: "mask.x / y / width / height / feather",
    operations: ["set_mask"],
    space: "normalized-element",
    note: "0-1 against the element's own box, so a mask keeps its position when the element is resized.",
  },
  {
    field: "callouts[].dx / dy",
    operations: ["set_chart_axes"],
    space: "normalized-chart",
    note: "Offsets in normalized chart space, so a callout holds its position relative to the plot when the element is resized.",
  },
  {
    field: "gradient.centerX / centerY, and stops[].offset",
    operations: ["set_fill", "add_element"],
    space: "normalized-element",
    note: "0-1 against the element's own box; centre defaults to 0.5, 0.5. angle is degrees in CSS convention, 0 up and clockwise. Stops need not be pre-sorted.",
  },
  {
    field: "pointer.keyframes[].x / y",
    operations: ["add_element", "update_element"],
    space: "viewport-pixels",
    note: "The pointer is drawn over the ui viewport and shares its pixel space.",
  },
  {
    field: "children[].transform.x / y / width / height",
    operations: ["add_element", "update_element"],
    space: "viewport-pixels",
    note: "Pixels inside the composite's own fixed viewport, not canvas pixels - the same convention as a ui node's frame, but using the full CreativeTransform a real element already has (rotation, anchorX/anchorY as the pivot on the child's own box, zIndex ordering among the composite's own children only). The viewport is then scaled onto the composite element's own transform box, independently per axis, exactly like ui.viewport.",
  },
] as const;

/* -------------------------------------------------------------------------- */
/* #61 - canonical value shapes                                                */
/* -------------------------------------------------------------------------- */

/**
 * The values that appear inside `additionalProperties: true` payloads. These
 * are the shapes a caller currently has to discover by rejection.
 */
export const CREATIVE_VALUE_SHAPES = {
  color: {
    literal: { kind: "literal", value: "#0B1220" },
    token: { kind: "token", token: "accent" },
    gradient: {
      kind: "gradient",
      gradient: {
        kind: "linear",
        angle: 180,
        stops: [
          { offset: 0, color: { kind: "literal", value: "#0B1220" } },
          { offset: 1, color: { kind: "token", token: "accent" } },
        ],
      },
    },
    note: `A gradient is a ColorValue like any other, valid for shape fills, element and scene backgrounds and ui surfaces. Rejected for strokes, text colour, chart paint and a stop's own colour. gradient.kind is one of ${GRADIENT_KINDS.join(", ")}.`,
  },
  stroke: {
    shape: { width: 2, color: { kind: "token", token: "accent" } },
    note: "A StrokeToken is always both fields. A chart requires one for every kind, including bar - give it width 0 to hide the outline rather than omitting stroke.",
  },
  textStyleRef: {
    shape: { token: "heading", overrides: { fontSize: 88, letterSpacing: -2, color: { kind: "token", token: "foreground" } } },
    note: "A TextStyleRef names a typography token and optionally overrides fields of it. overrides is a partial TextStyleToken - fontFamily, fontSize, fontWeight, lineHeight, letterSpacing, align, color - never a whole style. Omit overrides to take the token as-is.",
  },
  transform: {
    shape: { x: 160, y: 220, z: 80, width: 1200, height: 180, rotation: 0, rotationX: 0, rotationY: -8, opacity: 1, anchorX: 0.5, anchorY: 0.5, zIndex: 3 },
    note: "x/y, width/height, rotation, opacity, anchorX/anchorY and zIndex are required on a new element. z and rotationX/rotationY are optional 2.5D controls; anchorX/anchorY are 0-1 against the element's own box and set the pivot; zIndex controls paint order independently of z depth.",
  },
  timing: {
    shape: { startMs: 400, endMs: 5200 },
    note: "Scene-local. Omit timing entirely for an element that is visible for the whole scene.",
  },
  animation: {
    shape: {
      id: "title-rise",
      property: "y",
      keyframes: [
        { timeMs: 400, value: 260, easing: "ease-out" },
        { timeMs: 900, value: 220, easing: "ease-out" },
      ],
    },
    note: `One track per property. property is one of: ${ANIMATION_PROPERTIES.join(", ")}. Keyframe values are absolute, and timeMs is scene-local.`,
  },
  easing: {
    named: EASING_NAMES,
    custom: { kind: "cubic-bezier", x1: 0.2, y1: 0, x2: 0, y2: 1 },
    note: "Either a named preset or an explicit cubic-bezier. Valid anywhere an easing is taken, including inside keyframes and motion presets.",
  },
  motionPreset: {
    shape: {
      durationMs: 400,
      easing: "ease-out",
      tracks: [
        { property: "y", mode: "delta", from: 40, to: 0 },
        { property: "opacity", mode: "absolute", from: 0, to: 1 },
      ],
    },
    note: "Stored under designSystem.motion.presets and applied by name with apply_motion_preset. mode is what makes a preset reusable across elements: delta and multiplier are relative to whatever the element is already doing.",
  },
  uiNodes: {
    box: {
      id: "card",
      kind: "box",
      frame: { x: 0, y: 0, width: 640, height: 360 },
      background: { kind: "literal", value: "#0B1220" },
      border: { width: 1, color: { kind: "literal", value: "#243044" } },
      borderRadius: 24,
      clip: true,
      children: [],
    },
    text: {
      id: "card-value",
      kind: "text",
      frame: { x: 32, y: 40, width: 400, height: 72 },
      text: "38%",
      style: { token: "heading" },
    },
    image: {
      id: "card-avatar",
      kind: "image",
      frame: { x: 480, y: 32, width: 96, height: 96 },
      assetId: "asset-avatar",
      fit: "cover",
    },
    note: `Node kinds are ${CREATIVE_UI_NODE_KINDS.join(", ")}. Frames are viewport pixels relative to the parent node. Children nest under a box only, to a depth of ${CREATIVE_UI_MAX_DEPTH} and at most ${CREATIVE_UI_MAX_NODES} nodes.`,
  },
  scene: {
    shape: {
      id: "scene-3",
      name: "Proof",
      durationMs: 6000,
      background: { kind: "token", token: "background" },
      elements: [],
      groups: [],
    },
    note: "add_scene takes a whole scene. elements and groups are required arrays and may be empty - author into it afterwards with add_element, which keeps the transaction readable and the operation index meaningful when something is rejected.",
  },
  enums: {
    elementTypes: CREATIVE_ELEMENT_TYPES,
    animationProperties: ANIMATION_PROPERTIES,
    easings: EASING_NAMES,
    chartKinds: CREATIVE_CHART_KINDS,
    chartLabelFormats: CHART_LABEL_FORMATS,
    connectorCurves: CONNECTOR_CURVES,
    blendModes: BLEND_MODES,
    maskKinds: CREATIVE_MASK_KINDS,
    textAnimationGranularities: TEXT_ANIMATION_GRANULARITIES,
    textAnimationModes: TEXT_ANIMATION_MODES,
    textFitModes: TEXT_FIT_MODES,
    sceneTransitionKinds: SCENE_TRANSITION_KINDS,
    audioKinds: CREATIVE_AUDIO_KINDS,
    markerKinds: CREATIVE_MARKER_KINDS,
    uiNodeKinds: CREATIVE_UI_NODE_KINDS,
    gradientKinds: GRADIENT_KINDS,
  },
} as const;

/**
 * One complete element per type, which is the shape `add_element.element` and
 * `import_creative_document` actually require and neither currently advertises.
 */
export const CREATIVE_ELEMENT_EXAMPLES: Record<string, Record<string, unknown>> = {
  text: {
    id: "title",
    name: "Headline",
    type: "text",
    text: "Ninety per cent of the work is knowing where to look.",
    style: { token: "heading", overrides: { fontSize: 88 } },
    transform: { x: 160, y: 220, width: 1200, height: 260, rotation: 0, opacity: 1, anchorX: 0, anchorY: 0, zIndex: 3 },
    timing: { startMs: 400, endMs: 5600 },
  },
  image: {
    id: "still",
    name: "Reference still",
    type: "image",
    assetId: "asset-still",
    fit: "cover",
    transform: { x: 0, y: 0, width: 1920, height: 1080, rotation: 0, opacity: 1, anchorX: 0, anchorY: 0, zIndex: 0 },
  },
  video: {
    id: "shot",
    name: "Opening shot",
    type: "video",
    assetId: "asset-shot",
    fit: "cover",
    sourceStartMs: 0,
    sourceEndMs: 4000,
    // Both required, with no default: a video element omitting either is
    // rejected. The advertised schema lists them beside genuinely optional
    // fields, so this is only discoverable by being refused.
    volume: 0,
    playbackRate: 1,
    muted: true,
    transform: { x: 0, y: 0, width: 1920, height: 1080, rotation: 0, opacity: 1, anchorX: 0, anchorY: 0, zIndex: 1 },
  },
  shape: {
    id: "plate",
    name: "Scrim",
    type: "shape",
    shape: "rect",
    fill: { kind: "token", token: "background" },
    borderRadius: 24,
    transform: { x: 120, y: 180, width: 1300, height: 420, rotation: 0, opacity: 0.86, anchorX: 0, anchorY: 0, zIndex: 2 },
  },
  ui: {
    id: "panel",
    name: "Dashboard panel",
    type: "ui",
    viewport: { width: 720, height: 420 },
    background: { kind: "literal", value: "#070B14" },
    nodes: [
      {
        id: "panel-card",
        kind: "box",
        frame: { x: 0, y: 0, width: 720, height: 420 },
        layout: { mode: "flex", direction: "column", gap: 16, padding: 40, align: "stretch", justify: "start" },
        background: { kind: "literal", value: "#0B1220" },
        borderRadius: 24,
        children: [
          {
            id: "panel-value",
            kind: "text",
            frame: { x: 40, y: 48, width: 400, height: 96 },
            layoutItem: { grow: 0, alignSelf: "stretch" },
            text: "38%",
            style: { token: "heading" },
          },
        ],
      },
    ],
    transform: { x: 1040, y: 520, width: 720, height: 420, rotation: 0, opacity: 1, anchorX: 0, anchorY: 0, zIndex: 4 },
  },
  chart: {
    id: "metric",
    name: "Adoption",
    type: "chart",
    chartKind: "area",
    series: [12, 19, 24, 31, 44, 58],
    stroke: { width: 3, color: { kind: "token", token: "accent" } },
    fill: { kind: "token", token: "accent" },
    drawProgress: 1,
    labelStyle: { token: "caption" },
    transform: { x: 160, y: 620, width: 760, height: 320, rotation: 0, opacity: 1, anchorX: 0, anchorY: 0, zIndex: 3 },
  },
  connector: {
    id: "edge",
    name: "Plate to panel",
    type: "connector",
    fromElementId: "plate",
    toElementId: "panel",
    curve: "smooth",
    stroke: { width: 2, color: { kind: "token", token: "muted" } },
    drawProgress: 1,
    transform: { x: 0, y: 0, width: 1920, height: 1080, rotation: 0, opacity: 1, anchorX: 0, anchorY: 0, zIndex: 5 },
  },
  // roadmap #59/#57. Children are real elements - a genuine text element and
  // a genuine chart element, not a parallel node vocabulary - positioned in
  // the composite's own viewport pixels (design decision 2 on
  // CreativeCompositeElement in schema.ts), so a caller who already knows how
  // to author a chart or text element already knows how to author one inside
  // a composite. glass lives on CreativeElementBase, so it is available here
  // exactly as on any other element - this is the "glass panel with its
  // heading and its chart" the one-group-per-element invariant used to say
  // could not be built as one unit.
  composite: {
    id: "card",
    name: "Adoption KPI card",
    type: "composite",
    viewport: { width: 480, height: 280 },
    glass: { blurPx: 24 },
    children: [
      {
        id: "card-label",
        name: "Card label",
        type: "text",
        text: "Adoption",
        style: { token: "caption" },
        transform: { x: 32, y: 28, width: 300, height: 44, rotation: 0, opacity: 1, anchorX: 0, anchorY: 0, zIndex: 1 },
      },
      {
        id: "card-chart",
        name: "Card chart",
        type: "chart",
        chartKind: "area",
        series: [12, 19, 24, 31, 44, 58],
        stroke: { width: 3, color: { kind: "token", token: "accent" } },
        fill: { kind: "token", token: "accent" },
        drawProgress: 1,
        transform: { x: 32, y: 96, width: 416, height: 152, rotation: 0, opacity: 1, anchorX: 0, anchorY: 0, zIndex: 1 },
      },
    ],
    transform: { x: 1040, y: 620, width: 480, height: 280, rotation: 0, opacity: 1, anchorX: 0, anchorY: 0, zIndex: 6 },
  },
};

const EXAMPLES: readonly CreativeOperationExample[] = [
  { type: "set_canvas", example: { type: "set_canvas", width: 1920, height: 1080, fps: 30 } },
  {
    type: "set_project_scratchpad",
    example: { type: "set_project_scratchpad", scratchpad: "Beat 3 lands the 38% figure; hold the panel until the VO clears." },
    note: "Project-level notes that survive between sessions. Never rendered, and returned verbatim by get_creative_project with return: \"outline\" - so this is where a brief goes if the next session is to read it without being told to look.",
  },
  {
    type: "set_asset_alias",
    example: { type: "set_asset_alias", alias: "hero-shot", assetId: "asset-shot" },
    note: "Omit assetId to remove the alias. An alias is a stable project-local handle, so a regenerated asset can be swapped in one operation instead of everywhere it is referenced.",
  },
  {
    type: "set_project_attachment",
    example: { type: "set_project_attachment", attachment: { id: "ref-1", kind: "reference", assetId: "asset-still", label: "Board reference" } },
  },
  { type: "remove_project_attachment", example: { type: "remove_project_attachment", attachmentId: "ref-1" } },
  {
    type: "add_composition_template",
    example: { type: "add_composition_template", template: "metric-grid", sceneId: "grid", durationMs: 5000 },
    note: "sceneId names a NEW scene this creates, not an existing scene to add elements to - passing an existing id is rejected as a duplicate. Every element it lays out is namespaced under that id, as grid.background, grid.metric-1 and so on, which is what makes them addressable afterwards with update_elements.",
  },
  {
    type: "normalize_timeline_duration",
    example: { type: "normalize_timeline_duration", targetMs: 30000, sceneId: "scene-2" },
    note: "Lands the film on an exact overlap-aware duration. Omit sceneId to absorb the delta in the final scene.",
  },
  { type: "add_element", example: { type: "add_element", sceneId: "scene-1", element: CREATIVE_ELEMENT_EXAMPLES.text } },
  {
    type: "update_element",
    example: { type: "update_element", sceneId: "scene-1", elementId: "title", patch: { text: "Know where to look.", style: { token: "heading", overrides: { fontSize: 96 } } } },
    note: "A partial element. id and type cannot change.",
  },
  {
    type: "update_elements",
    example: { type: "update_elements", elementIdEndsWith: "plate", patch: { fill: { kind: "token", token: "background" } } },
    note: "Exactly one of targets, elementIdEndsWith or selector. Restyling eight scrims across eight scenes is one operation, not eight.",
  },
  { type: "remove_element", example: { type: "remove_element", sceneId: "scene-1", elementId: "still" } },
  { type: "reorder_element", example: { type: "reorder_element", sceneId: "scene-1", elementId: "plate", toIndex: 0 } },
  { type: "move_element", example: { type: "move_element", sceneId: "scene-1", elementId: "title", x: 200, y: 260 } },
  { type: "resize_element", example: { type: "resize_element", sceneId: "scene-1", elementId: "title", width: 1100, height: 240 } },
  { type: "set_text", example: { type: "set_text", sceneId: "scene-1", elementId: "title", text: "Know where to look." } },
  { type: "set_hidden", example: { type: "set_hidden", sceneId: "scene-1", elementId: "still", hidden: true } },
  { type: "set_locked", example: { type: "set_locked", sceneId: "scene-1", elementId: "plate", locked: true } },
  { type: "set_timing", example: { type: "set_timing", sceneId: "scene-1", elementId: "title", timing: { startMs: 600, endMs: 5400 } } },
  {
    type: "set_animation",
    example: {
      type: "set_animation",
      sceneId: "scene-1",
      elementId: "title",
      animations: [
        { id: "title-y", property: "y", keyframes: [{ timeMs: 600, value: 260, easing: "ease-out" }, { timeMs: 1100, value: 220, easing: "ease-out" }] },
        { id: "title-opacity", property: "opacity", keyframes: [{ timeMs: 600, value: 0, easing: "ease-out" }, { timeMs: 1100, value: 1, easing: "ease-out" }] },
      ],
    },
    note: "Replaces every track on the element. Keyframe values are absolute and timeMs is scene-local.",
  },
  {
    type: "apply_motion_preset",
    example: { type: "apply_motion_preset", sceneId: "scene-1", elementId: "title", presetName: "rise-in", startMs: 600 },
    note: "startMs is scene-local. Preset names come from designSystem.motion.presets.",
  },
  {
    type: "stagger_group",
    example: {
      type: "stagger_group",
      sceneId: "scene-1",
      groupId: "card",
      property: "y",
      from: 40,
      to: 0,
      mode: "delta",
      startMs: 800,
      durationMs: 500,
      staggerMs: 90,
      easing: "ease-out",
    },
    note: "mode is explicit: delta offsets each child from where it already is, absolute sets the value outright, multiplier scales it.",
  },
  {
    type: "orbit_group",
    example: { type: "orbit_group", sceneId: "scene-1", groupId: "card", centerX: 960, centerY: 540, radius: 320, startAngleDeg: -90, rotateByDeg: 360, startMs: 400, endMs: 5600, easing: "linear" },
    note: "The window must sit inside every child's own visible window, so a group whose members come in at different times orbits only for as long as they are all on screen. Omit startMs/endMs to lay the items out without animating them.",
  },
  {
    type: "explode_text",
    example: { type: "explode_text", sceneId: "scene-1", elementId: "title", granularity: "word", groupId: "title-words" },
    note: "Turns one text block into independently addressable elements, grouped so the follow-up stagger_group can cascade them.",
  },
  { type: "add_scene", example: { type: "add_scene", scene: { id: "scene-3", name: "Proof", durationMs: 6000, elements: [], groups: [] } } },
  { type: "update_scene", example: { type: "update_scene", sceneId: "scene-1", patch: { name: "Open", durationMs: 7000 } }, note: "Scene-level only. It must not carry elements or groups." },
  { type: "remove_scene", example: { type: "remove_scene", sceneId: "scene-2" } },
  { type: "reorder_scene", example: { type: "reorder_scene", sceneId: "scene-2", toIndex: 0 } },
  {
    type: "animate_ui_node",
    example: {
      type: "animate_ui_node",
      sceneId: "scene-1",
      elementId: "panel",
      nodeId: "panel-value",
      animations: [{ id: "value-pop", property: "scaleX", keyframes: [{ timeMs: 1200, value: 0.9, easing: "ease-out" }, { timeMs: 1500, value: 1, easing: "spring-snappy" }] }],
    },
    note: "x and y here are viewport pixels relative to the parent node; scale and rotation pivot about the node's own centre.",
  },
  { type: "set_ui_node_timing", example: { type: "set_ui_node_timing", sceneId: "scene-1", elementId: "panel", nodeId: "panel-value", timing: { startMs: 1200, endMs: 5600 } } },
  { type: "move_ui_node", example: { type: "move_ui_node", sceneId: "scene-1", elementId: "panel", nodeId: "panel-value", x: 48, y: 56 } },
  { type: "resize_ui_node", example: { type: "resize_ui_node", sceneId: "scene-1", elementId: "panel", nodeId: "panel-value", width: 420, height: 104 } },
  {
    type: "continue_element",
    example: { type: "continue_element", continuation: { id: "cont-plate", fromSceneId: "scene-1", fromElementId: "plate", toSceneId: "scene-2", toElementId: "plate-2", durationMs: 600, easing: "ease-in-out" } },
    note: "Needs an overlap to happen in: set_transition on scene-1 first, with a transitionOut at least as long as durationMs.",
  },
  { type: "remove_continuation", example: { type: "remove_continuation", continuationId: "cont-plate" } },
  {
    type: "continue_group",
    example: { type: "continue_group", continuation: { id: "cont-card", fromSceneId: "scene-1", fromGroupId: "card", toSceneId: "scene-2", toGroupId: "card-2", durationMs: 600, easing: "ease-in-out", childMapping: [{ fromElementId: "title", toElementId: "title-2", morphGeometry: true }] } },
    note: "Both groups need a transform from set_group_transform - the transform is what carries the motion. Children with no mapped predecessor are held back until the handoff completes. morphGeometry additionally carries title-2's own position/size/rotation/opacity from title's resolved end state, on this same 600ms window - omit it and a mapped child only stays visible, exactly as it did before this field existed.",
  },
  { type: "remove_group_continuation", example: { type: "remove_group_continuation", continuationId: "cont-card" } },
  {
    type: "set_scene_camera",
    example: {
      type: "set_scene_camera",
      sceneId: "scene-1",
      camera: {
        transform: { x: 0, y: 0, scaleX: 1, scaleY: 1, rotation: 0, opacity: 1, anchorX: 0.5, anchorY: 0.5 },
        perspectivePx: 1200,
        perspectiveOriginX: 0.5,
        perspectiveOriginY: 0.5,
        animations: [{ id: "push-in", property: "scaleX", keyframes: [{ timeMs: 0, value: 1, easing: "ease-in-out" }, { timeMs: 6000, value: 1.08, easing: "ease-in-out" }] }],
      },
    },
    note: "One transform over every element in the scene. Omit camera to remove it. anchorX/anchorY and perspectiveOriginX/Y are 0-1 against the canvas; perspectivePx enables deterministic 2.5D depth.",
  },
  {
    type: "set_group_transform",
    example: {
      type: "set_group_transform",
      sceneId: "scene-1",
      groupId: "card",
      transform: { x: 0, y: 0, scaleX: 1, scaleY: 1, rotation: 0, opacity: 1, anchorX: 0.5, anchorY: 0.5 },
      animations: [{ id: "card-drift", property: "x", keyframes: [{ timeMs: 0, value: 0, easing: "ease-out" }, { timeMs: 6000, value: -80, easing: "ease-out" }] }],
    },
    note: "A group's opacity multiplies each child's rather than compositing the group, so overlapping children under a half-opaque group read darker where they overlap. A scene camera composites properly.",
  },
  { type: "set_transition", example: { type: "set_transition", sceneId: "scene-1", transition: { kind: "fade", durationMs: 800, easing: "ease-in-out" } } },
  { type: "split_clip", example: { type: "split_clip", sceneId: "scene-1", elementId: "shot", atMs: 2000 } },
  { type: "trim_clip", example: { type: "trim_clip", sceneId: "scene-1", elementId: "shot", startMs: 500, endMs: 4500 } },
  { type: "slip_clip", example: { type: "slip_clip", sceneId: "scene-1", elementId: "shot", byMs: 750 }, note: "Moves the source window, not the clip. Costs nothing to render, unlike a rate change." },
  {
    type: "set_clip_speed",
    example: { type: "set_clip_speed", sceneId: "scene-1", elementId: "shot", speed: 0.5, mode: "hold_source" },
    note: "hold_source keeps every frame and changes the duration - a 0.5 rate makes the clip twice as long, so the scene has to be long enough to hold it or the transaction is rejected on timing. hold_duration keeps the slot and changes which frames fill it instead. Any rate other than 1 renders by seeking an exact source frame per output frame across the whole clip, which is materially slower - do not reach for 0.98 to get a subtle drift.",
  },
  { type: "freeze_clip", example: { type: "freeze_clip", sceneId: "scene-1", elementId: "shot", atMs: 1500 } },
  { type: "duplicate_clip", example: { type: "duplicate_clip", sceneId: "scene-1", elementId: "shot", atMs: 4000 }, note: "Copies the clip into another slot on the scene timeline. The copy has to fit inside the scene, like any element." },
  {
    type: "apply_text_animation",
    example: { type: "apply_text_animation", sceneId: "scene-1", elementId: "title", animation: { granularity: "word", mode: "rise", startMs: 0, durationMs: 420, staggerMs: 80, easing: "ease-out", distance: 32 } },
    note: "startMs is ELEMENT-local - measured from the start of this element's visible window, unlike apply_motion_preset. Omit animation to clear. To target a direct text child inside a composite, set elementId to the composite id and childId to the child id; ui text nodes continue to use animate_ui_node.",
  },
  { type: "set_text_fit", example: { type: "set_text_fit", sceneId: "scene-1", elementId: "title", fit: { mode: "shrink", minFontSize: 48 } } },
  {
    type: "set_counter",
    example: {
      type: "set_counter",
      sceneId: "scene-1",
      elementId: "title",
      counter: { from: 0, to: 1024, startMs: 200, durationMs: 1400, easing: "ease-out", format: "compact", precision: 0, suffix: " users" },
    },
    note: "startMs is ELEMENT-local, like apply_text_animation.startMs - measured from the start of this element's visible window. format/precision share chart.ts's plain/compact/percent vocabulary. Once set, counter is authoritative for what renders; the element's own text stays the authored fallback. Omit counter to clear it.",
  },
  { type: "set_adjustments", example: { type: "set_adjustments", sceneId: "scene-1", elementId: "still", adjustments: { brightness: 0.92, contrast: 1.1, saturation: 0.8, blurPx: 0 } } },
  {
    type: "add_audio_clip",
    example: { type: "add_audio_clip", clip: { id: "bed", name: "Music bed", assetId: "asset-music", kind: "music", startMs: 0, endMs: 30000, sourceStartMs: 0, gain: 0.7, fadeInMs: 800, fadeOutMs: 1200, duckUnderVoice: true, duckToGain: 0.25 } },
    note: "Rendered-timeline milliseconds, not scene-local: audio lives on the document because a bed runs the length of the film. Ducking is derived, so moving the voiceover moves the duck.",
  },
  { type: "update_audio_clip", example: { type: "update_audio_clip", clipId: "bed", patch: { gain: 0.55 } } },
  { type: "remove_audio_clip", example: { type: "remove_audio_clip", clipId: "bed" } },
  {
    type: "set_clip_speed_ramp",
    example: { type: "set_clip_speed_ramp", sceneId: "scene-1", elementId: "shot", speedRamp: { keyframes: [{ atMs: 0, speed: 1 }, { atMs: 1500, speed: 0.35 }, { atMs: 3000, speed: 1 }] } },
    note: "The curve is interpolated and integrated, so the ramp consumes exactly the footage it describes. Omit speedRamp to clear.",
  },
  { type: "set_mask", example: { type: "set_mask", sceneId: "scene-1", elementId: "still", mask: { kind: "ellipse", x: 0.1, y: 0.1, width: 0.8, height: 0.8, feather: 0.15, invert: false } } },
  { type: "set_motion_blur", example: { type: "set_motion_blur", sceneId: "scene-1", elementId: "title", motionBlur: { shutterAngle: 180, maxBlur: 24 } }, note: "180 is a normal cinematic shutter; maxBlur caps the smear in pixels. Both are required. Omit motionBlur to clear." },
  {
    type: "set_fill",
    example: { type: "set_fill", sceneId: "scene-1", elementId: "plate", fill: { kind: "gradient", gradient: { kind: "linear", angle: 180, stops: [{ offset: 0, color: { kind: "literal", value: "#0B1220" } }, { offset: 1, color: { kind: "literal", value: "#000000" } }] } } },
    note: "Gradient stops are static: the keyframe vocabulary interpolates one named number per track, and a variable-length list of stops has no fixed property to attach one to. Animate a gradient by sending a new set_fill.",
  },
  {
    type: "set_gradient_animation",
    example: {
      type: "set_gradient_animation",
      sceneId: "scene-1",
      elementId: "plate",
      animation: {
        angle: [{ timeMs: 0, value: 160, easing: "ease-in-out" }, { timeMs: 6000, value: 200, easing: "ease-in-out" }],
        stops: [{ stopIndex: 1, offset: [{ timeMs: 0, value: 0.6, easing: "linear" }, { timeMs: 6000, value: 1, easing: "linear" }] }],
      },
    },
    note: "The gradient fields that are single numbers - angle, centerX, centerY, and a stop's own offset - take ordinary keyframe tracks, addressed per authored stop index. A stop's colour is a separate colorKeyframes track. Omit animation to clear.",
  },
  {
    type: "set_shape_morph",
    example: {
      type: "set_shape_morph",
      sceneId: "scene-1",
      elementId: "plate",
      morph: {
        from: { points: [{ x: 0, y: 0 }, { x: 1, y: 0 }, { x: 1, y: 1 }, { x: 0, y: 1 }] },
        to: { points: [{ x: 0.5, y: 0 }, { x: 1, y: 0.5 }, { x: 0.5, y: 1 }, { x: 0, y: 0.5 }] },
        startMs: 200,
        durationMs: 900,
        easing: "ease-in-out",
      },
    },
    note: "The square plate turns into a diamond over 900ms. from/to are normalized 0-1 point lists against the element's own box, straight edges only - no curves, so a circular endpoint is authored as a many-sided polygon standing in for one. Unequal point counts are resampled up to the higher count by walking each outline's own perimeter at even arc-length steps, and the two are then auto-aligned - cyclic start shifted, and reversed if that scores lower - to whichever pairing moves least, so two lists that happen to start at different corners do not spin through a rotation artifact on the way. startMs/durationMs are ELEMENT-local like set_counter, not scene-local like a chart's drawProgress. Before startMs the shape is exactly from; once the run finishes it holds at to. Omit morph to clear it back to the plain rect/ellipse this element has always drawn.",
  },
  { type: "set_connector", example: { type: "set_connector", sceneId: "scene-1", elementId: "edge", fromElementId: "plate", toElementId: "panel", curve: "smooth", stroke: { width: 2, color: { kind: "token", token: "muted" } }, drawProgress: 1 } },
  { type: "set_blend_mode", example: { type: "set_blend_mode", sceneId: "scene-1", elementId: "still", blendMode: "screen" }, note: "Omit blendMode to clear back to normal." },
  {
    type: "set_chart_data",
    example: { type: "set_chart_data", sceneId: "scene-1", elementId: "metric", chartKind: "bar", series: [12, 19, 24, 31, 44, 58], axisMin: 0, axisMax: 60, drawProgress: 1, staggerPoints: 0.4, stroke: { width: 0, color: { kind: "token", token: "accent" } }, fill: { kind: "token", token: "accent" } },
    note: "Replaces the whole data bundle, so refining numbers never means resending the transform, timing or animations. Animate drawProgress through the ordinary keyframe vocabulary for a native draw-on.",
  },
  {
    type: "set_glass",
    example: { type: "set_glass", sceneId: "scene-1", elementId: "plate", glass: { blurPx: 24, tint: { kind: "literal", value: "#FFFFFF" }, tintOpacity: 0.12, borderOpacity: 0.18, radius: 24, highlight: 0.25, saturation: 1.4, shadow: 0.18 } },
    note: "One primitive instead of six values that have to agree. Costs render time: a backdrop filter re-rasterises everything behind it every frame, so glass on many large surfaces is a material frame-cost decision, not only a look. Omit glass to clear.",
  },
  {
    type: "set_chart_axes",
    example: {
      type: "set_chart_axes",
      sceneId: "scene-1",
      elementId: "metric",
      axes: { yTicks: 5, gridlines: true, yLine: true, xLine: true, categories: ["Jan", "Feb", "Mar", "Apr", "May", "Jun"], valueLabels: true, format: "compact", precision: 0 },
      callouts: [{ index: 5, text: "58% adoption", dx: 0.05, dy: -0.15, startMs: 1400, durationMs: 3600, fadeMs: 300 }],
      labelStyle: { token: "caption" },
    },
    note: "labelStyle is required once anything draws text: chart text has no element of its own to inherit typography from. A callout's startMs/durationMs/fadeMs are scene-local - matching the chart's own drawProgress keyframes, not apply_text_animation's element-local clock - and all three are optional: omit them and a callout appears exactly as soon as its point is revealed and never leaves, same as before per-callout timing existed.",
  },
  { type: "set_chart_point_emphasis", example: { type: "set_chart_point_emphasis", sceneId: "scene-1", elementId: "metric", index: 5, scale: 1.8, color: { kind: "token", token: "accent" } }, note: "Addresses one point by its index in series without resending the rest of it. Omit scale and color together to clear that point." },
  { type: "add_marker", example: { type: "add_marker", marker: { id: "beat-1", timeMs: 4200, kind: "beat", label: "Downbeat" } }, note: "Rendered-timeline milliseconds. Markers never affect rendering." },
  { type: "remove_marker", example: { type: "remove_marker", markerId: "beat-1" } },
  { type: "create_group", example: { type: "create_group", sceneId: "scene-1", group: { id: "card", name: "Metric card", elementIds: ["title", "plate"] } }, note: "An element belongs to at most one group, groups do not nest, and connectors are never grouped." },
  { type: "update_group", example: { type: "update_group", sceneId: "scene-1", groupId: "card", patch: { name: "Hero card", elementIds: ["title", "plate", "metric"] } } },
  { type: "ungroup", example: { type: "ungroup", sceneId: "scene-1", groupId: "card" }, note: "Removes the group, not its elements." },
  {
    type: "duplicate_group",
    example: { type: "duplicate_group", sceneId: "scene-1", groupId: "card", idPrefix: "card-b-", newGroupId: "card-b", name: "Metric card B", dx: 640, dy: 0 },
    note: "Copies every child with a prefixed id and offsets the copy in canvas pixels.",
  },
  {
    type: "set_design_token",
    example: { type: "set_design_token", namespace: "colors", token: "accent", value: "#F97316" },
    note: "Value shape follows the namespace: colors take a hex string, spacing and radii a number, typography a TextStyleToken, strokes a StrokeToken, motionPresets a MotionPreset, sceneTransitions a SceneTransitionPreset.",
  },
];

export const CREATIVE_OPERATION_EXAMPLES: Record<string, CreativeOperationExample> =
  Object.fromEntries(EXAMPLES.map((entry) => [entry.type, entry]));

/* -------------------------------------------------------------------------- */
/* The published guide                                                         */
/* -------------------------------------------------------------------------- */

export const CREATIVE_SCHEMA_GUIDE_SECTIONS = [
  "operations",
  "elements",
  "values",
  "invariants",
  "time",
] as const;
export type CreativeSchemaGuideSection = (typeof CREATIVE_SCHEMA_GUIDE_SECTIONS)[number];

export interface DescribeCreativeSchemaRequest {
  /** Sections to return. Omit for all of them. */
  readonly sections?: readonly CreativeSchemaGuideSection[];
  /** Restrict the operations section to these types. Omit for every operation. */
  readonly operations?: readonly string[];
  /** Restrict the elements section to these types. Omit for every element type. */
  readonly elements?: readonly string[];
}

const SECTION_SET = new Set<string>(CREATIVE_SCHEMA_GUIDE_SECTIONS);

/**
 * Builds the payload `studio_describe_creative_schema` returns.
 *
 * Filtered by default use rather than dumped whole: the full guide is large,
 * and a caller who already knows the vocabulary and needs one operation's
 * shape should not pay for all of it. Asking for an unknown operation is an
 * error naming the near misses, because silently returning nothing is how a
 * caller concludes a capability does not exist.
 */
export function describeCreativeSchema(request: DescribeCreativeSchemaRequest = {}): Record<string, unknown> {
  for (const section of request.sections ?? []) {
    if (!SECTION_SET.has(section)) {
      throw new Error(`Unknown section: ${section}. Sections are ${CREATIVE_SCHEMA_GUIDE_SECTIONS.join(", ")}.`);
    }
  }
  const wanted = new Set<string>(request.sections ?? CREATIVE_SCHEMA_GUIDE_SECTIONS);
  const payload: Record<string, unknown> = {};

  if (wanted.has("operations")) {
    const requested = request.operations;
    if (requested?.length) {
      const unknown = requested.filter((type) => !CREATIVE_OPERATION_EXAMPLES[type]);
      if (unknown.length) {
        throw new Error(
          `Unknown operation${unknown.length > 1 ? "s" : ""}: ${unknown.join(", ")}. ${nearestOperations(unknown[0])}`,
        );
      }
    }
    const types = requested?.length ? requested : CREATIVE_OPERATION_TYPES;
    payload.operations = types.map((type) => CREATIVE_OPERATION_EXAMPLES[type]).filter(Boolean);
  }

  if (wanted.has("elements")) {
    const requested = request.elements;
    if (requested?.length) {
      const unknown = requested.filter((type) => !CREATIVE_ELEMENT_EXAMPLES[type]);
      if (unknown.length) {
        throw new Error(`Unknown element type${unknown.length > 1 ? "s" : ""}: ${unknown.join(", ")}. Element types are ${CREATIVE_ELEMENT_TYPES.join(", ")}.`);
      }
    }
    const types = requested?.length ? requested : CREATIVE_ELEMENT_TYPES;
    payload.elements = Object.fromEntries(types.map((type) => [type, CREATIVE_ELEMENT_EXAMPLES[type]]));
  }

  if (wanted.has("values")) payload.values = CREATIVE_VALUE_SHAPES;
  if (wanted.has("invariants")) payload.invariants = CREATIVE_STRUCTURAL_INVARIANTS;
  if (wanted.has("time")) {
    payload.time_bases = CREATIVE_TIME_BASES;
    payload.coordinate_spaces = CREATIVE_COORDINATE_SPACES;
  }

  return payload;
}

/** Suggests operations whose name shares a word with the one that missed. */
function nearestOperations(attempted: string): string {
  const words = attempted.split("_").filter((word) => word.length > 2);
  const near = CREATIVE_OPERATION_TYPES.filter((type) => words.some((word) => type.includes(word))).slice(0, 6);
  return near.length
    ? `Closest by name: ${near.join(", ")}.`
    : `Call this tool with no operations argument to list all ${CREATIVE_OPERATION_TYPES.length}.`;
}
