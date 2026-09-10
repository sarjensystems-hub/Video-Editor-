import { baseGain } from "./audio-timeline";
import { getCreativeSceneTimeline } from "./remotion";
import type { CreativeAudioClip, CreativeDocument, CreativeMarker } from "./schema";

/**
 * Extracting one scene as a standalone film.
 *
 * A scene is not a slice of the rendered timeline that can simply be cropped:
 * it carries a transition into the scene after it, and the document's audio
 * runs underneath every scene at once. Exporting scene three by cropping would
 * hand you a clip that cuts to nothing and opens on whatever the music happened
 * to be doing three scenes in.
 *
 * Everything here is pure so the same extraction feeds the web export, the MCP
 * tool, and its own tests.
 */

export interface SceneExportWindow {
  sceneId: string;
  sceneIndex: number;
  /** Where the scene begins on the full film's rendered timeline. */
  startMs: number;
  endMs: number;
  durationMs: number;
}

export function findSceneExportWindow(
  document: CreativeDocument,
  sceneId: string,
): SceneExportWindow | null {
  const entry = getCreativeSceneTimeline(document).find((item) => item.sceneId === sceneId);
  if (!entry) return null;
  return {
    sceneId: entry.sceneId,
    sceneIndex: entry.sceneIndex,
    startMs: entry.startMs,
    endMs: entry.endMs,
    durationMs: entry.durationMs,
  };
}

/**
 * Re-bases one audio clip onto a window that now starts at zero.
 *
 * @returns null when the clip never sounds inside the window, so it is dropped
 * rather than exported as a silent zero-length clip the validator would reject.
 */
function rebaseAudioClip(
  clip: CreativeAudioClip,
  windowStartMs: number,
  windowEndMs: number,
): CreativeAudioClip | null {
  const startMs = Math.max(clip.startMs, windowStartMs);
  const endMs = Math.min(clip.endMs, windowEndMs);
  if (endMs <= startMs) return null;

  const headTrimmedMs = startMs - clip.startMs;
  const tailTrimmed = endMs < clip.endMs;
  const durationMs = endMs - startMs;

  const rebased: CreativeAudioClip = {
    ...clip,
    startMs: startMs - windowStartMs,
    endMs: endMs - windowStartMs,
    // Cutting the head off the window means the source has to start further in,
    // or the clip would replay audio the full film had already passed.
    sourceStartMs: clip.sourceStartMs + headTrimmedMs,
  };

  // A fade belongs to an edge of the authored clip. If that edge was cut away,
  // the fade already happened outside this window and must not play again.
  if (headTrimmedMs > 0) delete rebased.fadeInMs;
  else if (rebased.fadeInMs !== undefined) rebased.fadeInMs = Math.min(rebased.fadeInMs, durationMs);
  if (tailTrimmed) delete rebased.fadeOutMs;
  else if (rebased.fadeOutMs !== undefined) rebased.fadeOutMs = Math.min(rebased.fadeOutMs, durationMs);

  const points = clip.gainKeyframes;
  if (points && points.length > 0) {
    // Automation is held flat outside its keyframes, so the curve is preserved
    // by sampling it at both edges of the window and keeping what lies between.
    // Keyframe times must be integers and strictly increasing, which rules out
    // simply shifting the authored points into negative territory.
    const inside = points
      .filter((point) => point.timeMs > startMs && point.timeMs < endMs)
      .map((point) => ({ ...point, timeMs: point.timeMs - windowStartMs }));
    rebased.gainKeyframes = [
      { timeMs: startMs - windowStartMs, gain: baseGain(clip, startMs) },
      ...inside,
      { timeMs: endMs - windowStartMs, gain: baseGain(clip, endMs) },
    ];
  }

  return rebased;
}

function rebaseMarkers(
  markers: CreativeMarker[] | undefined,
  windowStartMs: number,
  windowEndMs: number,
): CreativeMarker[] | undefined {
  if (!markers) return undefined;
  const kept = markers
    .filter((marker) => marker.timeMs >= windowStartMs && marker.timeMs <= windowEndMs)
    .map((marker) => ({ ...marker, timeMs: marker.timeMs - windowStartMs }));
  return kept.length > 0 ? kept : undefined;
}

/**
 * Builds a one-scene document that renders exactly this clip, starting at zero.
 *
 * The scene's outgoing transition is dropped: it existed to hand over to the
 * scene that followed, and in a film of one there is nothing to hand over to.
 *
 * @throws when the scene is not part of the document, since rendering the wrong
 * clip silently is worse than failing the request.
 */
export function extractSceneDocument(document: CreativeDocument, sceneId: string): CreativeDocument {
  const window = findSceneExportWindow(document, sceneId);
  if (!window) throw new Error(`Scene ${sceneId} is not part of this project`);

  const scene = document.scenes[window.sceneIndex];
  const { transitionOut: _dropped, ...sceneWithoutTransition } = scene;

  const audio = (document.audio ?? [])
    .map((clip) => rebaseAudioClip(clip, window.startMs, window.endMs))
    .filter((clip): clip is CreativeAudioClip => clip !== null);

  const extracted: CreativeDocument = {
    ...document,
    title: `${document.title} — ${scene.name}`,
    scenes: [sceneWithoutTransition],
    markers: rebaseMarkers(document.markers, window.startMs, window.endMs),
  };

  // A continuation runs from one scene into the one immediately after it, and a
  // clip is a single scene - so none of them can survive the extraction. The
  // spread above carried the whole document's continuations into a one-scene
  // film, where every one of them named a scene that was no longer there. The
  // clip then failed its own validation and the export died before it started,
  // which is how a film that renders perfectly well had a broken scene export.
  delete extracted.continuations;
  delete extracted.groupContinuations;

  if (audio.length > 0) extracted.audio = audio;
  else delete extracted.audio;

  return extracted;
}
