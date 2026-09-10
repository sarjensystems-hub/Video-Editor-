/**
 * Variable-speed playback.
 *
 * A constant `playbackRate` maps timeline to source with a multiplication.
 * A ramp cannot: when speed varies, the source position is the *integral* of
 * speed over elapsed timeline time. Getting that wrong makes a ramped clip
 * drift out of sync with everything cut against it, so the integration lives
 * here as one pure function that preview and final render both call.
 *
 * Speed is interpolated linearly between keyframes, which makes each segment
 * a trapezoid in the speed/time plane — the area is exact arithmetic, not a
 * numerical approximation.
 */
import type { CreativeSpeedRamp, CreativeVideoElement } from "./schema";

/** Speed at `localMs`, held flat outside the keyframe range. */
export function speedAt(ramp: CreativeSpeedRamp, localMs: number): number {
  const frames = ramp.keyframes;
  if (frames.length === 0) return 1;
  if (localMs <= frames[0].atMs) return frames[0].speed;
  const last = frames[frames.length - 1];
  if (localMs >= last.atMs) return last.speed;

  for (let i = 0; i < frames.length - 1; i += 1) {
    const from = frames[i];
    const to = frames[i + 1];
    if (localMs > to.atMs) continue;
    const span = to.atMs - from.atMs;
    if (span <= 0) return to.speed;
    const progress = (localMs - from.atMs) / span;
    return from.speed + (to.speed - from.speed) * progress;
  }
  return last.speed;
}

/**
 * Source milliseconds consumed between the start of the clip window and
 * `localMs` — the integral of the speed curve.
 *
 * Each segment between two keyframes is a trapezoid: average speed times
 * duration. Before the first keyframe and after the last, speed is flat, so
 * those regions are rectangles.
 */
export function sourceOffsetAt(ramp: CreativeSpeedRamp, localMs: number): number {
  if (localMs <= 0) return 0;
  const frames = ramp.keyframes;
  if (frames.length === 0) return localMs;

  let consumed = 0;

  // Flat run before the first keyframe.
  const head = Math.min(localMs, frames[0].atMs);
  if (head > 0) consumed += head * frames[0].speed;
  if (localMs <= frames[0].atMs) return consumed;

  for (let i = 0; i < frames.length - 1; i += 1) {
    const from = frames[i];
    const to = frames[i + 1];
    if (localMs <= from.atMs) break;
    const segmentEnd = Math.min(localMs, to.atMs);
    const span = segmentEnd - from.atMs;
    if (span <= 0) continue;
    // Trapezoid: average of the speed at both ends of the covered span.
    const endSpeed = speedAt(ramp, segmentEnd);
    consumed += ((from.speed + endSpeed) / 2) * span;
    if (localMs <= to.atMs) return consumed;
  }

  // Flat run after the last keyframe.
  const last = frames[frames.length - 1];
  if (localMs > last.atMs) consumed += (localMs - last.atMs) * last.speed;
  return consumed;
}

/**
 * The source millisecond a clip should display at `localMs`, honouring a
 * ramp when present and falling back to constant-rate playback otherwise.
 *
 * This is the single mapping every renderer must use; a frozen clip ignores
 * it entirely and holds its stored frame.
 */
export function resolveClipSourceTimeMs(clip: CreativeVideoElement, localMs: number): number {
  if (clip.freezeAtSourceMs != null) return clip.freezeAtSourceMs;
  const offset = clip.speedRamp
    ? sourceOffsetAt(clip.speedRamp, localMs)
    : localMs * clip.playbackRate;
  return clip.sourceStartMs + offset;
}

/** Total source consumed across a whole window, for duration arithmetic. */
export function rampSourceLengthMs(ramp: CreativeSpeedRamp, windowMs: number): number {
  return sourceOffsetAt(ramp, windowMs);
}
