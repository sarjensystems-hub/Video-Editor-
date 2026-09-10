/**
 * What to reach for, published where an agent reads it before it can get it
 * wrong.
 *
 * The measured problem: the MCP `instructions` field is 1.3KB and describes the
 * division of labour and the lifecycle — create, edit, inspect, render — and
 * says nothing about the vocabulary. Every capability fact lives instead in the
 * edit tool's description, a single 10KB string inside `tools/list`. So an
 * agent finishes reading the free, always-delivered slot knowing the workflow
 * and none of the primitives, and starts building a bar chart out of
 * rectangles. Four round trips later it finds `set_chart_data`.
 *
 * That is not a documentation problem, it is a placement problem. This module
 * is the fix: one table of "you are about to do X by hand — don't, use Y",
 * rendered into `instructions` so it arrives before the first tool call, and
 * returned again in the reply to the calls that always open a session, so an
 * agent whose client dropped the instructions still gets it without paying for
 * an extra round trip.
 *
 * Three rules keep it worth its bytes:
 *
 *  - It names the manual approach, not just the primitive. "Use set_chart_data"
 *    helps nobody who has not yet realised they are drawing a chart. "Fifteen
 *    rectangles you keep in sync by hand" is what the agent recognises itself
 *    doing.
 *  - It states what is NOT there. An agent that cannot find counting numbers
 *    will search for them; saying they do not exist ends the search in one line
 *    instead of five calls.
 *  - Every primitive it names is checked against the real operation and tool
 *    lists, so this cannot advertise something the engine does not have.
 */

import { CREATIVE_OPERATION_TYPES } from "./operation-contract";

export interface CreativeCapabilityEntry {
  /** What the agent is about to do, in the agent's own terms. */
  readonly instead: string;
  /** The operations or tools that do it natively. */
  readonly use: readonly string[];
  /** Why it is worth the switch, where that is not obvious. */
  readonly why?: string;
}

/**
 * The reach-for-this table.
 *
 * Ordered by how much a real build lost to each: the first six are all things
 * the 2026-09-02 SARA film did by hand before finding the primitive.
 */
export const CREATIVE_CAPABILITY_MAP: readonly CreativeCapabilityEntry[] = [
  {
    instead: "Drawing a chart out of rectangles, lines and hand-placed number labels",
    use: ["add_element", "set_chart_data", "set_chart_axes", "set_chart_point_emphasis"],
    why: "A chart element derives every coordinate from the series and the axis bounds, so resizing it or editing the data never means recomputing geometry. Animate drawProgress for a native draw-on instead of keyframing fifteen bars in sync. set_chart_axes gives it ticks, gridlines, categories and value labels with no text elements at all - its callouts carry their own startMs/durationMs/fadeMs too, so a note landing a second after the bars finish drawing is one field on the callout, not a separate timed text element plus a tick.",
  },
  {
    instead: "Authoring a count-up as six or seven timed text elements per figure, swapped by hand to look roughly linear",
    use: ["set_counter"],
    why: "One text element interpolates between two values over a duration and formats the result - shares chart.ts's format/precision vocabulary (plain, compact, percent) plus an optional prefix and suffix. Three figures used to cost twenty elements; now three.",
  },
  {
    instead: "Building a frosted panel from a blur, a tint, a border, a highlight and a shadow that all have to agree",
    use: ["set_glass"],
    why: "One primitive resolves all six, so two panels authored a week apart are the same material. It costs about 11ms per panel per frame at 1080p, and the number of glass surfaces matters far more than how strong the blur is, so keep it on the two or three surfaces that carry the composition.",
  },
  {
    instead: "Authoring the same push-in, drift or pull-back onto twenty elements so they agree",
    use: ["set_scene_camera", "set_group_transform"],
    why: "One animated transform over the whole scene or the whole group. Twenty tracks that must agree exactly will eventually not, and the composition shears.",
  },
  {
    instead: "Keyframing each child of a group one after another to make them cascade",
    use: ["stagger_group", "orbit_group"],
    why: "stagger_group cascades one property across a group with an explicit absolute/delta/multiplier mode; orbit_group lays items around a centre and can rotate them.",
  },
  {
    instead: "Splitting a headline into one text element per word to animate them separately",
    use: ["apply_text_animation", "explode_text"],
    why: "apply_text_animation gives one text element block/line/word/character motion with stagger. Reach for explode_text only when the words need to become independently addressable objects afterwards. Note its startMs is element-local, unlike every other startMs.",
  },
  {
    instead: "Assembling a product interface out of many separate elements",
    use: ["add_element", "animate_ui_node", "set_ui_node_timing", "move_ui_node", "resize_ui_node"],
    why: "A ui element is a fixed viewport plus a validated box/text/image tree, and each node animates independently — so rows stagger and a value scales while its card holds still, without tearing the interface into separate elements.",
  },
  {
    instead: "Building a card - a glass panel with its heading and its chart - as several separate elements kept in sync by hand so it can be staggered or orbited as one, or reaching for a ui element because glass and chart nodes do not exist there either",
    use: ["add_element", "stagger_group", "orbit_group"],
    why: "A composite element's children are real elements - chart, text, shape, image, video, ui, even a nested composite - positioned on the composite's own local viewport, sharing the composite's one transform and the scene's one clock. Put the composite in a group and stagger_group/orbit_group move the whole card as one unit, because the group has exactly one child. Groups still do not nest and an element still belongs to at most one group - the composite is what a card should be, not a workaround for that rule.",
  },
  {
    instead: "Drawing a connecting line between two nodes as a rotated rectangle you reposition whenever either moves",
    use: ["add_element", "set_connector"],
    why: "A connector element is derived from its two endpoints and follows them. Animate drawProgress for a draw-on edge.",
  },
  {
    instead: "Faking a shape change by cross-fading two separate static shape elements under a dissolve",
    use: ["set_shape_morph"],
    why: "One shape element's own outline interpolates from one polygon to another on its own element-local clock, so the eye tracks one object changing shape instead of watching two shapes swap. Straight edges between points only, no curves - a circular endpoint is a many-sided polygon standing in for one, not an arc. Unequal point counts and mismatched start vertices are resolved automatically.",
  },
  {
    instead: "Matching positions by hand across a cut so an object appears to continue into the next scene",
    use: ["continue_element", "continue_group", "set_transition"],
    why: "The incoming element interpolates from where the outgoing one finished. It needs an overlap to happen in, which is the outgoing scene's transitionOut, so set the transition first.",
  },
  {
    instead: "Sending one update per element to restyle the same role across every scene",
    use: ["update_elements"],
    why: "One patch with a suffix, tag, alias or semantic selector. Restyling eight scrims is one operation. A selector that matches nothing fails the transaction rather than silently doing nothing.",
  },
  {
    instead: "Shrinking a font by hand until the text stops overflowing its box",
    use: ["set_text_fit"],
    why: "mode shrink reduces the size to fit, down to a minimum you set.",
  },
  {
    instead: "Keyframing music gain down wherever a voiceover happens",
    use: ["add_audio_clip", "update_audio_clip"],
    why: "duckUnderVoice + duckToGain derives the duck from where the voiceover actually is, so moving the voiceover moves the duck. Audio times are on the rendered timeline, not scene-local.",
  },
  {
    instead: "Guessing where the beats are to cut against music",
    use: ["studio_analyze_audio_asset"],
    why: "Returns the energy envelope and transient times, and suggested edit points, for a registered audio asset.",
  },
  {
    instead: "Adjusting scene durations one at a time to hit an exact runtime",
    use: ["normalize_timeline_duration"],
    why: "Lands the film on an exact overlap-aware duration. Transitions overlap, so the rendered film is shorter than the sum of the scene durations.",
  },
  {
    instead: "Spending a revision to find out whether an edit is valid",
    use: ["studio_edit_creative_project"],
    why: "Pass dry_run: true. It validates, reports the layout and coverage warnings the result would raise, and creates no revision.",
  },
  {
    instead: "Reverse-engineering a value's shape by sending a transaction and reading the rejection",
    use: ["studio_describe_creative_schema"],
    why: "A worked, executable example of every operation and element type, the shapes inside them, the structural rules the validator enforces, and which clock each time field is on. Filter by section or operation so one lookup is cheap.",
  },
  {
    instead: "Rendering the whole film to see whether one moment looks right",
    use: ["studio_render_creative_frame", "studio_render_creative_contact_sheet", "studio_inspect_timeline_state"],
    why: "A single frame or a multi-timestamp sheet uses the same composition as the final render. inspect_timeline_state explains why a frame looks wrong without rendering anything at all.",
  },
  {
    instead: "Reading the whole document back to find out what is in it, or writing it to a file to grep for an id",
    use: ["studio_get_creative_project"],
    why: "Pass return: \"outline\" for every scene's resolved timing plus each element's id, type, name, timing, hidden/locked state and group, and each group's member ids — enough to find and reference an element, without the animation keyframes and transforms that make document expensive. return: \"summary\" is lighter still when only the scene list and resolved timeline are needed. It also returns the project scratchpad - a previous session's brief. Narrow either with the scene/element/tag/include filters to read only the part you are editing.",
  },
];

/**
 * Things an agent will look for and not find.
 *
 * Stated because the search is the expensive part: an agent hunting for native
 * counting numbers spends several calls before concluding they are absent, and
 * concludes it far less confidently than a sentence here would.
 */
export const CREATIVE_KNOWN_GAPS: readonly string[] = [
  "Groups still do not nest and an element still belongs to at most one group - that is not a gap to route around any more. Use a composite element (children are real elements on their own local viewport, sharing one transform) for a card that has to move as one; ui remains a separate, closed product-interface tree, not a substitute for either.",
  "apply_text_animation targets a top-level text element or a direct composite text child via elementId + childId. Text inside a ui tree continues to animate through animate_ui_node keyframes.",
  "Chart strokes and fills are SVG paint and take literal or token colours only. Gradients are valid for shape fills, backgrounds and ui surfaces.",
  "Long renders run as reconnectable detached sandbox commands with progress and estimated_completion_ms; an expired sandbox is retried once. Range renders remain useful when you deliberately want separate clips.",
];

/** One line naming the traps that a wrong-looking frame is usually caused by. */
export const CREATIVE_TIME_BASE_WARNING =
  "Time bases differ and nothing else warns you: apply_text_animation.startMs is element-local, apply_motion_preset.startMs and every keyframe timeMs are scene-local, and audio clips and markers are on the rendered timeline. Element x/y keyframe values are absolute canvas positions, not offsets — only motion presets and stagger_group take an absolute/delta/multiplier mode.";

/**
 * The map as text, for the `instructions` field delivered on initialize.
 *
 * Kept compact deliberately: it is paid on every connection, so it earns its
 * bytes by preventing round trips, and prose that merely reads well does not.
 */
export function renderCreativeCapabilityGuide(): string {
  const lines = [
    "REACH FOR THE PRIMITIVE. Each of these is something a real build did by hand before finding the native way; the manual route costs an order of magnitude more operations and animates worse.",
    ...CREATIVE_CAPABILITY_MAP.map((entry) => `- ${entry.instead} -> ${entry.use.join(", ")}.${entry.why ? ` ${entry.why}` : ""}`),
    "",
    `NOT AVAILABLE, so do not go looking: ${CREATIVE_KNOWN_GAPS.join(" ")}`,
    "",
    CREATIVE_TIME_BASE_WARNING,
    "",
    "Call studio_describe_creative_schema before authoring for the exact shape of anything above.",
  ];
  return lines.join("\n");
}

/**
 * The digest returned alongside the calls that open a session.
 *
 * Structured rather than prose here, because it is being handed to a caller
 * that is already parsing a JSON reply, and shorter than the instructions
 * rendering because it is a reminder rather than a first introduction.
 */
export function creativeCapabilityDigest(): Record<string, unknown> {
  return {
    read_this_first:
      "Each entry is something a real build authored by hand before finding the native primitive. Check it before assembling anything out of shapes, duplicated keyframes or one-element-per-word.",
    reach_for: CREATIVE_CAPABILITY_MAP.map((entry) => ({ instead: entry.instead, use: entry.use })),
    not_available: CREATIVE_KNOWN_GAPS,
    time_bases: CREATIVE_TIME_BASE_WARNING,
    exact_shapes: "studio_describe_creative_schema",
  };
}

/** Every primitive this map names, for the guard test. */
export function creativeCapabilityReferences(): string[] {
  return [...new Set(CREATIVE_CAPABILITY_MAP.flatMap((entry) => entry.use))];
}

/** Operation types named by the map, as opposed to tool names. */
export function creativeCapabilityOperations(): string[] {
  return creativeCapabilityReferences().filter((name) => CREATIVE_OPERATION_TYPES.includes(name));
}
