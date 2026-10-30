import { getCreativeDurationMs } from "./evaluate";
import type { CreativeDocument } from "./schema";

export type CreativeRenderQuality = "draft" | "final";

/**
 * How hard a final export is compressed. Measured by rendering the same 20
 * seconds of a real project (grainy, high-bitrate footage under motion
 * graphics) each way; sizes relative to "original", SSIM against it:
 *   original      - Remotion's default encode; the largest file.
 *   high_quality  - 28% of the size, SSIM 0.984: no visible difference.
 *   small         - 13% of the size, SSIM 0.980: faint grain is smoothed;
 *                   meant for chat apps where a tiny file matters most.
 * All three are ordinary H.264 MP4s at full resolution that play everywhere.
 * Drafts ignore it.
 */
export const CREATIVE_RENDER_FILE_SIZES = ["original", "high_quality", "small"] as const;
export type CreativeRenderFileSize = (typeof CREATIVE_RENDER_FILE_SIZES)[number];

export function isCreativeRenderFileSize(value: unknown): value is CreativeRenderFileSize {
  return typeof value === "string" && (CREATIVE_RENDER_FILE_SIZES as readonly string[]).includes(value);
}

const FILE_SIZE_ENCODING: Record<CreativeRenderFileSize, { crf?: number; x264Preset?: "slow" }> = {
  original: {},
  high_quality: { crf: 23, x264Preset: "slow" },
  small: { crf: 26, x264Preset: "slow" },
};

export interface CreativeRenderWindowOptions {
  startMs?: number;
  endMs?: number;
  quality?: CreativeRenderQuality;
  /** Final renders only; "original" when left out. */
  fileSize?: CreativeRenderFileSize;
}

export interface ResolvedCreativeRenderOptions {
  startMs: number;
  endMs: number;
  durationMs: number;
  frameRange?: [number, number];
  scale: number;
  crf?: number;
  x264Preset?: "slow";
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
  const encoding = quality === "draft" ? { crf: 28 } : FILE_SIZE_ENCODING[options.fileSize ?? "original"];
  return {
    startMs,
    endMs,
    durationMs: endMs - startMs,
    ...(isFull ? {} : { frameRange: [firstFrame, lastFrame] as [number, number] }),
    scale: quality === "draft" ? 0.5 : 1,
    ...encoding,
    jpegQuality: quality === "draft" ? 65 : 80,
  };
}
