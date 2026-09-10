import type { CreativeVideoElement } from "./schema";
import { resolveClipSourceTimeMs } from "./speed-ramp";

export type VideoPlaybackPlan =
  | {
      mode: "continuous";
      trimBefore: number;
      trimAfter?: number;
      playbackRate: number;
    }
  | {
      mode: "exact-frame";
      sourceFrame: number;
      trimBefore: number;
      trimAfter: number;
      /** Freeze the trimmed one-frame child at its own frame zero. */
      freezeFrame: 0;
    };

/**
 * Resolve the source millisecond visible at a clip-local timeline time.
 * Shared by the browser preview and Remotion renderer so freeze/ramp edits do
 * not have separate timing implementations that can drift apart.
 */
export function resolveVideoSourceTimeMs(element: CreativeVideoElement, localMs: number): number {
  if (element.freezeAtSourceMs != null) return element.freezeAtSourceMs;
  if (element.speedRamp) return resolveClipSourceTimeMs(element, localMs);
  return element.sourceStartMs + Math.max(0, localMs) * element.playbackRate;
}

/**
 * Translate the same source-time decision into Remotion's frame vocabulary.
 *
 * Freeze, speed-ramp and rate-changed visuals are exact-frame seeks. The
 * crucial invariant is that the absolute source frame is expressed as the
 * trim, while Freeze is always frame 0 of that already-trimmed one-frame
 * child. Freezing the child at the absolute source frame would add the trim
 * twice and can seek past EOF, which renders black.
 */
export function resolveVideoPlaybackPlan(
  element: CreativeVideoElement,
  localMs: number,
  fps: number,
): VideoPlaybackPlan {
  const toFrame = (ms: number) => Math.max(0, Math.round((ms / 1000) * fps));

  // A rate other than 1 joins freeze and ramp on the seeking path. Handing
  // `playbackRate` to the player instead looks right and is not: the source
  // advances 1:1 with the timeline regardless, so `trimAfter` truncates and a
  // slowed clip runs out of footage partway through its scene and renders
  // black. `resolveVideoSourceTimeMs` already knew the right source time —
  // only this function was not asking it.
  //
  // The cost is real and worth stating: seeking renders a one-frame trimmed
  // child per output frame, which is noticeably slower than continuous
  // playback across a whole clip. Correctness is worth it, and it is why rate
  // 1 stays on the continuous path rather than everything being seeked for
  // uniformity.
  if (element.freezeAtSourceMs != null || element.speedRamp || element.playbackRate !== 1) {
    const sourceFrame = toFrame(resolveVideoSourceTimeMs(element, localMs));
    return {
      mode: "exact-frame",
      sourceFrame,
      trimBefore: sourceFrame,
      trimAfter: sourceFrame + 1,
      freezeFrame: 0,
    };
  }

  const trimBefore = toFrame(element.sourceStartMs);
  const trimAfter = element.sourceEndMs == null
    ? undefined
    : Math.max(trimBefore + 1, toFrame(element.sourceEndMs));
  // Rate is 1 here by the branch above; the field stays so the plan is a
  // complete description of what the player is being asked to do.
  return { mode: "continuous", trimBefore, trimAfter, playbackRate: 1 };
}
