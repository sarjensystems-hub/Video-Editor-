/**
 * Does every video clip have footage behind it for its whole visible window?
 *
 * A clip that asks for source past the end of its asset does not fail — it
 * renders black, silently, from the moment it runs out. That reads as a
 * content mistake rather than an engine fault, so it costs a full render pass
 * to find and another to explain. The asset record already carries
 * `duration_ms`; nothing was comparing it to what the clip would ask for.
 *
 * The question is answered with `resolveVideoSourceTimeMs`, the same function
 * the renderer and the preview use, so a clip this module passes is a clip
 * that has footage — not an approximation of one.
 */
import type { CreativeDocument, CreativeVideoElement } from "./schema";
import { resolveVideoSourceTimeMs } from "./video-playback";

export interface ClipCoverageWarning {
  code: "clip_source_overrun" | "clip_source_missing_asset";
  sceneId: string;
  elementId: string;
  assetId: string;
  message: string;
  /** The furthest source millisecond the clip will ask for. */
  requiredSourceMs?: number;
  /** What the asset actually holds, when known. */
  assetDurationMs?: number;
}

/** How long the clip is on screen, which is what it must find footage for. */
export function clipVisibleDurationMs(
  element: CreativeVideoElement,
  sceneDurationMs: number,
): number {
  const start = element.timing?.startMs ?? 0;
  const end = element.timing?.endMs ?? sceneDurationMs;
  return Math.max(0, end - start);
}

/**
 * The furthest source position the clip reaches over its visible window.
 *
 * A speed ramp can be non-monotonic in rate but never in position — source
 * time only moves forward — so the last moment is the furthest. A freeze sits
 * at one position for the whole window.
 */
export function requiredSourceMs(
  element: CreativeVideoElement,
  sceneDurationMs: number,
): number {
  const visibleMs = clipVisibleDurationMs(element, sceneDurationMs);
  const atEnd = resolveVideoSourceTimeMs(element, visibleMs);
  // An explicit out point is a promise about the source too: the continuous
  // path trims there, so a window past the asset is an overrun even if the
  // clip is short enough never to reach it.
  return Math.max(atEnd, element.sourceEndMs ?? 0);
}

/**
 * Video clips whose source window runs past the footage behind them.
 *
 * `assetDurationsMs` maps asset id to duration. An asset missing from the map
 * is reported separately rather than assumed fine — a clip pointing at
 * something unregistered cannot render either.
 */
export function inspectClipCoverage(
  document: CreativeDocument,
  assetDurationsMs: Map<string, number | null | undefined>,
): ClipCoverageWarning[] {
  const warnings: ClipCoverageWarning[] = [];

  for (const scene of document.scenes) {
    for (const element of scene.elements) {
      if (element.type !== "video") continue;
      const clip = element as CreativeVideoElement;

      if (!assetDurationsMs.has(clip.assetId)) {
        warnings.push({
          code: "clip_source_missing_asset",
          sceneId: scene.id,
          elementId: clip.id,
          assetId: clip.assetId,
          message: `Clip "${clip.id}" points at asset ${clip.assetId}, which is not registered on this project.`,
        });
        continue;
      }

      const assetDurationMs = assetDurationsMs.get(clip.assetId);
      // A registered asset whose duration was never measured cannot be
      // checked. Staying quiet is right: a warning nobody can act on trains
      // people to stop reading warnings.
      if (assetDurationMs == null || !Number.isFinite(assetDurationMs)) continue;

      const required = requiredSourceMs(clip, scene.durationMs);
      // A frame lands on the nearest source frame, so asking for the final
      // instant is not an overrun. One frame at 30fps is the tolerance.
      if (required <= assetDurationMs + 34) continue;

      warnings.push({
        code: "clip_source_overrun",
        sceneId: scene.id,
        elementId: clip.id,
        assetId: clip.assetId,
        requiredSourceMs: Math.round(required),
        assetDurationMs,
        message:
          `Clip "${clip.id}" needs source up to ${Math.round(required)}ms but its asset is ` +
          `${assetDurationMs}ms long. It will render black past the end of the footage.`,
      });
    }
  }

  return warnings;
}
