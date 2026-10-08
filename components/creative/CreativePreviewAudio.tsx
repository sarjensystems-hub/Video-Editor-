"use client";

import { useEffect, useRef } from "react";
import type { CreativeAudioClip, CreativeDocument } from "@/lib/creative/schema";

/** How far a playing clip may drift from the timeline before it is re-seated. */
const DRIFT_TOLERANCE_S = 0.25;

/**
 * The gain a clip should have at film time `t`: its scalar gain (or gain
 * automation), its fades, and the music duck while any voiceover sounds - the
 * same three things the render mixes, approximated closely enough to judge a
 * cut by ear. Browsers cap element volume at 1, so gain above unity plays at 1.
 */
export function previewClipVolume(clip: CreativeAudioClip, allClips: CreativeAudioClip[], t: number): number {
  if (clip.muted || t < clip.startMs || t >= clip.endMs) return 0;
  let gain = clip.gain;
  const keys = clip.gainKeyframes;
  if (keys && keys.length) {
    const sorted = [...keys].sort((a, b) => a.timeMs - b.timeMs);
    if (t <= sorted[0].timeMs) gain = sorted[0].gain;
    else if (t >= sorted[sorted.length - 1].timeMs) gain = sorted[sorted.length - 1].gain;
    else {
      const next = sorted.findIndex((key) => key.timeMs > t);
      const a = sorted[next - 1];
      const b = sorted[next];
      gain = a.gain + ((b.gain - a.gain) * (t - a.timeMs)) / Math.max(1, b.timeMs - a.timeMs);
    }
  }
  if (clip.fadeInMs && t < clip.startMs + clip.fadeInMs) gain *= (t - clip.startMs) / clip.fadeInMs;
  if (clip.fadeOutMs && t > clip.endMs - clip.fadeOutMs) gain *= (clip.endMs - t) / clip.fadeOutMs;
  if (clip.kind === "music" && clip.duckUnderVoice) {
    const voiced = allClips.some((other) => other.kind === "voiceover" && !other.muted && t >= other.startMs && t < other.endMs);
    if (voiced) gain *= clip.duckToGain ?? 0.25;
  }
  return Math.max(0, Math.min(1, gain));
}

/**
 * Plays the film's audio clips in the editor preview, following the film
 * clock rather than running free, so scrubbing and scene changes stay in
 * sync. Nothing is drawn; each clip is a detached audio element.
 */
export default function CreativePreviewAudio({
  document,
  assetUrls,
  filmTimeMs,
  playing,
}: {
  document: CreativeDocument;
  assetUrls: Record<string, string>;
  filmTimeMs: number;
  playing: boolean;
}) {
  const elements = useRef(new Map<string, HTMLAudioElement>());
  const clips = document.audio ?? [];

  // One element per clip, created on demand and dropped with its clip.
  useEffect(() => {
    const live = new Set(clips.map((clip) => clip.id));
    for (const [id, element] of elements.current) {
      if (!live.has(id)) {
        element.pause();
        element.removeAttribute("src");
        elements.current.delete(id);
      }
    }
  }, [clips]);

  useEffect(
    () => () => {
      for (const element of elements.current.values()) element.pause();
      elements.current.clear();
    },
    [],
  );

  useEffect(() => {
    for (const clip of clips) {
      const url = assetUrls[clip.assetId];
      if (!url) continue;
      let element = elements.current.get(clip.id);
      if (!element) {
        element = new Audio();
        element.preload = "auto";
        element.src = url;
        elements.current.set(clip.id, element);
      } else if (element.src !== url) {
        element.src = url;
      }
      const inside = filmTimeMs >= clip.startMs && filmTimeMs < clip.endMs;
      const target = (clip.sourceStartMs + (filmTimeMs - clip.startMs)) / 1000;
      element.volume = previewClipVolume(clip, clips, filmTimeMs);
      if (playing && inside) {
        if (Math.abs(element.currentTime - target) > DRIFT_TOLERANCE_S) element.currentTime = Math.max(0, target);
        if (element.paused) void element.play().catch(() => undefined);
      } else {
        if (!element.paused) element.pause();
        if (inside && Math.abs(element.currentTime - target) > 0.05) element.currentTime = Math.max(0, target);
      }
    }
  }, [clips, assetUrls, filmTimeMs, playing]);

  return null;
}
