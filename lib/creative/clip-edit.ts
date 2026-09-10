/**
 * Deterministic clip editing math.
 *
 * Pure module: every operation an AI editor performs on a video clip —
 * split, trim, slip, retime, freeze, duplicate — is expressed here as a
 * function from one clip to another, with no storage, renderer or Supabase
 * dependency. The timeline arithmetic that decides which source frames land
 * where is therefore unit-testable in isolation, which is the only way a
 * split can be trusted not to lose or duplicate a frame.
 *
 * Two coordinate systems meet in this file:
 *
 * - *timeline* milliseconds, local to the scene, which is where a clip's
 *   `timing` window lives;
 * - *source* milliseconds, inside the asset, which is where
 *   `sourceStartMs`/`sourceEndMs` live.
 *
 * They are related by the clip's `playbackRate`: one millisecond of timeline
 * consumes `playbackRate` milliseconds of source. Every conversion below goes
 * through `sourceOffsetFor` so that relationship is stated exactly once.
 *
 * Invalid edits throw rather than clamp. An editor that silently rounds a bad
 * split into a neighbouring frame produces footage nobody asked for.
 */
import type { CreativeVideoElement, ElementTiming } from "./schema";

export interface ClipWindow {
  startMs: number;
  endMs: number;
}

export type ClipSpeedMode = "hold_source" | "hold_duration";

function assertFinite(value: number, label: string): number {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    throw new Error(`${label} must be a finite number of milliseconds`);
  }
  return value;
}

/** The clip's visible window on the scene timeline. */
export function videoClipWindow(clip: CreativeVideoElement, sceneDurationMs: number): ClipWindow {
  return clip.timing
    ? { startMs: clip.timing.startMs, endMs: clip.timing.endMs }
    : { startMs: 0, endMs: sceneDurationMs };
}

/** Source milliseconds consumed by `timelineMs` of playback at this clip's rate. */
function sourceOffsetFor(clip: CreativeVideoElement, timelineMs: number): number {
  return timelineMs * clip.playbackRate;
}

/** Total source milliseconds the clip consumes across its visible window. */
export function videoClipSourceLengthMs(clip: CreativeVideoElement, sceneDurationMs: number): number {
  const window = videoClipWindow(clip, sceneDurationMs);
  return sourceOffsetFor(clip, window.endMs - window.startMs);
}

function withTiming(clip: CreativeVideoElement, timing: ElementTiming): CreativeVideoElement {
  return { ...clip, timing: { ...timing } };
}

/** Structural copy so an edited clip never aliases the one it came from. */
function cloneClip(clip: CreativeVideoElement): CreativeVideoElement {
  return JSON.parse(JSON.stringify(clip)) as CreativeVideoElement;
}

/**
 * Splits a clip at a scene-local millisecond.
 *
 * The cut point is shared exactly: the left half's `sourceEndMs` equals the
 * right half's `sourceStartMs`, and their timeline windows meet at `atMs`, so
 * the pair consumes precisely the source the original did.
 */
export function splitVideoClip(
  clip: CreativeVideoElement,
  sceneDurationMs: number,
  atMs: number,
): { left: CreativeVideoElement; right: CreativeVideoElement } {
  assertFinite(atMs, "at_ms");
  const window = videoClipWindow(clip, sceneDurationMs);
  if (atMs <= window.startMs || atMs >= window.endMs) {
    throw new Error(
      `at_ms must be strictly inside the clip window ${window.startMs}..${window.endMs}`,
    );
  }

  const cutSourceMs = clip.sourceStartMs + sourceOffsetFor(clip, atMs - window.startMs);
  const left = withTiming(
    { ...cloneClip(clip), sourceEndMs: cutSourceMs },
    { startMs: window.startMs, endMs: atMs },
  );
  const right = withTiming(
    { ...cloneClip(clip), id: `${clip.id}-${crypto.randomUUID().slice(0, 8)}`, sourceStartMs: cutSourceMs },
    { startMs: atMs, endMs: window.endMs },
  );
  return { left, right };
}

/**
 * Moves the clip's in and/or out point on the timeline, carrying the source
 * window with it so the frames that survive the trim stay on the same
 * timeline positions they already occupied.
 */
export function trimVideoClip(
  clip: CreativeVideoElement,
  sceneDurationMs: number,
  edges: { startMs?: number; endMs?: number },
): CreativeVideoElement {
  if (edges.startMs === undefined && edges.endMs === undefined) {
    throw new Error("trim requires start_ms or end_ms");
  }
  const window = videoClipWindow(clip, sceneDurationMs);
  const startMs = edges.startMs === undefined ? window.startMs : assertFinite(edges.startMs, "start_ms");
  const endMs = edges.endMs === undefined ? window.endMs : assertFinite(edges.endMs, "end_ms");
  if (endMs - startMs <= 0) throw new Error("trim must leave a positive clip duration");

  const headMs = sourceOffsetFor(clip, startMs - window.startMs);
  const tailMs = sourceOffsetFor(clip, window.endMs - endMs);
  const next = cloneClip(clip);
  next.sourceStartMs = clip.sourceStartMs + headMs;
  if (clip.sourceEndMs !== undefined) next.sourceEndMs = clip.sourceEndMs - tailMs;
  if (next.sourceStartMs < 0) throw new Error("trim would move the source window before the start of the asset");
  return withTiming(next, { startMs, endMs });
}

/**
 * Shifts which part of the source plays without moving the clip on the
 * timeline — the classic slip edit. The window length is preserved exactly.
 */
export function slipVideoClip(
  clip: CreativeVideoElement,
  sceneDurationMs: number,
  byMs: number,
): CreativeVideoElement {
  assertFinite(byMs, "by_ms");
  const window = videoClipWindow(clip, sceneDurationMs);
  const shift = sourceOffsetFor(clip, byMs);
  const sourceStartMs = clip.sourceStartMs + shift;
  if (sourceStartMs < 0) throw new Error("slip would move the source window before the start of the asset");

  const next = cloneClip(clip);
  next.sourceStartMs = sourceStartMs;
  if (clip.sourceEndMs !== undefined) next.sourceEndMs = clip.sourceEndMs + shift;
  return withTiming(next, window);
}

/**
 * Retimes the clip.
 *
 * `hold_source` keeps every frame and changes how much timeline they occupy —
 * the slow-motion/fast-motion case. `hold_duration` keeps the timeline slot
 * and changes which frames fill it, which is what you want when a clip has to
 * land on a fixed beat.
 */
export function setVideoClipSpeed(
  clip: CreativeVideoElement,
  sceneDurationMs: number,
  speed: number,
  mode: ClipSpeedMode,
): CreativeVideoElement {
  assertFinite(speed, "speed");
  if (speed <= 0) throw new Error("speed must be positive");

  const window = videoClipWindow(clip, sceneDurationMs);
  const next = cloneClip(clip);
  next.playbackRate = speed;

  if (mode === "hold_duration") {
    if (clip.sourceEndMs !== undefined) {
      next.sourceEndMs = clip.sourceStartMs + (window.endMs - window.startMs) * speed;
    }
    return withTiming(next, window);
  }

  const sourceLengthMs =
    clip.sourceEndMs === undefined
      ? videoClipSourceLengthMs(clip, sceneDurationMs)
      : clip.sourceEndMs - clip.sourceStartMs;
  const durationMs = sourceLengthMs / speed;
  if (durationMs <= 0) throw new Error("speed must leave a positive clip duration");
  return withTiming(next, { startMs: window.startMs, endMs: window.startMs + durationMs });
}

/**
 * Converts the clip into a held frame. The freeze point is resolved to an
 * exact source millisecond so the renderer holds the same frame in preview
 * and in the final render.
 */
export function freezeVideoClip(
  clip: CreativeVideoElement,
  sceneDurationMs: number,
  atMs: number,
): CreativeVideoElement {
  assertFinite(atMs, "at_ms");
  const window = videoClipWindow(clip, sceneDurationMs);
  if (atMs < window.startMs || atMs >= window.endMs) {
    throw new Error(`at_ms must be inside the clip window ${window.startMs}..${window.endMs}`);
  }
  const next = cloneClip(clip);
  next.freezeAtSourceMs = clip.sourceStartMs + sourceOffsetFor(clip, atMs - window.startMs);
  return withTiming(next, window);
}

/** Copies the clip into another timeline slot with a fresh id. */
export function duplicateVideoClip(
  clip: CreativeVideoElement,
  sceneDurationMs: number,
  atMs: number,
): CreativeVideoElement {
  assertFinite(atMs, "at_ms");
  const window = videoClipWindow(clip, sceneDurationMs);
  const durationMs = window.endMs - window.startMs;
  const next = cloneClip(clip);
  next.id = `${clip.id}-${crypto.randomUUID().slice(0, 8)}`;
  return withTiming(next, { startMs: atMs, endMs: atMs + durationMs });
}
