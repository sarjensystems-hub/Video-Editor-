/**
 * Audio timeline resolution.
 *
 * Pure module. Given the document's audio clips and a time on the rendered
 * timeline, it decides which clips are audible and at what gain — fades and
 * ducking included. The renderer only applies the number this returns, so the
 * mix is identical in preview and in the final render.
 *
 * Ducking is derived rather than stored: a music bed marked `duckUnderVoice`
 * drops whenever a voiceover clip is actually playing. Storing a ducked gain
 * would go stale the moment the voiceover moved; deriving it cannot.
 */
import type { CreativeAudioClip, CreativeDocument } from "./schema";

const DEFAULT_DUCK_GAIN = 0.3;

/** The document's audio clips, or an empty list for a pre-audio document. */
export function getCreativeAudioClips(document: CreativeDocument): CreativeAudioClip[] {
  return document.audio ?? [];
}

/**
 * Clips audible at `timeMs`, in document order.
 *
 * The end of a window is exclusive so two clips that meet exactly never both
 * sound on the boundary frame.
 */
export function audioClipsAtTime(clips: CreativeAudioClip[], timeMs: number): CreativeAudioClip[] {
  return clips.filter((clip) => !clip.muted && timeMs >= clip.startMs && timeMs < clip.endMs);
}

/**
 * Base gain before fades and ducking: the automation curve if the clip has
 * one, otherwise the scalar. Automation is held flat outside its range so a
 * curve never silences the clip by accident.
 */
export function baseGain(clip: CreativeAudioClip, timeMs: number): number {
  const points = clip.gainKeyframes;
  if (!points || points.length === 0) return clip.gain;
  if (points.length === 1) return points[0].gain;
  if (timeMs <= points[0].timeMs) return points[0].gain;
  const last = points[points.length - 1];
  if (timeMs >= last.timeMs) return last.gain;

  for (let i = 0; i < points.length - 1; i += 1) {
    const from = points[i];
    const to = points[i + 1];
    if (timeMs > to.timeMs) continue;
    const span = to.timeMs - from.timeMs;
    if (span <= 0) return to.gain;
    return from.gain + (to.gain - from.gain) * ((timeMs - from.timeMs) / span);
  }
  return last.gain;
}

function fadeMultiplier(clip: CreativeAudioClip, timeMs: number): number {
  let multiplier = 1;

  const fadeInMs = clip.fadeInMs ?? 0;
  if (fadeInMs > 0) {
    const elapsed = timeMs - clip.startMs;
    if (elapsed < fadeInMs) multiplier *= Math.max(0, elapsed / fadeInMs);
  }

  const fadeOutMs = clip.fadeOutMs ?? 0;
  if (fadeOutMs > 0) {
    const remaining = clip.endMs - timeMs;
    if (remaining < fadeOutMs) multiplier *= Math.max(0, remaining / fadeOutMs);
  }

  return multiplier;
}

/** Whether any voiceover other than `clip` is sounding at `timeMs`. */
function voiceIsPlaying(clip: CreativeAudioClip, all: CreativeAudioClip[], timeMs: number): boolean {
  return all.some(
    (other) =>
      other.id !== clip.id &&
      other.kind === "voiceover" &&
      !other.muted &&
      timeMs >= other.startMs &&
      timeMs < other.endMs,
  );
}

/**
 * Gain for one clip at one moment, with fades and ducking applied.
 * Returns 0 outside the clip window or when muted.
 */
export function resolveAudioClipGain(
  clip: CreativeAudioClip,
  allClips: CreativeAudioClip[],
  timeMs: number,
): number {
  if (clip.muted) return 0;
  if (timeMs < clip.startMs || timeMs >= clip.endMs) return 0;

  let gain = baseGain(clip, timeMs) * fadeMultiplier(clip, timeMs);
  if (clip.duckUnderVoice && voiceIsPlaying(clip, allClips, timeMs)) {
    gain *= clip.duckToGain ?? DEFAULT_DUCK_GAIN;
  }
  return Math.max(0, gain);
}
