import * as base from "./audio-analysis-base";

export * from "./audio-analysis-base";

export interface SuggestedEditPoint {
  timeMs: number;
  strength: number;
  confidence: number;
}

/**
 * Converts detected audio onsets into deterministic, timeline-ready edit
 * suggestions. The engine suggests; the caller still decides whether to cut,
 * place a marker, or ignore the point.
 */
export function suggestEditPoints(
  peaks: number[],
  peakWindowMs: number,
  options: { limit?: number; minGapMs?: number } = {},
): SuggestedEditPoint[] {
  const limit = Math.max(1, Math.min(64, Math.round(options.limit ?? 16)));
  const minGapMs = Math.max(0, Math.round(options.minGapMs ?? 240));
  const times = base.detectTransients(peaks, peakWindowMs, { limit: limit * 3, minGapMs });
  const points = times.map((timeMs) => {
    const index = Math.max(1, Math.min(peaks.length - 1, Math.round(timeMs / Math.max(1, peakWindowMs))));
    const previous = peaks[index - 1] ?? 0;
    const current = peaks[index] ?? 0;
    const rise = Math.max(0, current - previous);
    const strength = Math.min(1, rise);
    const confidence = Math.min(1, 0.45 + strength * 0.55);
    return { timeMs, strength, confidence };
  });
  return points.sort((a, b) => a.timeMs - b.timeMs).slice(0, limit);
}

/**
 * Reads only container duration. Unlike waveform analysis this works for
 * compressed generated formats such as MP3 because no packet is reinterpreted
 * as PCM.
 */
export async function probeAudioDurationMs(url: string): Promise<number> {
  if (!/^https:\/\//i.test(url)) throw new Error("Audio URL must use HTTPS");
  const { parseMedia } = await import("@remotion/media-parser");
  const result = await parseMedia({
    src: url,
    acknowledgeRemotionLicense: true,
    fields: { durationInSeconds: true },
  });
  const durationMs = Math.round((result.durationInSeconds ?? 0) * 1000);
  if (!Number.isFinite(durationMs) || durationMs <= 0) {
    throw new Error("Generated audio duration could not be measured");
  }
  return durationMs;
}
