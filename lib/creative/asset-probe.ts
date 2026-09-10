/**
 * Look at a source asset before cutting to it.
 *
 * Until this existed, a caller that generated footage could not see it. Choosing
 * eight segment windows out of a fifteen-second clip meant trusting the shot
 * list in the generation prompt — and a model's timing does not match the
 * prompt's. In one field run daylight began around 12.5s rather than the 11s
 * asked for, so the turn the film was built around landed a full beat late,
 * discoverable only by cutting the whole film against guessed timings,
 * rendering it, and reading it backwards. Two passes to learn one number.
 *
 * The probe is a throwaway one-element document, never persisted, rendered
 * through the same pipeline as everything else. That is the point: the frame
 * you inspect comes out of the renderer that will cut the film, so what you
 * see is what you will get.
 */
import type { CreativeDocument } from "./schema";
import { createNeutralDesignSystem } from "./defaults";

export interface ProbeAsset {
  id: string;
  width?: number | null;
  height?: number | null;
  durationMs?: number | null;
}

/** Frames land on a source frame, so a probe at the final instant is legal. */
export const PROBE_FPS = 30;

/**
 * A portrait canvas is the safe default when an asset's dimensions were never
 * measured: this product's films are vertical, and a wrong guess only letterboxes
 * the probe rather than showing the wrong footage.
 */
const FALLBACK_CANVAS = { width: 1080, height: 1920 };

/** Without a measured duration there is no window to probe; an hour is a ceiling, not a claim. */
const FALLBACK_DURATION_MS = 3_600_000;

export function buildAssetProbeDocument(asset: ProbeAsset): CreativeDocument {
  const width = asset.width && asset.width > 0 ? Math.round(asset.width) : FALLBACK_CANVAS.width;
  const height = asset.height && asset.height > 0 ? Math.round(asset.height) : FALLBACK_CANVAS.height;
  const durationMs =
    asset.durationMs && asset.durationMs > 0 ? Math.round(asset.durationMs) : FALLBACK_DURATION_MS;

  return {
    version: 1,
    id: `probe-${asset.id}`,
    title: "Asset probe",
    canvas: { width, height, fps: PROBE_FPS, background: { kind: "literal", value: "#000000" } },
    // Built rather than hand-rolled. A literal written here shipped without
    // `radii`, and the renderer validates its own input, so every probe failed
    // with "radii tokens must be an object" — a tool that had no design system
    // of its own dying on one. The canonical builder cannot fall behind the
    // validator the way a literal can.
    designSystem: createNeutralDesignSystem(),
    scenes: [
      {
        id: "probe",
        name: "Probe",
        durationMs,
        groups: [],
        elements: [
          {
            id: "source",
            name: "Source",
            type: "video",
            assetId: asset.id,
            // Every one of these is load-bearing for the identity below: the
            // clip starts at the head of the source, runs at rate 1 and is
            // never trimmed, so a timeline millisecond IS a source
            // millisecond. A probe that quietly retimed would report the
            // wrong number, which is the exact failure it exists to prevent.
            sourceStartMs: 0,
            playbackRate: 1,
            // `contain` shows the whole frame. `cover` would crop the edges
            // out of the thing you asked to look at.
            fit: "contain",
            volume: 0,
            role: "background",
            transform: {
              x: 0,
              y: 0,
              width,
              height,
              rotation: 0,
              opacity: 1,
              anchorX: 0.5,
              anchorY: 0.5,
              zIndex: 0,
            },
          },
        ],
      },
    ],
  };
}

/**
 * Reject a probe time outside the asset rather than clamping it.
 *
 * Clamping would answer a question about 20s with a frame from 15s and no
 * indication it had done so — the caller would write down the wrong cut.
 */
export function assertProbeTimeInRange(timeMs: number, durationMs: number | null | undefined): void {
  if (!Number.isFinite(timeMs) || timeMs < 0) {
    throw new Error("times_ms values must be milliseconds greater than or equal to zero");
  }
  if (durationMs == null || !Number.isFinite(durationMs) || durationMs <= 0) return;
  if (timeMs >= durationMs) {
    throw new Error(
      `times_ms value ${Math.round(timeMs)} is past the end of this ${Math.round(durationMs)}ms asset`,
    );
  }
}
