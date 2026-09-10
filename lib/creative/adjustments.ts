/**
 * Deterministic visual adjustments.
 *
 * Pure module turning an adjustment block into the CSS the renderers apply.
 * Keeping it here rather than inline in each renderer means the editor
 * preview, the still renderer and the final MP4 grade a shot identically.
 *
 * Every control is neutral at zero. Values are clamped rather than rejected:
 * a grade is a taste control, and refusing to render because someone asked
 * for 200% saturation helps nobody. Structural mistakes still fail loudly —
 * this is not one of those.
 */
import type { CreativeAdjustments } from "./schema";

const clamp = (value: number, min: number, max: number) => Math.min(max, Math.max(min, value));

/** Whether the block would change a single pixel. */
export function hasVisibleAdjustments(adjustments: CreativeAdjustments | undefined): boolean {
  if (!adjustments) return false;
  return (
    !!adjustments.exposure ||
    !!adjustments.contrast ||
    !!adjustments.saturation ||
    !!adjustments.temperature ||
    (adjustments.blurPx ?? 0) > 0 ||
    (adjustments.vignette ?? 0) > 0 ||
    (adjustments.grain ?? 0) > 0 ||
    (adjustments.backdropBlurPx ?? 0) > 0 ||
    (adjustments.backdropSaturation ?? 1) !== 1
  );
}

/**
 * CSS `filter` value for the colour adjustments.
 *
 * Emission order is fixed so the same block always produces the same string —
 * filters are order-dependent, and a grade that shifts when a caller happens
 * to reorder its keys would break preview/export parity.
 */
export function adjustmentsToCssFilter(adjustments: CreativeAdjustments): string | undefined {
  const parts: string[] = [];

  const exposure = clamp(adjustments.exposure ?? 0, -1, 1);
  if (exposure !== 0) parts.push(`brightness(${1 + exposure})`);

  const contrast = clamp(adjustments.contrast ?? 0, -1, 1);
  if (contrast !== 0) parts.push(`contrast(${1 + contrast})`);

  const saturation = clamp(adjustments.saturation ?? 0, -1, 1);
  if (saturation !== 0) parts.push(`saturate(${1 + saturation})`);

  // CSS has no temperature primitive. Warming reads as sepia plus a small
  // hue shift toward amber; cooling as a hue shift toward blue.
  const temperature = clamp(adjustments.temperature ?? 0, -1, 1);
  if (temperature > 0) parts.push(`sepia(${(temperature * 0.4).toFixed(3)}) hue-rotate(-${(temperature * 8).toFixed(1)}deg)`);
  else if (temperature < 0) parts.push(`hue-rotate(${(-temperature * 12).toFixed(1)}deg)`);

  const blurPx = Math.max(0, adjustments.blurPx ?? 0);
  if (blurPx > 0) parts.push(`blur(${blurPx}px)`);

  return parts.length ? parts.join(" ") : undefined;
}

/** CSS backdrop-filter for glass panels, or undefined when neutral. */
export function adjustmentsToBackdropFilter(adjustments: CreativeAdjustments): string | undefined {
  const parts: string[] = [];
  const blur = Math.max(0, adjustments.backdropBlurPx ?? 0);
  if (blur > 0) parts.push(`blur(${blur}px)`);
  const saturation = clamp(adjustments.backdropSaturation ?? 1, 0, 3);
  if (saturation !== 1) parts.push(`saturate(${saturation})`);
  return parts.length ? parts.join(" ") : undefined;
}

/** Radial gradient overlay for edge darkening, or undefined at zero. */
export function adjustmentsVignetteGradient(adjustments: CreativeAdjustments): string | undefined {
  const vignette = clamp(adjustments.vignette ?? 0, 0, 1);
  if (vignette <= 0) return undefined;
  const inner = (70 - vignette * 25).toFixed(1);
  return `radial-gradient(ellipse at center, rgba(0,0,0,0) ${inner}%, rgba(0,0,0,${vignette.toFixed(3)}) 100%)`;
}

/** Grain opacity, clamped. Rendered as a tiled noise overlay by the renderers. */
export function adjustmentsGrainOpacity(adjustments: CreativeAdjustments): number {
  return clamp(adjustments.grain ?? 0, 0, 1);
}
