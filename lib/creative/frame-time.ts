/**
 * Exact CreativeDocument time → Remotion frame resolution.
 *
 * Pure module on purpose: it imports nothing from storage, Supabase, the
 * renderer or any server-only alias, so the conversion that decides which
 * frame ChatGPT actually sees is unit-testable in isolation and identical
 * between preview and final render.
 *
 * The rendered timeline is overlap-aware — a scene's outgoing transition
 * overlaps the next scene — so the addressable range comes from
 * `getCreativeDurationMs`, the same helper the Remotion composition
 * metadata uses.
 *
 * Invalid input is rejected, never clamped: clamping a caller's mistake
 * into a neighbouring frame hides the mistake and makes visual critique
 * reason about the wrong moment.
 */
import { getCreativeDurationMs } from "./evaluate";
import type { CreativeDocument } from "./schema";

export interface ResolvedCreativeFrame {
  /** Zero-based Remotion frame index for `timeMs`. */
  frame: number;
  /** The exact requested millisecond, echoed back unchanged. */
  timeMs: number;
  /** Total rendered length of the document in milliseconds. */
  renderedDurationMs: number;
  /** Frame rate the frame index was resolved against. */
  fps: number;
}

/** Rendered (overlap-aware) length of the document in milliseconds. */
export function getCreativeRenderedDurationMs(document: CreativeDocument): number {
  return getCreativeDurationMs(document);
}

export function resolveCreativeFrameAtTime(
  document: CreativeDocument,
  timeMs: number,
): ResolvedCreativeFrame {
  if (typeof timeMs !== "number" || !Number.isFinite(timeMs)) {
    throw new Error("time_ms must be a finite number of milliseconds");
  }
  if (timeMs < 0) {
    throw new Error("time_ms must be greater than or equal to zero");
  }

  const fps = document.canvas.fps;
  if (!Number.isFinite(fps) || fps <= 0) {
    throw new Error("CreativeDocument canvas fps is invalid");
  }

  const renderedDurationMs = getCreativeRenderedDurationMs(document);
  if (timeMs >= renderedDurationMs) {
    throw new Error(
      `time_ms must be less than the rendered duration of ${renderedDurationMs}ms`,
    );
  }

  return {
    frame: Math.floor((timeMs * fps) / 1000),
    timeMs,
    renderedDurationMs,
    fps,
  };
}
