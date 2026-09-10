import { getCreativeDurationMs } from "./evaluate";
import type { CreativeDocument } from "./schema";

export type CreativeRenderQuality = "draft" | "final";

export interface CreativeRenderWindowOptions {
  startMs?: number;
  endMs?: number;
  quality?: CreativeRenderQuality;
}

export interface ResolvedCreativeRenderOptions {
  startMs: number;
  endMs: number;
  durationMs: number;
  frameRange?: [number, number];
  scale: number;
  crf?: number;
  jpegQuality: number;
}

/**
 * Resolve render ergonomics once for the HTTP and MCP paths. The document is
 * never rewritten for a range render; Remotion renders the exact composition
 * frames requested, preserving overlaps, continuations and audio timing.
 */
export function resolveCreativeRenderOptions(
  document: CreativeDocument,
  options: CreativeRenderWindowOptions = {},
): ResolvedCreativeRenderOptions {
  const total = getCreativeDurationMs(document);
  const startMs = options.startMs ?? 0;
  const endMs = options.endMs ?? total;
  if (!Number.isFinite(startMs) || startMs < 0) throw new Error("start_ms must be a non-negative finite number");
  if (!Number.isFinite(endMs) || endMs <= startMs) throw new Error("end_ms must be greater than start_ms");
  if (endMs > total) throw new Error(`end_ms must not exceed the rendered duration of ${total}ms`);

  const fps = document.canvas.fps;
  const firstFrame = Math.floor((startMs * fps) / 1000);
  const lastFrame = Math.max(firstFrame, Math.ceil((endMs * fps) / 1000) - 1);
  const isFull = startMs === 0 && endMs === total;
  const quality = options.quality ?? "final";
  return {
    startMs,
    endMs,
    durationMs: endMs - startMs,
    ...(isFull ? {} : { frameRange: [firstFrame, lastFrame] as [number, number] }),
    scale: quality === "draft" ? 0.5 : 1,
    ...(quality === "draft" ? { crf: 28 } : {}),
    jpegQuality: quality === "draft" ? 65 : 80,
  };
}
