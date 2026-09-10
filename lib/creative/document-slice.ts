/**
 * Reading part of a project instead of all of it.
 *
 * `get_creative_project` returns the whole document, which by revision ten of a
 * real film is tens of kilobytes. An agent adjusting two scenes does not need
 * the other fifteen, and paying for them is the difference between four
 * iterations and ten for the same effort.
 *
 * This is deliberately *not* five new tools. The brief asked for `get_scene`,
 * `get_elements`, `get_element`, `get_design_system` and `get_audio_timeline` —
 * but the same brief also complained that the tool list is too heavy to reload
 * on every reconnect, and five more schemas would make that worse to fix this.
 * Filters on the read tool that already exists cost nothing to discover and
 * compose freely.
 *
 * A slice is honest about being one: it never pretends to be a whole
 * CreativeDocument, because a document missing fifteen of its scenes would fail
 * its own validator and anything that round-tripped it would destroy a film.
 */
import type {
  CreativeAudioClip,
  CreativeDesignSystem,
  CreativeDocument,
  CreativeGroupContinuation,
  CreativeMarker,
  CreativeScene,
} from "./schema";

export const CREATIVE_SLICE_INCLUDES = [
  "design_system",
  "audio",
  "markers",
  "continuations",
] as const;
export type CreativeSliceInclude = (typeof CREATIVE_SLICE_INCLUDES)[number];

export interface CreativeSliceRequest {
  sceneIds?: string[];
  elementIds?: string[];
  elementAliases?: string[];
  tags?: string[];
  include?: CreativeSliceInclude[];
}

export interface CreativeDocumentSlice {
  /** Always true, so a caller can never mistake this for a whole document. */
  partial: true;
  scenes: CreativeScene[];
  design_system?: CreativeDesignSystem;
  audio?: CreativeAudioClip[];
  markers?: CreativeMarker[];
  continuations?: CreativeDocument["continuations"];
  /**
   * Returned alongside `continuations` under the same include.
   *
   * They are one concept — a cross-scene handoff — split only by what they
   * target, so an author asking for the continuations wants both. Requiring a
   * second include meant a slice read silently omitted half of them while the
   * document plainly contained them, which reads as data loss rather than a
   * missing option.
   */
  group_continuations?: CreativeGroupContinuation[];
}

/** Whether a request actually narrows anything, or is just a plain read. */
export function isSliceRequested(request: CreativeSliceRequest): boolean {
  return Boolean(request.sceneIds?.length || request.elementIds?.length || request.elementAliases?.length || request.tags?.length || request.include?.length);
}

export function parseCreativeSliceRequest(input: Record<string, unknown>): CreativeSliceRequest {
  const stringList = (value: unknown, key: string): string[] | undefined => {
    if (value === undefined) return undefined;
    if (!Array.isArray(value) || value.length === 0) {
      throw new Error(`${key} must be a non-empty array of strings`);
    }
    return value.map((entry, index) => {
      if (typeof entry !== "string" || !entry.trim()) {
        throw new Error(`${key}[${index}] must be a non-empty string`);
      }
      return entry.trim();
    });
  };

  const include = stringList(input.include, "include") as CreativeSliceInclude[] | undefined;
  for (const entry of include ?? []) {
    if (!(CREATIVE_SLICE_INCLUDES as readonly string[]).includes(entry)) {
      throw new Error(`include must contain only: ${CREATIVE_SLICE_INCLUDES.join(", ")}`);
    }
  }

  return {
    sceneIds: stringList(input.scene_ids, "scene_ids"),
    elementIds: stringList(input.element_ids, "element_ids"),
    elementAliases: stringList(input.element_aliases, "element_aliases"),
    tags: stringList(input.tags, "tags"),
    include,
  };
}

/**
 * The requested part of a document.
 *
 * An id that matches nothing is an error rather than an empty result, for the
 * same reason a bulk-edit selector that matches nothing is: a typo returning
 * "no scenes" looks exactly like a project that lost its scenes, and the caller
 * goes looking in the wrong place.
 */
export function sliceCreativeDocument(
  document: CreativeDocument,
  request: CreativeSliceRequest,
): CreativeDocumentSlice {
  const sceneFilter = request.sceneIds?.length ? new Set(request.sceneIds) : null;
  if (sceneFilter) {
    const missing = [...sceneFilter].filter((id) => !document.scenes.some((scene) => scene.id === id));
    if (missing.length) throw new Error(`No scene with id ${missing[0]} in this project`);
  }

  const elementFilter = request.elementIds?.length ? new Set(request.elementIds) : null;
  if (elementFilter) {
    const known = new Set(document.scenes.flatMap((scene) => scene.elements.map((element) => element.id)));
    const missing = [...elementFilter].filter((id) => !known.has(id));
    if (missing.length) throw new Error(`No element with id ${missing[0]} in this project`);
  }
  const aliasFilter = request.elementAliases?.length ? new Set(request.elementAliases) : null;
  if (aliasFilter) {
    const known = new Set(document.scenes.flatMap((scene) => scene.elements.map((element) => element.alias).filter(Boolean) as string[]));
    const missing = [...aliasFilter].filter((alias) => !known.has(alias));
    if (missing.length) throw new Error(`No element with alias ${missing[0]} in this project`);
  }
  const tagFilter = request.tags?.length ? new Set(request.tags) : null;
  const hasElementQuery = Boolean(elementFilter || aliasFilter || tagFilter);

  const scenes = document.scenes
    .filter((scene) => !sceneFilter || sceneFilter.has(scene.id))
    .map((scene) =>
      hasElementQuery
        ? { ...scene, elements: scene.elements.filter((element) => {
            if (elementFilter && !elementFilter.has(element.id)) return false;
            if (aliasFilter && (!element.alias || !aliasFilter.has(element.alias))) return false;
            if (tagFilter && ![...tagFilter].every((tag) => element.tags?.includes(tag))) return false;
            return true;
          }) }
        : scene,
    )
    // A scene left with no elements after an element filter was not what was
    // asked for; dropping it keeps the reply about the elements requested.
    .filter((scene) => !hasElementQuery || scene.elements.length > 0);

  const include = new Set(request.include ?? []);
  const slice: CreativeDocumentSlice = { partial: true, scenes };
  if (include.has("design_system")) slice.design_system = document.designSystem;
  if (include.has("audio")) slice.audio = document.audio ?? [];
  if (include.has("markers")) slice.markers = document.markers ?? [];
  if (include.has("continuations")) {
    slice.continuations = document.continuations ?? [];
    slice.group_continuations = document.groupContinuations ?? [];
  }
  return slice;
}
