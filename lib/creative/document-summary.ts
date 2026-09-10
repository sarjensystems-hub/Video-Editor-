/**
 * Two compact alternatives to handing back a whole CreativeDocument, plus the
 * `return` vocabulary that chooses between them.
 *
 * Every mutating MCP call used to echo the whole document back. A caller
 * authored the operations, so the reply was almost entirely redundant — and at
 * ~24KB per call by revision 10 it was the single largest consumer of context
 * in a real editing session, an order of magnitude more than the creative
 * decisions it was carrying. `summarizeCreativeDocument` is the fix for that
 * caller: the part it cannot cheaply recompute is where each scene now begins
 * and ends. Scene starts are overlap-aware — a scene ends its transitionOut
 * duration before the next one begins — so a caller that assumes
 * back-to-back placement will cut in the wrong place. Handing back the
 * resolved timeline is what makes this a summary rather than a truncation.
 *
 * `outlineCreativeDocument` answers a different question: not "what changed"
 * but "what is in this film" — for a caller who did not just author the
 * document and needs to find an element by id before it can ask for one.
 * Per-scene element counts were not enough to do that, and the whole document
 * was too much: it carries every animation keyframe and transform to answer a
 * question that only needed ids, types, names, resolved timings and group
 * membership.
 */
import type { CreativeAudioKind, CreativeDocument, CreativeElement, CreativeElementType, CreativeScene } from "./schema";
import { getCreativeRenderedDurationMs } from "./frame-time";

export interface CreativeSceneSummary {
  id: string;
  name: string;
  /** Overlap-aware start on the rendered timeline. */
  start_ms: number;
  duration_ms: number;
  /** Where this scene ends on the rendered timeline; the next may start before it. */
  end_ms: number;
  element_count: number;
}

interface ResolvedSceneWindow {
  scene: CreativeScene;
  start_ms: number;
  end_ms: number;
}

/**
 * Overlap-aware scene placement on the rendered timeline, shared by every
 * read below that reports where a scene actually sits: a scene ends its
 * transitionOut duration before the next one begins, so a caller that
 * assumes back-to-back placement cuts in the wrong place. Kept as one
 * function so `summary` and `outline` cannot quietly disagree about it.
 */
function resolveSceneWindows(document: CreativeDocument): ResolvedSceneWindow[] {
  let cursor = 0;
  return document.scenes.map((scene, index) => {
    const start = cursor;
    // The last scene has nothing to overlap into, so its transitionOut — if a
    // document carries one — does not shorten the timeline.
    const overlap = index === document.scenes.length - 1 ? 0 : scene.transitionOut?.durationMs ?? 0;
    cursor += scene.durationMs - overlap;
    return { scene, start_ms: start, end_ms: start + scene.durationMs };
  });
}

export interface CreativeDocumentSummary {
  title: string;
  /** What the renderer will produce, after transition overlap. */
  duration_ms: number;
  /**
   * The three numbers spelled out, because the drop is easy to miss.
   *
   * Overlapping transitions shorten the film: a set of 250-320ms transitions
   * quietly took a 56.7s project to 52.75s in one session, and the only figure
   * reported was the result. Naming the nominal total and the overlap removed
   * turns a surprise into arithmetic.
   */
  duration_breakdown: {
    nominal_scene_total_ms: number;
    transition_overlap_removed_ms: number;
    rendered_ms: number;
  };
  scene_count: number;
  element_count: number;
  canvas: { width: number; height: number; fps: number };
  scenes: CreativeSceneSummary[];
  audio_count: number;
}

export function summarizeCreativeDocument(document: CreativeDocument): CreativeDocumentSummary {
  const scenes = resolveSceneWindows(document).map(({ scene, start_ms, end_ms }) => ({
    id: scene.id,
    name: scene.name,
    start_ms,
    duration_ms: scene.durationMs,
    end_ms,
    element_count: scene.elements.length,
  }));

  const nominal = document.scenes.reduce((total, scene) => total + scene.durationMs, 0);
  const rendered = getCreativeRenderedDurationMs(document);

  return {
    title: document.title,
    duration_ms: rendered,
    duration_breakdown: {
      nominal_scene_total_ms: nominal,
      transition_overlap_removed_ms: nominal - rendered,
      rendered_ms: rendered,
    },
    scene_count: document.scenes.length,
    element_count: document.scenes.reduce((total, scene) => total + scene.elements.length, 0),
    canvas: {
      width: document.canvas.width,
      height: document.canvas.height,
      fps: document.canvas.fps,
    },
    scenes,
    audio_count: document.audio?.length ?? 0,
  };
}

export interface CreativeElementOutline {
  id: string;
  type: CreativeElementType;
  name: string;
  /**
   * Scene-local visible window. `evaluateSceneAtTime` treats an element with
   * no explicit `timing` as visible for the whole scene, so that default is
   * resolved here too — echoing `undefined` would force every caller to
   * already know the engine's default rather than being told it.
   */
  timing: { start_ms: number; end_ms: number };
  hidden: boolean;
  locked: boolean;
  has_animations: boolean;
  /** The id of the containing group, or null. An element belongs to at most one. Always null for a composite child - children are not scene.groups members. */
  group: string | null;
  /**
   * Composite only: this element's own children, in the same shape, one
   * level at a time (a nested composite's own `children` is populated in
   * turn). This is what makes a composite's children findable at all without
   * paying for `document` - the (elementId, childId) pair a future
   * child-addressing operation needs is exactly (this scene's element id,
   * one of these entries' id).
   */
  children?: CreativeElementOutline[];
}

export interface CreativeGroupOutline {
  id: string;
  name: string;
  element_ids: string[];
}

export interface CreativeSceneOutline {
  id: string;
  name: string;
  /** Overlap-aware start on the rendered timeline, same resolution as `summary`. */
  start_ms: number;
  duration_ms: number;
  end_ms: number;
  elements: CreativeElementOutline[];
  groups: CreativeGroupOutline[];
}

export interface CreativeAudioClipOutline {
  id: string;
  kind: CreativeAudioKind;
  /** Window on the rendered timeline. */
  start_ms: number;
  end_ms: number;
}

export interface CreativeDocumentOutline {
  title: string;
  duration_ms: number;
  scene_count: number;
  element_count: number;
  canvas: { width: number; height: number; fps: number };
  scenes: CreativeSceneOutline[];
  audio: CreativeAudioClipOutline[];
  /** Editing metadata only, so a count is enough to know it exists without the list. */
  marker_count: number;
  /**
   * The project scratchpad, verbatim, when one is set.
   *
   * set_project_scratchpad exists to hold notes that survive between sessions,
   * and it was reachable only through a full `document` read - so the note a
   * previous session left about what this film IS was invisible to the cheap
   * read a resuming session naturally makes. An outline answers "what is in
   * this film"; the author's own statement of what the film is belongs in that
   * answer. Omitted rather than null when unset, so an outline of a project
   * with no note is unchanged.
   */
  scratchpad?: string;
}

/**
 * Whether an element moves or changes over time at all, without spending the
 * keyframe tracks themselves. `animations` is the shared per-property track
 * list every element type can carry; text additionally has its own
 * kinetic-typography `animation`, which is a differently-shaped field and
 * easy to miss if only `animations` is checked. A `ui` element's own
 * top-level `animations` is covered; the independent tracks on the nodes
 * inside its tree are not — the outline reports elements, not node trees, so
 * a still `ui` shell around moving nodes correctly reads as not animated at
 * the element level a caller is looking at here.
 */
function elementHasAnimations(element: CreativeElement): boolean {
  if ((element.animations?.length ?? 0) > 0) return true;
  return element.type === "text" && Boolean(element.animation);
}

/**
 * One element's outline entry, recursing into a composite's own children.
 * `sceneDurationMs` resolves the same "no timing means visible for the whole
 * scene" default `evaluateSceneAtTime` applies, for a child exactly as for a
 * top-level element - a composite child's `timing` is scene-local too (see
 * the design note on CreativeCompositeElement), so there is nothing to
 * translate. `group` is always null for a child: composite children are
 * never scene.groups members.
 */
function elementOutline(
  element: CreativeElement,
  sceneDurationMs: number,
  group: string | null,
): CreativeElementOutline {
  return {
    id: element.id,
    type: element.type,
    name: element.name,
    timing: element.timing
      ? { start_ms: element.timing.startMs, end_ms: element.timing.endMs }
      : { start_ms: 0, end_ms: sceneDurationMs },
    hidden: element.hidden ?? false,
    locked: element.locked ?? false,
    has_animations: elementHasAnimations(element),
    group,
    ...(element.type === "composite"
      ? { children: element.children.map((child) => elementOutline(child, sceneDurationMs, null)) }
      : {}),
  };
}

/**
 * The inventory a caller needs to answer "what is in this film" — element
 * ids, types, names, resolved timings and group membership — without paying
 * for the keyframe tracks, transforms and text bodies that make `document`
 * expensive.
 *
 * This is the rung between `summary` and `document` that neither covers:
 * `summary` reports each scene's `element_count` and stops, so a caller who
 * needs to know *which* elements exist, to reference one in an edit or a
 * slice read, still had to pay for the whole document — animation tracks
 * included — and grep it. Everything excluded here is excluded on purpose:
 * no animation keyframes, no transforms, no text bodies. A caller who needs
 * those already knows which element to ask `document` or a slice for.
 */
export function outlineCreativeDocument(document: CreativeDocument): CreativeDocumentOutline {
  const scenes: CreativeSceneOutline[] = resolveSceneWindows(document).map(
    ({ scene, start_ms, end_ms }) => {
      // An element belongs to at most one group (roadmap invariant #63), so a
      // single pass over this scene's groups gives every element's group
      // membership without an O(elements × groups) scan.
      const elementGroup = new Map<string, string>();
      for (const group of scene.groups) {
        for (const elementId of group.elementIds) elementGroup.set(elementId, group.id);
      }

      return {
        id: scene.id,
        name: scene.name,
        start_ms,
        duration_ms: scene.durationMs,
        end_ms,
        elements: scene.elements.map((element) =>
          elementOutline(element, scene.durationMs, elementGroup.get(element.id) ?? null),
        ),
        groups: scene.groups.map((group) => ({
          id: group.id,
          name: group.name,
          element_ids: group.elementIds,
        })),
      };
    },
  );

  return {
    title: document.title,
    duration_ms: getCreativeRenderedDurationMs(document),
    scene_count: document.scenes.length,
    element_count: document.scenes.reduce((total, scene) => total + scene.elements.length, 0),
    canvas: {
      width: document.canvas.width,
      height: document.canvas.height,
      fps: document.canvas.fps,
    },
    scenes,
    audio: (document.audio ?? []).map((clip) => ({
      id: clip.id,
      kind: clip.kind,
      start_ms: clip.startMs,
      end_ms: clip.endMs,
    })),
    marker_count: document.markers?.length ?? 0,
    ...(typeof document.metadata?.scratchpad === "string" && document.metadata.scratchpad
      ? { scratchpad: document.metadata.scratchpad }
      : {}),
  };
}

/**
 * How much of a document a call should hand back — after a mutation, or on a
 * direct read of the project.
 *
 * `summary` is the default for a mutating call because the caller wrote the
 * change; `outline` is the inventory for a caller who does not yet know
 * which elements exist to ask for by id — scene list, element ids/types/
 * timings and group membership, without the keyframes and transforms that
 * make `document` expensive; `document` is there for the first call of a
 * session or after a restore, when the caller genuinely does not know the
 * state; `none` is for a long batch where even the summary is noise.
 *
 * `outline` is appended last rather than placed next to `summary` so the
 * comma-joined list this module's own error message builds from stays a
 * stable prefix as modes are added — see `parseCreativeReturnMode`.
 */
export const CREATIVE_RETURN_MODES = ["summary", "document", "none", "outline"] as const;
export type CreativeReturnMode = (typeof CREATIVE_RETURN_MODES)[number];

export function parseCreativeReturnMode(
  value: unknown,
  fallback: CreativeReturnMode = "summary",
): CreativeReturnMode {
  const expected = `return must be one of: ${CREATIVE_RETURN_MODES.join(", ")}`;
  if (value == null) return fallback;
  if (typeof value !== "string") throw new Error(expected);
  const mode = value.trim();
  if (!(CREATIVE_RETURN_MODES as readonly string[]).includes(mode)) {
    throw new Error(expected);
  }
  return mode as CreativeReturnMode;
}

/**
 * The document-shaped half of a reply, under the chosen mode. Spread into the
 * response so identity fields (project id, revision) are always present and
 * only the bulky part is governed by `return`.
 */
export function creativeDocumentPayload(
  document: CreativeDocument,
  mode: CreativeReturnMode,
):
  | { document: CreativeDocument }
  | { summary: CreativeDocumentSummary }
  | { outline: CreativeDocumentOutline }
  | Record<string, never> {
  if (mode === "document") return { document };
  if (mode === "none") return {};
  if (mode === "outline") return { outline: outlineCreativeDocument(document) };
  return { summary: summarizeCreativeDocument(document) };
}