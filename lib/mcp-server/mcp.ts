import { CREATIVE_OPERATION_SCHEMA } from "../creative/operation-contract";
import { CREATIVE_CANVAS_MAX_DIMENSION, CREATIVE_ELEMENT_TYPES } from "../creative/schema";
import { renderCreativeCapabilityGuide } from "../creative/capability-map";
import { documentSha256 } from "../creative/document-hash";
import { creativeRenderCost, videoGenerationCost } from "../credit-costs";
import { GEMINI_TTS_VOICES, GEMINI_TTS_VOICE_STYLES } from "../creative/audio-workers";
import { MAX_TRANSACTION_OPERATIONS } from "../creative/schema-guide";

/**
 * Rates quoted to callers, computed from the cost table rather than written
 * down beside it. A field run planned a film against a figure in a document
 * that repricing had made 2.5x wrong; a derived quote cannot drift.
 */
const VIDEO_CREDITS_PER_SECOND = {
  "480p": videoGenerationCost(1, "480p"),
  "720p": videoGenerationCost(1, "720p"),
} as const;
const RENDER_CREDITS_PER_SECOND = creativeRenderCost(1000);
const MAX_INLINE_PREVIEW_IMAGE_BYTES = 8 * 1024 * 1024;
const MAX_INLINE_PREVIEW_TOTAL_BYTES = 24 * 1024 * 1024;
const PREVIEW_IMAGE_FETCH_TIMEOUT_MS = 10_000;

const MODERN_PROTOCOL = "2026-07-28";
const LEGACY_PROTOCOLS = ["2025-11-25", "2025-06-18", "2025-03-26", "2024-11-05"] as const;
export const CREATIVE_EDIT_CONTRACT_SHA256 = documentSha256(CREATIVE_OPERATION_SCHEMA);
const SERVER_INFO = {
  name: "Studio Media",
  version: `2.4.0+creative.${CREATIVE_EDIT_CONTRACT_SHA256.slice(0, 12)}`,
};
const INSTRUCTIONS =
  "Studio is deterministic creative execution for your own creative work. You own concept, copy, art direction, image generation and HTML/UI design; Studio owns persistent projects, layers, assets, timeline, validation, revisions, preview, rendering and export. Create a Creative Studio project, or submit a complete CreativeDocument you authored and have it validated and persisted as revision 1. Edit it through atomic, validated transactions where the whole transaction applies or fails without partial mutation, and every accepted transaction creates one recoverable revision. Inspect your work visually: render an exact still frame, or a multi-timestamp contact sheet, from the current revision using the same composition as the final render, then critique the returned image and edit again. No Studio tool reinterprets, redesigns or rewrites your creative instructions. Generators register assets without silently mutating scenes; video generation stays a separate specialized worker. Image uploads use OpenAI file handoff and store exact downloaded bytes without base64 conversion. Completed renders, previews and uploaded media return durable public HTTPS URLs. MP4 rendering is asynchronous: studio_render_creative_project returns a job_id immediately and you poll studio_get_render_job until it completes or fails.\n\n" +
  // Appended rather than written inline: the lifecycle paragraph above says
  // what Studio is, and this says which primitive to use, which is the
  // half an agent was previously left to discover by rejection. It arrives on
  // initialize, before the first tool call, so it costs no round trip.
  renderCreativeCapabilityGuide();
const SERVER_META = {
  "io.modelcontextprotocol/serverInfo": SERVER_INFO,
  "studio/creativeEditContractSha256": CREATIVE_EDIT_CONTRACT_SHA256,
};

type JsonRpcId = string | number | null;
type JsonRpcRequest = {
  jsonrpc?: string;
  id?: JsonRpcId;
  method?: string;
  params?: Record<string, unknown> & { _meta?: Record<string, unknown> };
};

export type McpDeps = {
  start: (input: unknown) => Promise<unknown>;
  get: (id: string) => Promise<unknown | null>;
  uploadImage: (input: unknown) => Promise<unknown>;
  creative?: (name: string, input: unknown) => Promise<unknown>;
};

function response(id: JsonRpcId | undefined, result: unknown) {
  return { jsonrpc: "2.0", id: id ?? null, result };
}

function rpcError(id: JsonRpcId | undefined, code: number, message: string, data?: unknown) {
  return {
    jsonrpc: "2.0",
    id: id ?? null,
    error: { code, message, ...(data === undefined ? {} : { data }) },
  };
}

function protocolVersion(message: JsonRpcRequest): string | undefined {
  const meta = message.params?._meta;
  const version = meta?.["io.modelcontextprotocol/protocolVersion"];
  return typeof version === "string" ? version : undefined;
}

function isModern(message: JsonRpcRequest): boolean {
  return message.method === "server/discover" || protocolVersion(message) === MODERN_PROTOCOL;
}

function complete(message: JsonRpcRequest, body: Record<string, unknown>) {
  if (!isModern(message)) return body;
  const existingMeta =
    body._meta && typeof body._meta === "object" && !Array.isArray(body._meta)
      ? (body._meta as Record<string, unknown>)
      : {};
  return {
    resultType: "complete",
    ...body,
    _meta: { ...SERVER_META, ...existingMeta },
  };
}

function toolResult(
  message: JsonRpcRequest,
  value: unknown,
  isError = false,
  extraContent: Array<Record<string, unknown>> = [],
) {
  const body: Record<string, unknown> = {
    content: [
      { type: "text", text: typeof value === "string" ? value : JSON.stringify(value) },
      ...extraContent,
    ],
  };
  if (isError) body.isError = true;
  else body.structuredContent = value;
  return complete(message, body);
}

function creativePreviewImageDescriptors(
  name: string,
  value: unknown,
  args: Record<string, unknown>,
): Array<{ url: string; mimeType: string }> {
  if (!value || typeof value !== "object" || Array.isArray(value)) return [];
  const result = value as Record<string, unknown>;
  if (name === "studio_render_creative_contact_sheet" && (args.return_images === "frames" || args.return_images === "both")) {
    const frames = Array.isArray(result.frames) ? result.frames : [];
    const frameImages = frames.flatMap((entry) => {
      if (!entry || typeof entry !== "object") return [];
      const frame = entry as Record<string, unknown>;
      return typeof frame.output_url === "string" && frame.output_url.startsWith("https://")
        ? [{ url: frame.output_url, mimeType: typeof frame.content_type === "string" ? frame.content_type : "image/png" }]
        : [];
    });
    if (args.return_images === "frames") return frameImages;
    const sheet = typeof result.contact_sheet_url === "string" && result.contact_sheet_url.startsWith("https://")
      ? [{ url: result.contact_sheet_url, mimeType: typeof result.content_type === "string" ? result.content_type : "image/png" }]
      : [];
    return [...sheet, ...frameImages];
  }
  const url =
    name === "studio_render_creative_frame"
      ? result.output_url
      : name === "studio_compare_frame"
        ? result.difference_url
        : name === "studio_edit_creative_project" && result.thumbnails && typeof result.thumbnails === "object"
          ? (result.thumbnails as Record<string, unknown>).contact_sheet_url
      : name === "studio_render_creative_contact_sheet" ||
          name === "studio_inspect_video_asset"
        ? result.contact_sheet_url
        : null;
  if (typeof url !== "string" || !url.startsWith("https://")) return [];
  const mimeType = typeof result.content_type === "string" ? result.content_type : "image/png";
  if (!mimeType.startsWith("image/")) return [];
  return [{ url, mimeType }];
}

async function creativePreviewImageContent(
  name: string,
  value: unknown,
  args: Record<string, unknown>,
): Promise<Array<Record<string, unknown>>> {
  const descriptors = creativePreviewImageDescriptors(name, value, args);
  const content: Array<Record<string, unknown>> = [];
  let totalBytes = 0;
  let omitted = 0;
  // Deliberately sequential: at most one full-resolution response is resident
  // while it is decoded, and one bad frame does not discard the good ones.
  for (const descriptor of descriptors) {
    try {
      const remainingBytes = MAX_INLINE_PREVIEW_TOTAL_BYTES - totalBytes;
      if (remainingBytes <= 0) throw new Error("inline response limit reached");
      const response = await fetch(descriptor.url, { signal: AbortSignal.timeout(PREVIEW_IMAGE_FETCH_TIMEOUT_MS) });
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      const declaredBytes = Number(response.headers.get("content-length"));
      const allowedBytes = Math.min(MAX_INLINE_PREVIEW_IMAGE_BYTES, remainingBytes);
      if (Number.isFinite(declaredBytes) && declaredBytes > allowedBytes) {
        throw new Error("image exceeds inline size limit");
      }
      if (!response.body) throw new Error("image response has no body");
      const reader = response.body.getReader();
      const chunks: Uint8Array[] = [];
      let imageBytes = 0;
      while (true) {
        const { done, value: chunk } = await reader.read();
        if (done) break;
        imageBytes += chunk.byteLength;
        if (imageBytes > allowedBytes) {
          await reader.cancel().catch(() => undefined);
          throw new Error("image exceeds inline size limit");
        }
        chunks.push(chunk);
      }
      const bytes = Buffer.concat(chunks.map((chunk) => Buffer.from(chunk)), imageBytes);
      totalBytes += imageBytes;
      content.push({ type: "image", data: bytes.toString("base64"), mimeType: descriptor.mimeType });
    } catch {
      omitted += 1;
    }
  }
  if (omitted > 0) {
    content.push({
      type: "text",
      text: `Could not inline ${omitted} of ${descriptors.length} preview images. Their durable URLs remain available in structuredContent.`,
    });
  }
  return content;
}

const CREATIVE_MCP_TOOLS = [
  {
    name: "studio_describe_creative_schema",
    description:
      "Canonical, executable value shapes for Creative Studio authoring - the things the edit schema declares as free-form objects and describes only in prose. Returns a complete working example of every edit operation, one complete element of every type, the shapes that appear inside them (ColorValue and gradients, StrokeToken, TextStyleRef and its overrides, transform, timing, keyframe tracks, easing, motion presets, ui node kinds), the structural invariants that are enforced but nowhere stated, and which clock each time field is on. Every example here is applied through the real transaction pipeline by the test suite, so it is what the engine accepts today rather than what the documentation last remembered. Read it before authoring rather than discovering shapes by rejection: sections and operations narrow the response so one lookup does not cost the whole guide. Two facts worth taking from it even if you read nothing else: apply_text_animation.startMs is element-local while apply_motion_preset.startMs and every keyframe timeMs are scene-local and audio clips are on the rendered timeline; and element x/y keyframe values are absolute canvas positions, not offsets, while motion presets and stagger_group declare their own absolute/delta/multiplier mode.",
    inputSchema: {
      type: "object",
      additionalProperties: false,
      properties: {
        sections: {
          type: "array",
          minItems: 1,
          items: { type: "string", enum: ["operations", "elements", "values", "invariants", "time"] },
          description: "Which parts to return. Omit for all of them. operations is one worked example per edit operation; elements is one complete element per type; values is the shapes that appear inside them; invariants is the structural rules a transaction is rejected for; time is the time bases and coordinate spaces.",
        },
        operations: {
          type: "array",
          minItems: 1,
          items: { type: "string" },
          description: "Restrict the operations section to these operation types. Omit for every operation. An unknown type is an error naming the closest matches rather than an empty result.",
        },
        elements: {
          type: "array",
          minItems: 1,
          items: { type: "string", enum: [...CREATIVE_ELEMENT_TYPES] },
          description: "Restrict the elements section to these element types. Omit for every type.",
        },
      },
    },
  },
  {
    name: "studio_create_creative_project",
    description: "Create a revisioned Creative Studio project for the authenticated user, optionally with explicit canvas dimensions and fps. The new document contains exactly one empty scene, id scene-1, 5000ms long, with a neutral design system - author into that scene rather than adding a second one and leaving a blank five seconds at the head of the film. Nothing else is seeded: no placeholder elements and no art direction. The canvas defaults to 1080x1080 at 30fps, so pass width and height for anything else; changing them later is set_canvas, which does not reposition existing elements.",
    inputSchema: {
      type: "object",
      additionalProperties: false,
      properties: {
        return: {
          type: "string",
          enum: ["summary", "document", "none", "outline"],
          description: "How much to send back. summary (default) gives the revision, the duration and each scene's resolved start and end on the overlap-aware timeline. outline adds each scene's element ids, types, names, resolved timings and group membership, without animation tracks or transforms. document returns the whole CreativeDocument, which you already authored and which costs thousands of tokens per call. none returns only the identifiers.",
        },
        title: { type: "string" },
        site_id: { type: "string", description: "Optional owned Studio site/workspace ID." },
        width: { type: "integer", minimum: 1, maximum: CREATIVE_CANVAS_MAX_DIMENSION, description: "Optional canvas width in pixels." },
        height: { type: "integer", minimum: 1, maximum: CREATIVE_CANVAS_MAX_DIMENSION, description: "Optional canvas height in pixels." },
        fps: { type: "integer", minimum: 1, maximum: 120, description: "Optional canvas frame rate." },
      },
    },
  },
  {
    name: "studio_import_creative_document",
    description: "Persist a complete CreativeDocument you authored as a new revisioned Creative Studio project. Call studio_describe_creative_schema first for the canonical shape of every element type and the structural rules the validator enforces - a whole document rejected on one malformed element costs the entire retype. The document is validated against the canonical schema before anything is written; Studio replaces the incoming project identity with the owned project ID, normalizes the title and creates revision 1. Nothing in the document is redesigned, regenerated or reinterpreted. Image and video elements must reference asset IDs already registered with studio_add_asset, studio_generate_image_asset or studio_promote_video_asset.",
    inputSchema: {
      type: "object",
      additionalProperties: false,
      properties: {
        document_sha256: {
          type: "string",
          description: "Optional integrity check. Because the document arrives inline, importing an authored file means retyping it, and a dropped element or mangled number would import cleanly and only show up as a wrong film. Supply the sha256 of the canonical form - object keys sorted at every depth, arrays left in order, no whitespace - and a document that changed in transit is refused before anything is written. The computed hash is returned either way, so you can record it on a first import and verify against it afterwards.",
        },
        return: {
          type: "string",
          enum: ["summary", "document", "none", "outline"],
          description: "How much to send back. summary (default) gives the revision, the duration and each scene's resolved start and end on the overlap-aware timeline. outline adds each scene's element ids, types, names, resolved timings and group membership, without animation tracks or transforms. document returns the whole CreativeDocument, which you already authored and which costs thousands of tokens per call. none returns only the identifiers.",
        },
        title: { type: "string", description: "Optional project title; overrides the document title." },
        site_id: { type: "string", description: "Optional owned Studio site/workspace ID." },
        document: {
          type: "object",
          additionalProperties: true,
          description: "A complete canonical CreativeDocument (version 1) with canvas, designSystem and at least one scene.",
        },
      },
      required: ["document"],
    },
  },
  {
    name: "studio_list_creative_projects",
    description:
      "List your Creative Studio projects, newest first, with the project_id every other creative tool needs. Call this first in a new conversation to find work you already started, rather than creating a duplicate project. Returns identity and shape only — title, status, current revision, last update, rendered duration and scene count — not the documents themselves; read one with studio_get_creative_project.",
    inputSchema: {
      type: "object",
      additionalProperties: false,
      properties: {
        limit: { type: "integer", minimum: 1, maximum: 100, description: "How many to return, newest first. Defaults to 25." },
      },
    },
  },
  {
    name: "studio_get_creative_project",
    description: "Read an authenticated Creative Studio project, its canonical CreativeDocument, current revision and registered assets. For a large project, read part of it instead: scene_ids and element_ids narrow the reply to what you are actually editing, and include adds back only the heavier blocks you need. A sliced reply is marked { partial: true } and carries `scenes` rather than `document`, because a document missing most of its scenes would fail its own validator and must never be round-tripped back. Slicing an eighteen-scene film down to the two scenes you are working on is the difference between four iterations and ten for the same effort. Use return: \"summary\" when you only need the shape and the overlap-aware scene timings. Use return: \"outline\" when you need to find an element before you can slice or edit it: every scene's resolved timing, every element's id/type/name/timing/hidden/locked/group and every group's member ids, with no animation keyframes, transforms or text bodies — cheaper than reading the document and grepping it for an id.",
    inputSchema: {
      type: "object",
      additionalProperties: false,
      properties: {
        scene_ids: {
          type: "array", minItems: 1, items: { type: "string", minLength: 1 },
          description: "Read only these scenes. An id matching nothing is an error, not an empty result.",
        },
        element_ids: {
          type: "array", minItems: 1, items: { type: "string", minLength: 1 },
          description: "Read only these elements, across whichever scenes hold them. Scenes left with no match are omitted.",
        },
        element_aliases: {
          type: "array", minItems: 1, items: { type: "string", minLength: 1 },
          description: "Read elements by project-wide semantic alias instead of UUID.",
        },
        tags: {
          type: "array", minItems: 1, items: { type: "string", minLength: 1 },
          description: "Read elements carrying all of these semantic tags.",
        },
        include: {
          type: "array", minItems: 1,
          items: { type: "string", enum: ["design_system", "audio", "markers", "continuations"] },
          description: "Add these heavier blocks to the reply. Omitted by default when slicing.",
        },
        project_id: { type: "string" },
        return: {
          type: "string",
          enum: ["summary", "document", "none", "outline"],
          description: "How much to send back. document (default) gives the whole CreativeDocument. summary gives the duration and each scene's resolved start and end without the element bodies. outline is the inventory in between: each scene's id/start/end plus every element's id, type, name, resolved timing, hidden/locked state and group, and each group's member element ids — everything you need to find and reference an element by id, without the animation keyframes and transforms that make document expensive.",
        },
      },
      required: ["project_id"],
    },
  },
  {
    name: "studio_edit_creative_project",
    description: "Apply multiple CreativeDocument edit operations atomically. For the exact shape of any value below - a complete worked example of every operation, one element of every type, and which clock each time field runs on - call studio_describe_creative_schema rather than discovering it by rejection. The whole transaction validates or fails without partial mutation. Every successful transaction creates one recoverable revision. Clip editing operations work on video elements: split_clip cuts a clip at an exact scene millisecond without losing or duplicating a frame; trim_clip moves the in/out point; slip_clip shifts which source footage plays without moving the clip; set_clip_speed retimes it (mode hold_source keeps every frame and changes the duration, hold_duration keeps the slot and changes which frames fill it). Any clip whose rate is not 1, and any clip with a speed ramp or a freeze, renders by seeking an exact source frame per output frame, which is correct but materially slower than ordinary playback across the whole clip - so do not reach for a rate of 0.98 to get a subtle drift. Moving the clip's source window costs nothing by comparison. Other clip operations: freeze_clip holds one exact source frame; duplicate_clip copies it into another slot. apply_text_animation gives a text element kinetic typography: granularity block/line/word/character, mode fade/rise/fall/slide-left/slide-right/scale/punch/mask-reveal/tracking, with startMs, durationMs, staggerMs and easing, so words or characters cascade rather than the whole block fading in. set_text_fit shrinks text to fit its box down to a minimum size instead of overflowing. Audio lives on the document rather than in a scene, because a music bed runs the length of the film: add_audio_clip / update_audio_clip / remove_audio_clip take { id, name, assetId, kind (music|voiceover|sfx), startMs, endMs, sourceStartMs, gain (0-2), fadeInMs, fadeOutMs, muted, duckUnderVoice, duckToGain }. Times are on the rendered timeline. Ducking is derived, not stored: a music clip with duckUnderVoice drops to duckToGain whenever a voiceover is actually playing, so moving the voiceover moves the duck. set_clip_speed_ramp gives a clip a variable-speed curve: keyframes of { atMs, speed } are interpolated and integrated, so a ramp consumes exactly the footage the curve describes. set_mask limits where an element is visible (rect or ellipse, normalized 0-1 against the element box, with feather and invert). set_motion_blur adds velocity-derived directional blur at a film shutter angle - 180 is a normal cinematic shutter. A chart element (type chart) draws a line, area or bar chart from one numeric series instead of assembling it from rectangles and lines by hand: chartKind is line, area or bar; series is values only, spaced evenly along x. Geometry is entirely derived from series and the axis bounds, never authored, so resizing the element or editing series never means recomputing a single coordinate. axisMin/axisMax are optional - left unset, a line chart stays tight to the data's own min/max, while area and bar envelope zero so the fill or bars always have a baseline to rest against; set them explicitly to lock two charts to the same scale or to zoom into a band. Every chart requires a stroke ({ width, color }, a StrokeToken): it draws the line/edge for every kind, including a bar's outline, so give it width 0 to hide it rather than omitting it. fill (a ColorValue, optional) paints the area under an area chart's curve or the body of each bar; it is ignored for line. drawProgress (0-1, defaults to 1, fully drawn) reveals the line/bars as it draws, animated through the ordinary keyframe vocabulary exactly like x, y or opacity - this is the primitive's whole point: the draw-on motion is native, not fifteen keyframed rectangles kept in sync by hand. fillProgress (0-1, area chartKind only) reveals the area fill independently of drawProgress and defaults to mirror it, so the line and its fill draw together unless you animate fillProgress on its own - to have the fill catch up once the line finishes, or lead it. Every generated point stays individually addressable without ever being a stored object of its own: pointEmphasis is a sparse array of { index, scale, color }, each entry calling out one point by its position in series - a larger, optionally recoloured marker on a line/area point, or a fill override on one bar - and set_chart_point_emphasis sets or clears a single entry by index without resending the rest of the series. Create a chart with add_element (type chart, alongside chartKind/series/stroke and the rest); iterate on its numbers, bounds, progress or base styling afterward with set_chart_data, which replaces that whole bundle in one call so refining a chart's data never means resending its transform, timing or animations too. set_fill sets a shape element's fill: a literal color, a design token, or a gradient - { kind: \"gradient\", gradient: { kind: \"linear\"|\"radial\"|\"conic\", stops: [{ offset, color }, ...], angle, centerX, centerY } }. Stops need at least two and need not be pre-sorted - offset is normalized 0-1 along the gradient and the resolver orders them for you - and each stop's own color must itself be literal or token, never another gradient. angle is degrees in CSS convention (0 up, clockwise), for linear and conic; centerX/centerY are normalized 0-1 against the element's own box, default 0.5, 0.5, for radial and conic; a field the chosen kind does not use is ignored. A gradient renders anywhere a background can - shape fill, canvas and scene background, a ui element's or a ui box node's own background, a ui pointer's color - and is rejected at validation everywhere only a flat color can render, such as a stroke color, a text color, or a gradient stop's own color, with the error naming a literal or token color as the fix. Gradient stops are static for now: the keyframe vocabulary interpolates a single number per named property, and a variable-length list of colored stops has no fixed property to attach a track to, so animate a gradient by sending a new set_fill rather than an animation track. set_blend_mode composites an element against whatever is behind it with a CSS mix-blend-mode - normal, multiply, screen, overlay, darken, lighten, color-dodge, color-burn, hard-light, soft-light, difference, exclusion, hue, saturation, color or luminosity - which pairs well with a gradient fill or a translucent layer over footage; omit blendMode to clear it back to normal. continue_element makes one element become another across a scene boundary - an orb becoming an integration hub, a graph point becoming a network node, a small interface growing into the next composition. The incoming element is drawn interpolating from where the outgoing one finished toward where it belongs, so the eye tracks one object through the cut instead of seeing two compositions swapped. It must fit inside the scenes' overlap, which is the outgoing scene's transitionOut duration: a continuation with no overlap to happen in renders as a plain cut, so it is rejected at validation with the transition to lengthen named. Use it instead of matching positions by hand. set_scene_camera gives a scene one transform over every element in it, and set_group_transform gives a group one over its children while each keeps its own local coordinates. Both take { x, y, scaleX, scaleY, rotation, opacity, anchorX, anchorY } and animate through the ordinary keyframe vocabulary. Use them instead of authoring the same move onto many elements: a push-in, pull-back, pan, drift or a whole cluster shrinking and sliding left is one animated track rather than twenty that must agree exactly or the composition shears. anchorX/anchorY is the pivot, normalized 0-1 against the canvas, so 0.5, 0.5 pushes into the centre of frame and 0.25, 0.75 pushes into the lower left. A group's opacity multiplies each child's rather than compositing the group, so overlapping children under a half-opaque group read darker where they overlap; a camera composites the scene properly. An element belongs to at most one group. add_marker / remove_marker place editing metadata on the timeline; markers never affect rendering. Easing accepts either a named preset or { kind: \"cubic-bezier\", x1, y1, x2, y2 }. update_elements applies one patch to many elements at once: give either an explicit targets list of {sceneId, elementId}, or elementIdEndsWith to select every element whose id ends with that suffix (optionally narrowed with sceneIds). Use it for templated films where one element role repeats across every scene - restyling eight scrims is one operation, not eight. A suffix that matches nothing fails the transaction rather than silently doing nothing. Element types are text, image, video, shape and ui. A ui element is a deterministic product-interface clip: a fixed { width, height } viewport plus a validated tree of box/text/image nodes with pixel frames, optional vertical scroll and an optional pointer/tap indicator. Use ui for real interface motion, overlays and native typography; use generated video assets for cinematic footage. High-level motion authoring is available without hand-writing every child track: stagger_group cascades one property across a group's children, orbit_group lays out or animates a group's items around a centre, and explode_text converts one text block into independently addressable word/character elements grouped for follow-up motion. Nodes inside a ui element animate independently: animate_ui_node gives one node its own keyframe tracks, set_ui_node_timing brings it in and out, and move_ui_node / resize_ui_node reposition it. That is how rows stagger, a value scales while its card holds still, or one chip exits left - without tearing the interface apart into separate elements. Node x and y are viewport pixels relative to the parent node; scaleX, scaleY and rotation pivot about the node's own centre; timing is scene-local milliseconds, the same clock the element uses. Hiding a node hides its children with it. A ui element accepts no HTML string, script or external URL - images inside it must reference registered asset IDs and colors/typography must use design tokens or literal values.",
    inputSchema: {
      type: "object",
      additionalProperties: false,
      properties: {
        dry_run: {
          type: "boolean",
          description: "Validate and inspect the transaction without saving it. Returns whether it would apply, the layout and clip-coverage warnings the resulting document would raise, and the document or summary — but creates no revision and changes nothing. Use it to explore an edit you are unsure of, so a misreading costs a call rather than a revision.",
        },
        thumbnail_times_ms: {
          type: "array", minItems: 1, maxItems: 3, items: { type: "number", minimum: 0 },
          description: "Optional exact timestamps rendered after a successful persisted edit. Returns a contact sheet and full-size frame URLs from the new revision.",
        },
        return: {
          type: "string",
          enum: ["summary", "changed", "document", "none"],
          description: "How much to send back. summary (default) gives the revision, the duration and each scene's resolved start and end on the overlap-aware timeline. document returns the whole CreativeDocument, which you already authored and which costs thousands of tokens per call. none returns only the identifiers.",
        },
        project_id: { type: "string" },
        transaction: {
          type: "object",
          additionalProperties: false,
          properties: {
            summary: { type: "string" },
            operations: { type: "array", minItems: 1, maxItems: MAX_TRANSACTION_OPERATIONS, items: CREATIVE_OPERATION_SCHEMA },
          },
          required: ["summary", "operations"],
        },
      },
      required: ["project_id", "transaction"],
    },
  },
  {
    name: "studio_render_creative_frame",
    description: "Render one exact still frame from the project's current validated revision and return a durable PNG URL. The image is produced by the same Remotion composition, renderer snapshot and document/asset input props as the final MP4 render, so what you see is what the final render contains. time_ms must be at least zero and less than the project's rendered duration; out-of-range values are rejected rather than clamped. Use this to visually critique your own work before rendering video.",
    inputSchema: {
      type: "object",
      additionalProperties: false,
      properties: {
        project_id: { type: "string" },
        time_ms: {
          type: "number",
          minimum: 0,
          description: "Exact millisecond offset on the rendered timeline; resolved to frame floor(time_ms * fps / 1000).",
        },
      },
      required: ["project_id", "time_ms"],
    },
  },
  {
    name: "studio_compare_frame",
    description: "Compare a native-size PNG/JPEG/WebP capture of the React Creative Studio preview against the exact Remotion still at the same project timestamp. Returns pixel metrics and a durable red difference image; dimensions must match.",
    inputSchema: {
      type: "object", additionalProperties: false,
      properties: {
        project_id: { type: "string" }, time_ms: { type: "number", minimum: 0 },
        preview_image_base64: { type: "string", description: "Native-size preview capture bytes as base64; a data:image/...;base64 prefix is accepted." },
      },
      required: ["project_id", "time_ms", "preview_image_base64"],
    },
  },
  {
    name: "studio_render_creative_contact_sheet",
    description: "Render several exact still frames from the project's current validated revision in one pass and return both a single composited contact-sheet PNG and the durable URL of every individual frame with its timestamp and frame index. Uses the same composition and renderer snapshot as the final MP4 render. Use this to review pacing, motion and composition across the whole timeline before rendering video.",
    inputSchema: {
      type: "object",
      additionalProperties: false,
      properties: {
        project_id: { type: "string" },
        times_ms: {
          type: "array",
          minItems: 1,
          maxItems: 12,
          items: { type: "number", minimum: 0 },
          description: "Distinct millisecond offsets on the rendered timeline, each less than the project's rendered duration.",
        },
        return_images: {
          type: "string", enum: ["sheet", "frames", "both"], default: "sheet",
          description: "Which rendered images to place directly in MCP image content. frames returns each full-resolution PNG so remote agents can inspect fine detail without reaching the asset host.",
        },
      },
      required: ["project_id", "times_ms"],
    },
  },
  {
    name: "studio_render_creative_project",
    description: "Start rendering the current validated CreativeDocument to H.264 MP4 using the Remotion/Vercel renderer, persisting the exact output to Studio R2 storage. Returns immediately with a job_id and status \"rendering\" - it does not wait for the render. A minute of 1080x1920 footage takes minutes to render, so poll studio_get_render_job with the returned job_id every 15-30 seconds until status is \"completed\" (output_url is then the durable MP4 URL) or \"failed\" (error explains why). Never treat the immediate response as a finished render, and never re-run this tool while a job for the same project is still rendering. Pass scene_id to export one scene on its own - useful for reviewing or reusing a single shot without waiting for the whole film. This spends credits: " + `${RENDER_CREDITS_PER_SECOND} credit per second of finished film, so a 20-second export costs ${creativeRenderCost(20_000)}` + ". Charging per output second is why a one-minute film does not cost the same as a five-second one. This figure comes from the live cost table. On completion the finished MP4 is registered as a video asset automatically and studio_get_render_job returns its output_asset_id, so you can pass it straight to studio_inspect_video_asset and look at what you just rendered without registering it yourself.",
    inputSchema: {
      type: "object",
      additionalProperties: false,
      properties: {
        project_id: { type: "string" },
        scene_id: {
          type: "string",
          description:
            "Optional. Render only this scene as its own MP4 instead of the whole film. The clip starts at zero, keeps the project's canvas and design system, drops the scene's outgoing transition, and carries only the audio that actually sounds during it, cut and re-based so the mix matches what that moment sounds like in the full film.",
        },
        start_ms: { type: "number", minimum: 0, description: "Optional start of the rendered window in milliseconds, relative to the selected film or scene." },
        end_ms: { type: "number", minimum: 0, description: "Optional exclusive end of the rendered window in milliseconds. Must be greater than start_ms and within the selected scope." },
        quality: { type: "string", enum: ["draft", "final"], default: "final", description: "Draft renders at half scale with a lighter encoding profile; final preserves native canvas scale." },
      },
      required: ["project_id"],
    },
  },
  {
    name: "studio_get_render_job",
    description: "Read an authenticated Creative Studio render job. status is the ONLY completion signal: it is one of rendering, completed or failed, and output_url and output_asset_id are set only once it reads completed. progress and metadata.phase are hints from the renderer and deliberately never claim more than status does - the renderer finishes before the file is stored and registered, so progress stays below 1 and phase may read as the renderer's own completion while the job is still finalising. Poll on status, not on progress. A job whose renderer stopped reporting progress is reported as failed rather than left rendering forever. This is the polling companion to studio_render_creative_project.",
    inputSchema: {
      type: "object",
      additionalProperties: false,
      properties: { job_id: { type: "string" } },
      required: ["job_id"],
    },
  },
  {
    name: "studio_add_asset",
    description: "Register an existing durable HTTPS image, video or audio URL as an authenticated Creative Studio asset. This does not insert it into a scene until an explicit edit transaction does so.",
    inputSchema: {
      type: "object",
      additionalProperties: false,
      properties: {
        project_id: { type: "string" },
        site_id: { type: "string" },
        kind: { type: "string", enum: ["image", "video", "audio", "font", "other"] },
        source: { type: "string" },
        url: { type: "string" },
        mime_type: { type: "string" },
        filename: { type: "string" },
      },
      required: ["kind", "url"],
    },
  },
  {
    name: "studio_generate_image_asset",
    description: "Generate a project-aware image through Studio, persist it to permanent storage and register it as a Creative Studio asset. The project document is not mutated; insert the returned asset with a separate edit transaction.",
    inputSchema: {
      type: "object",
      additionalProperties: false,
      properties: {
        project_id: { type: "string" },
        site_id: { type: "string" },
        prompt: { type: "string" },
        format: { type: "string", enum: ["landscape", "square", "portrait"], default: "portrait" },
        label: { type: "string" },
        reference_images: { type: "array", maxItems: 12, items: { type: "string" } },
      },
      required: ["project_id", "prompt"],
    },
  },
  {
    name: "studio_promote_video_asset",
    description: "Register a completed user-owned Studio/Seedance video generation as a Creative Studio video asset without changing the generation record or inserting it into a scene.",
    inputSchema: {
      type: "object",
      additionalProperties: false,
      properties: {
        project_id: { type: "string" },
        site_id: { type: "string" },
        generation_id: { type: "string" },
        label: { type: "string" },
      },
      required: ["project_id", "generation_id"],
    },
  },
  {
    name: "studio_generate_speech_asset",
    description: "Generate a voiceover with Google Gemini 3.1 Flash TTS Preview and register it as an audio asset. The model automatically detects 70+ languages and takes natural-language direction plus inline audio tags such as [whispers], [excited] and [laughs]. Mark the script off from the direction when the line is short - `[deadpan] White. Black. Still.` returns silence, while `Say the following line in a dry, deadpan tone: \"White. Black. Still.\"` does not; a bare tag is only safe ahead of a long line. Returns the asset; the document is not mutated - place it on the timeline with an add_audio_clip edit transaction.",
    inputSchema: {
      type: "object",
      additionalProperties: false,
      properties: {
        project_id: { type: "string" },
        site_id: { type: "string" },
        text: { type: "string", description: "The exact performance prompt and transcript to synthesize. May include an audio profile, scene, director\'s notes and inline audio tags. If it carries direction, name the words to be spoken (quote them, or introduce them with \"say the following line\") - unmarked direction over a short line makes the model read the whole prompt as instruction and return no audio." },
        transcript: { type: "string", description: "Optional spoken words only, used for duration-aligned marker estimates when text also contains direction. If omitted, inline [audio tags] are stripped conservatively." },
        language: { type: "string", default: "auto", description: "Optional BCP-47 language label stored as metadata. Gemini detects the spoken language from the text automatically." },
        voice: {
          type: "string",
          enum: [...GEMINI_TTS_VOICES],
          default: "Kore",
          description: `Gemini voice and style: ${GEMINI_TTS_VOICES.map((voice) => `${voice} (${GEMINI_TTS_VOICE_STYLES[voice]})`).join(", ")}.`,
        },
        label: { type: "string" },
        marker_granularity: { type: "string", enum: ["words", "sentences", "both"], default: "both", description: "Return duration-aligned estimated marker objects to wrap in add_marker operations." },
        marker_offset_ms: { type: "number", minimum: 0, default: 0, description: "Rendered-timeline start of the voiceover clip." },
      },
      required: ["project_id", "text"],
    },
  },
  {
    name: "studio_generate_music_asset",
    description: "Generate a music clip from a text prompt and register it as an audio asset. Describe genre, instrumentation, tempo and mood. Returns the asset; place it with an add_audio_clip edit transaction, typically as kind \"music\" with duck_under_voice enabled so it drops under any voiceover.",
    inputSchema: {
      type: "object",
      additionalProperties: false,
      properties: {
        project_id: { type: "string" },
        site_id: { type: "string" },
        prompt: { type: "string", description: "Genre, instrumentation, tempo and mood." },
        label: { type: "string" },
      },
      required: ["project_id", "prompt"],
    },
  },
  {
    name: "studio_add_sfx_asset",
    description: "Register a byte-stable built-in sound effect without calling a generative model. Place the returned audio asset with add_audio_clip kind sfx.",
    inputSchema: {
      type: "object", additionalProperties: false,
      properties: {
        project_id: { type: "string" }, site_id: { type: "string" },
        effect_id: { type: "string", enum: ["ui-click", "ui-pop", "whoosh", "success", "error", "impact"] },
        label: { type: "string" },
      },
      required: ["project_id", "effect_id"],
    },
  },
  {
    name: "studio_import_svg",
    description: "Import a basic SVG into a new Creative Studio project as editable structured shape and text elements rather than a flattened image.",
    inputSchema: {
      type: "object",
      additionalProperties: false,
      properties: {
        return: {
          type: "string",
          enum: ["summary", "document", "none", "outline"],
          description: "How much to send back. summary (default) gives the revision, the duration and each scene's resolved start and end on the overlap-aware timeline. outline adds each scene's element ids, types, names, resolved timings and group membership, without animation tracks or transforms. document returns the whole CreativeDocument, which you already authored and which costs thousands of tokens per call. none returns only the identifiers.",
        },
        title: { type: "string" },
        site_id: { type: "string" },
        svg: { type: "string", maxLength: 5242880 },
      },
      required: ["svg"],
    },
  },
  {
    name: "studio_analyze_audio_asset",
    description: "Analyze a registered audio asset and return its waveform peaks and detected musical transients in milliseconds, strongest first. This is what makes sound-led editing possible: align cuts and visual events to real onsets rather than to guessed timestamps. Results are cached on the asset; pass refresh true to recompute. Add the returned times as markers with add_marker if you want them on the timeline.",
    inputSchema: {
      type: "object",
      additionalProperties: false,
      properties: {
        asset_id: { type: "string" },
        refresh: { type: "boolean", default: false },
      },
      required: ["asset_id"],
    },
  },
  {
    name: "studio_inspect_video_asset",
    description: "Look at a source video asset before cutting to it. Renders a contact sheet of the raw footage at the timestamps you ask for, with no project and no document involved. For a probe the timeline time IS the source time, so each frame's source_ms is directly the number to put in a clip's sourceStartMs. Use this before choosing segment windows out of generated footage: a model's shot timings do not match the prompt that asked for them, and the alternative is cutting blind, rendering the whole film and reading the mistake backwards. Rejects a timestamp past the end of the asset rather than clamping it, so you are never handed a frame from a different moment than the one you asked about. At most 12 timestamps per call; each frame is a separate render.",
    inputSchema: {
      type: "object",
      additionalProperties: false,
      properties: {
        asset_id: { type: "string", description: "A video asset already registered to you." },
        times_ms: {
          type: "array",
          minItems: 1,
          maxItems: 12,
          items: { type: "number", minimum: 0 },
          description: "Source milliseconds to look at. Must be unique and inside the asset.",
        },
      },
      required: ["asset_id", "times_ms"],
    },
  },
  {
    name: "studio_inspect_timeline_state",
    description: "Inspect the exact deterministic project state at one rendered millisecond without rendering an image. Reports every active scene during overlaps, scene-local time, visible and invisible elements with the reason, resolved transforms/effects/fills, and camera/group wrappers from the same evaluator used by preview and Remotion. Use this to explain why a frame looks wrong before paying for another render.",
    inputSchema: { type: "object", additionalProperties: false, properties: { project_id: { type: "string" }, time_ms: { type: "number", minimum: 0 } }, required: ["project_id", "time_ms"] },
  },
  {
    name: "studio_critique_creative_project",
    description: "Measure structural qualities of a Creative project without a second creative model: shot rhythm, simultaneous element density, scale contrast, animation density, camera/group/continuation use, repeated layouts, transition diversity and palette. Findings expose the actual thresholds that triggered them; the tool measures, the agent decides what to make.",
    inputSchema: { type: "object", additionalProperties: false, properties: { project_id: { type: "string" } }, required: ["project_id"] },
  },
  {
    name: "studio_analyze_reference_video",
    description: "Measure a registered reference video deterministically from rendered source frames: sampled cut evidence, shot durations, frame-change scores, visual density, luminance contrast, composition centre and palette. This is not OCR or a vision model and explicitly reports what it cannot infer. Sampling renders cost the same as source-frame inspection and is capped to keep one analysis bounded.",
    inputSchema: { type: "object", additionalProperties: false, properties: { asset_id: { type: "string" }, sample_interval_ms: { type: "number", minimum: 250, default: 1000 } }, required: ["asset_id"] },
  },
  {
    name: "studio_build_reference_skeleton",
    description: "Build, but do not persist, a complete editable CreativeDocument scaffold from a previously analyzed reference video and an existing project's design system. The scaffold carries measured shot durations, palette/composition anchors and cut markers but copies no reference pixels or copy. Persist it only with an explicit import/edit after reviewing it.",
    inputSchema: { type: "object", additionalProperties: false, properties: { project_id: { type: "string" }, reference_asset_id: { type: "string" }, title: { type: "string" } }, required: ["project_id", "reference_asset_id"] },
  },
  {
    name: "studio_compare_creative_revisions",
    description: "Render the same requested timestamps from two owned revisions of one project into separate contact sheets, then return their document delta and structural-similarity measurements. This compares actual revision renders; it does not pretend to be the still-missing React-preview-vs-Remotion raster parity test.",
    inputSchema: { type: "object", additionalProperties: false, properties: { project_id: { type: "string" }, left_revision_id: { type: "string" }, right_revision_id: { type: "string", description: "Omit for the current revision." }, times_ms: { type: "array", minItems: 1, maxItems: 12, items: { type: "number", minimum: 0 } } }, required: ["project_id", "left_revision_id", "times_ms"] },
  },
  {
    name: "studio_inspect_creative_layout",
    description: "Check a project for mechanical problems before rendering: elements running off the canvas, elements sitting outside the platform action-safe area where captions and UI overlays cover them, text that overflows its own box, and video clips whose source window runs past the end of the footage behind them - which renders black without failing. Returns warnings only - it never edits the document and never blocks an edit. Text overflow uses the same layout estimate the renderer lays text out with, and clip coverage uses the same source-time function the renderer seeks with, so a warning describes what will actually render. Elements that cover the whole canvas, and elements marked role: \"background\", are treated as scenery and raise no canvas or safe-area warnings; a full-bleed plate is not a layout error.",
    inputSchema: {
      type: "object",
      additionalProperties: false,
      properties: {
        project_id: { type: "string" },
        safe_area: {
          type: "string",
          enum: ["reels", "title", "none"],
          default: "reels",
          description: "reels reserves a deep bottom margin for caption and action rail; title uses a flat broadcast margin; none checks only canvas bounds and text overflow.",
        },
      },
      required: ["project_id"],
    },
  },
  {
    name: "studio_get_creative_changes",
    description: "Return only what changed between a revision you already know and the current project. This is the delta companion to get_creative_project and avoids re-reading unchanged scenes.",
    inputSchema: {
      type: "object", additionalProperties: false,
      properties: { project_id: { type: "string" }, since_revision_id: { type: "string" } },
      required: ["project_id", "since_revision_id"],
    },
  },
  {
    name: "studio_list_creative_revisions",
    description: "List saved revision history for a Creative Studio project in sequence order. Each entry carries the summary you wrote on the transaction that created it, so this is a readable history of what changed and not just a list of ids - which is what makes studio_restore_creative_revision a decision rather than a guess. Write transaction summaries that describe the edit, and this becomes the undo history for the whole project.",
    inputSchema: {
      type: "object",
      additionalProperties: false,
      properties: { project_id: { type: "string" } },
      required: ["project_id"],
    },
  },
  {
    name: "studio_restore_creative_revision",
    description: "Restore an earlier owned Creative Studio revision by creating a new revision from that snapshot; existing history is preserved.",
    inputSchema: {
      type: "object",
      additionalProperties: false,
      properties: {
        return: {
          type: "string",
          enum: ["summary", "document", "none", "outline"],
          description: "How much to send back. document (default) gives the whole CreativeDocument. summary gives the duration and each scene's resolved start and end without the element bodies. outline gives each scene's element ids, types, names, resolved timings and group membership, without animation tracks or transforms.",
        },
        project_id: { type: "string" },
        revision_id: { type: "string" },
      },
      required: ["project_id", "revision_id"],
    },
  },
] as const;

export const VIDEO_MCP_TOOLS = [
  {
    name: "studio_generate_video",
    description:
      "Start an asynchronous Studio video generation job for the authenticated user. Poll the returned job_id with studio_get_video_job until completed. This spends credits: " + `${VIDEO_CREDITS_PER_SECOND["480p"]} credits per second at 480p and ${VIDEO_CREDITS_PER_SECOND["720p"]} at 720p, so a 15-second clip costs ${videoGenerationCost(15, "480p")} or ${videoGenerationCost(15, "720p")}` + ". 720p costs a little over twice 480p and is worth it for macro detail and for footage that will fill a 1080-wide frame; 480p is the right default otherwise. Generating once and cutting many shots out of the result costs a fraction of generating each shot separately, and matches better. These figures come from the live cost table, so trust them over any written down elsewhere.",
    inputSchema: {
      type: "object",
      additionalProperties: false,
      properties: {
        prompt: { type: "string", description: "Detailed video generation prompt." },
        mode: {
          type: "string",
          enum: ["cinematic", "automotive_broll", "image_to_video", "avatar"],
          default: "cinematic",
        },
        references: {
          type: "array",
          maxItems: 12,
          items: {
            type: "object",
            additionalProperties: false,
            properties: {
              url: { type: "string", description: "Public HTTP(S) reference image URL." },
              label: { type: "string" },
              role: {
                type: "string",
                enum: ["vehicle", "person", "product", "brand", "first_frame", "style"],
              },
            },
            required: ["url"],
          },
        },
        aspect_ratio: { type: "string", enum: ["16:9", "9:16"], default: "9:16" },
        resolution: { type: "string", enum: ["720p", "480p"], default: "720p" },
        duration: { type: "integer", minimum: 4, maximum: 15, default: 5 },
        generate_audio: { type: "boolean", default: true },
        provider: { type: "string", enum: ["openrouter"], default: "openrouter" },
        model: { type: "string", description: "Optional provider model override." },
        site_id: {
          type: "string",
          description:
            "Optional Studio site/workspace ID owned by the authenticated user. If omitted, the user's default site or oldest available site is used.",
        },
        idempotency_key: {
          type: "string",
          description: "Stable unique key for this intended generation; retries must reuse the same key.",
        },
      },
      required: ["prompt", "idempotency_key"],
    },
  },
  {
    name: "studio_get_video_job",
    description:
      "Poll and advance a video job owned by the authenticated Studio user. When completed, video_url is a durable public HTTPS asset.",
    inputSchema: {
      type: "object",
      additionalProperties: false,
      properties: { job_id: { type: "string" } },
      required: ["job_id"],
    },
  },
  {
    name: "studio_upload_image",
    description:
      "Persist the exact ChatGPT-generated or user-uploaded image file for the authenticated Studio user and return a durable public HTTPS URL suitable for Buffer and other publishing workflows. Pass the actual file; do not convert it to base64.",
    inputSchema: {
      type: "object",
      additionalProperties: false,
      $defs: {
        OpenAIFile: {
          type: "object",
          additionalProperties: false,
          properties: {
            download_url: {
              type: "string",
              description: "Temporary authorized ChatGPT file download URL.",
            },
            file_id: {
              type: "string",
              description: "OpenAI file identifier for the handed-off image.",
            },
            mime_type: { type: "string" },
            file_name: { type: "string" },
          },
          required: ["download_url", "file_id"],
        },
      },
      properties: {
        file: { $ref: "#/$defs/OpenAIFile" },
      },
      required: ["file"],
    },
    _meta: {
      "openai/fileParams": ["file"],
    },
  },
  ...CREATIVE_MCP_TOOLS,
] as const;

const CREATIVE_TOOL_NAMES: ReadonlySet<string> = new Set(CREATIVE_MCP_TOOLS.map((tool) => tool.name));

export async function handleMcpMessage(
  message: JsonRpcRequest,
  deps: McpDeps,
): Promise<Record<string, unknown> | null> {
  if (!message || message.jsonrpc !== "2.0" || typeof message.method !== "string") {
    return rpcError(message?.id, -32600, "Invalid Request");
  }

  if (message.method === "notifications/initialized" || message.method === "notifications/cancelled") {
    return null;
  }

  if (message.method === "initialize") {
    const requested = message.params?.protocolVersion;
    const selected =
      typeof requested === "string" && (LEGACY_PROTOCOLS as readonly string[]).includes(requested)
        ? requested
        : LEGACY_PROTOCOLS[0];
    return response(message.id, {
      protocolVersion: selected,
      capabilities: { tools: {} },
      serverInfo: SERVER_INFO,
      instructions: INSTRUCTIONS,
    });
  }

  if (message.method === "server/discover") {
    return response(message.id, {
      resultType: "complete",
      supportedVersions: [MODERN_PROTOCOL],
      capabilities: { tools: {} },
      instructions: INSTRUCTIONS,
      ttlMs: 300_000,
      cacheScope: "private",
      _meta: SERVER_META,
    });
  }

  if (message.method === "ping") {
    return response(message.id, complete(message, {}));
  }

  if (message.method === "tools/list") {
    return response(message.id, complete(message, { tools: VIDEO_MCP_TOOLS }));
  }

  if (message.method === "tools/call") {
    const name = message.params?.name;
    const args =
      message.params?.arguments && typeof message.params.arguments === "object"
        ? message.params.arguments
        : {};

    const known =
      name === "studio_generate_video" ||
      name === "studio_get_video_job" ||
      name === "studio_upload_image" ||
      (typeof name === "string" && CREATIVE_TOOL_NAMES.has(name));
    if (!known) return rpcError(message.id, -32602, `Unknown tool: ${String(name)}`);

    try {
      if (name === "studio_generate_video") {
        return response(message.id, toolResult(message, await deps.start(args)));
      }

      if (name === "studio_upload_image") {
        return response(message.id, toolResult(message, await deps.uploadImage(args)));
      }

      if (typeof name === "string" && CREATIVE_TOOL_NAMES.has(name)) {
        if (!deps.creative) {
          return response(message.id, toolResult(message, "Creative Studio runtime is unavailable.", true));
        }
        const value = await deps.creative(name, args);
        const previewContent = await creativePreviewImageContent(name, value, args as Record<string, unknown>);
        return response(message.id, toolResult(message, value, false, previewContent));
      }

      const jobId =
        typeof (args as Record<string, unknown>).job_id === "string"
          ? ((args as Record<string, unknown>).job_id as string).trim()
          : "";
      if (!jobId) return response(message.id, toolResult(message, "job_id is required.", true));

      const job = await deps.get(jobId);
      if (!job) {
        return response(message.id, toolResult(message, `Video job ${jobId} was not found.`, true));
      }
      return response(message.id, toolResult(message, job));
    } catch (error) {
      const messageText = error instanceof Error ? error.message : String(error);
      return response(message.id, toolResult(message, messageText, true));
    }
  }

  return rpcError(message.id, -32601, "Method not found");
}
