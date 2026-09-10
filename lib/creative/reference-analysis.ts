import sharp from "sharp";

export interface ReferenceFrameMeasurement {
  time_ms: number;
  width: number;
  height: number;
  mean_rgb: { r: number; g: number; b: number };
  mean_luminance: number;
  luminance_contrast: number;
  edge_density: number;
  composition_center: { x: number; y: number };
  palette: string[];
  /** Small normalized luminance raster used only for deterministic frame change. */
  signature: number[];
}

export interface ReferenceCut {
  time_ms: number;
  change_score: number;
}

export interface ReferenceVideoAnalysis {
  duration_ms: number;
  sample_times_ms: number[];
  cuts: ReferenceCut[];
  shot_durations_ms: number[];
  change_scores: Array<{ time_ms: number; score: number }>;
  cut_threshold: number;
  average_non_cut_change: number;
  visual_density: number;
  luminance_contrast: number;
  composition_center: { x: number; y: number };
  palette: string[];
  limitations: string[];
}

const clamp01 = (value: number) => Math.min(1, Math.max(0, value));
const luminance = (r: number, g: number, b: number) => (0.2126 * r + 0.7152 * g + 0.0722 * b) / 255;
const mean = (values: number[]) => values.length ? values.reduce((sum, value) => sum + value, 0) / values.length : 0;

function paletteFromPixels(data: Buffer, channels: number, limit = 5): string[] {
  const bins = new Map<string, number>();
  for (let offset = 0; offset < data.length; offset += channels) {
    const r = Math.min(255, Math.round(data[offset] / 32) * 32);
    const g = Math.min(255, Math.round(data[offset + 1] / 32) * 32);
    const b = Math.min(255, Math.round(data[offset + 2] / 32) * 32);
    const key = `${r},${g},${b}`;
    bins.set(key, (bins.get(key) ?? 0) + 1);
  }
  return [...bins.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, limit)
    .map(([key]) => {
      const [r, g, b] = key.split(",").map(Number);
      return `#${[r, g, b].map((value) => value.toString(16).padStart(2, "0")).join("")}`;
    });
}

/** Measure one already-rendered reference frame. No model/OCR is involved. */
export async function measureReferenceFrame(
  bytes: Buffer | Uint8Array,
  timeMs: number,
): Promise<ReferenceFrameMeasurement> {
  if (!Number.isFinite(timeMs) || timeMs < 0) throw new Error("timeMs must be non-negative and finite");
  const { data, info } = await sharp(bytes)
    .rotate()
    .resize(32, 18, { fit: "fill" })
    .removeAlpha()
    .raw()
    .toBuffer({ resolveWithObject: true });
  const channels = info.channels;
  if (channels < 3) throw new Error("Reference frame must decode to RGB pixels");

  const lumas: number[] = [];
  let rSum = 0, gSum = 0, bSum = 0;
  for (let offset = 0; offset < data.length; offset += channels) {
    const r = data[offset], g = data[offset + 1], b = data[offset + 2];
    rSum += r; gSum += g; bSum += b;
    lumas.push(luminance(r, g, b));
  }
  const pixelCount = Math.max(1, lumas.length);
  const lumaMean = mean(lumas);
  const contrast = Math.sqrt(mean(lumas.map((value) => (value - lumaMean) ** 2)));

  let edge = 0;
  let edgeComparisons = 0;
  let weightSum = 0, weightedX = 0, weightedY = 0;
  for (let y = 0; y < info.height; y += 1) {
    for (let x = 0; x < info.width; x += 1) {
      const index = y * info.width + x;
      const value = lumas[index];
      if (x + 1 < info.width) { edge += Math.abs(value - lumas[index + 1]); edgeComparisons += 1; }
      if (y + 1 < info.height) { edge += Math.abs(value - lumas[index + info.width]); edgeComparisons += 1; }
      const weight = Math.abs(value - lumaMean) + 0.01;
      weightSum += weight;
      weightedX += ((x + 0.5) / info.width) * weight;
      weightedY += ((y + 0.5) / info.height) * weight;
    }
  }

  return {
    time_ms: Math.round(timeMs),
    width: info.width,
    height: info.height,
    mean_rgb: { r: rSum / pixelCount, g: gSum / pixelCount, b: bSum / pixelCount },
    mean_luminance: lumaMean,
    luminance_contrast: contrast,
    edge_density: edgeComparisons ? edge / edgeComparisons : 0,
    composition_center: {
      x: weightSum ? clamp01(weightedX / weightSum) : 0.5,
      y: weightSum ? clamp01(weightedY / weightSum) : 0.5,
    },
    palette: paletteFromPixels(data, channels),
    signature: lumas,
  };
}

export function referenceFrameChange(left: ReferenceFrameMeasurement, right: ReferenceFrameMeasurement): number {
  const count = Math.min(left.signature.length, right.signature.length);
  if (!count) return 0;
  let sum = 0;
  for (let index = 0; index < count; index += 1) {
    const delta = left.signature[index] - right.signature[index];
    sum += delta * delta;
  }
  return Math.sqrt(sum / count);
}

function median(values: number[]): number {
  if (!values.length) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[middle] : (sorted[middle - 1] + sorted[middle]) / 2;
}

function aggregatePalette(frames: ReferenceFrameMeasurement[], limit = 8): string[] {
  const counts = new Map<string, number>();
  for (const frame of frames) for (const color of frame.palette) counts.set(color, (counts.get(color) ?? 0) + 1);
  return [...counts.entries()].sort((a, b) => b[1] - a[1]).slice(0, limit).map(([color]) => color);
}

/**
 * Convert sampled frame measurements into robust structural measurements.
 * Cuts are frame-change outliers using median + 3*MAD with a minimum absolute
 * threshold. This is intentionally conservative: a false cut is worse than an
 * unlabelled fast move because shot durations feed the editable scaffold.
 */
export function analyzeReferenceFrameSeries(
  frames: ReferenceFrameMeasurement[],
  durationMs: number,
): ReferenceVideoAnalysis {
  if (!Number.isFinite(durationMs) || durationMs <= 0) throw new Error("durationMs must be positive and finite");
  if (frames.length < 2) throw new Error("Reference analysis requires at least two sampled frames");
  const ordered = [...frames].sort((a, b) => a.time_ms - b.time_ms);
  const changes = ordered.slice(1).map((frame, index) => ({
    time_ms: frame.time_ms,
    score: referenceFrameChange(ordered[index], frame),
  }));
  const scores = changes.map((change) => change.score);
  const center = median(scores);
  const mad = median(scores.map((score) => Math.abs(score - center)));
  const threshold = Math.max(0.18, center + Math.max(0.04, 3 * mad));
  const cuts = changes.filter((change) => change.score >= threshold)
    // Adjacent sampled frames around the same hard cut collapse to the stronger one.
    .reduce<ReferenceCut[]>((picked, candidate) => {
      const previous = picked[picked.length - 1];
      const nominalGap = durationMs / Math.max(1, ordered.length - 1);
      if (previous && candidate.time_ms - previous.time_ms < nominalGap * 1.5) {
        if (candidate.score > previous.change_score) picked[picked.length - 1] = { time_ms: candidate.time_ms, change_score: candidate.score };
      } else picked.push({ time_ms: candidate.time_ms, change_score: candidate.score });
      return picked;
    }, []);
  const boundaries = [0, ...cuts.map((cut) => cut.time_ms), durationMs]
    .filter((value, index, array) => index === 0 || value > array[index - 1]);
  const shotDurations = boundaries.slice(1).map((end, index) => end - boundaries[index]);
  const cutTimes = new Set(cuts.map((cut) => cut.time_ms));
  const nonCut = changes.filter((change) => !cutTimes.has(change.time_ms)).map((change) => change.score);

  return {
    duration_ms: Math.round(durationMs),
    sample_times_ms: ordered.map((frame) => frame.time_ms),
    cuts,
    shot_durations_ms: shotDurations,
    change_scores: changes,
    cut_threshold: threshold,
    average_non_cut_change: mean(nonCut),
    visual_density: mean(ordered.map((frame) => frame.edge_density)),
    luminance_contrast: mean(ordered.map((frame) => frame.luminance_contrast)),
    composition_center: {
      x: mean(ordered.map((frame) => frame.composition_center.x)),
      y: mean(ordered.map((frame) => frame.composition_center.y)),
    },
    palette: aggregatePalette(ordered),
    limitations: [
      "Cut timing is bounded by the requested sample interval; denser sampling increases temporal precision.",
      "Text regions are not inferred: this analyzer intentionally uses deterministic pixels, not OCR or a vision model.",
      "Frame change measures visual change but does not claim to distinguish subject motion from camera motion.",
    ],
  };
}
