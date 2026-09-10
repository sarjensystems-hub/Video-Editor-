/**
 * Mask and motion-blur resolution.
 *
 * Pure module producing the CSS both renderers apply, so a masked or
 * motion-blurred element looks the same in the editor preview, the still
 * renderer and the final MP4.
 *
 * Masks are expressed as CSS `mask-image` gradients rather than `clip-path`
 * because a gradient can feather; a clip path has a hard edge and no way to
 * soften it.
 */
import type { CreativeMask, CreativeMotionBlur } from "./schema";

const clamp01 = (value: number) => Math.min(1, Math.max(0, value));

export interface ResolvedMask {
  maskImage: string;
  maskSize: string;
  maskPosition: string;
  maskRepeat: string;
  /**
   * How to combine the layers of `maskImage`. A rect is two gradients, one
   * per axis, so it needs one; an ellipse is a single layer and leaves this
   * undefined. Callers must apply it — without it the browser defaults to
   * `add`, and a non-inverted rect would keep everything either gradient
   * keeps, which is a cross, not a rectangle.
   */
  maskComposite?: string;
  /**
   * The same instruction in the prefixed vocabulary, which spells the two
   * operations differently: `source-in` for intersect, `source-over` for add.
   */
  webkitMaskComposite?: string;
  /** Optional hard geometry composed with the feather mask. */
  clipPath?: string;
}

/**
 * CSS for a mask, or undefined when the mask covers everything with no
 * feather and no inversion — in which case it would be a no-op layer.
 */
export function resolveMaskCss(mask: CreativeMask | undefined): ResolvedMask | undefined {
  if (!mask) return undefined;

  const x = clamp01(mask.x) * 100;
  const y = clamp01(mask.y) * 100;
  const width = Math.max(0.0001, clamp01(mask.width)) * 100;
  const height = Math.max(0.0001, clamp01(mask.height)) * 100;
  const feather = clamp01(mask.feather ?? 0);

  if (mask.kind === "polygon") {
    const points = (mask.points ?? []).map((point) => {
      const px = x + clamp01(point.x) * width;
      const py = y + clamp01(point.y) * height;
      return `${px}% ${py}%`;
    });
    return {
      maskImage: "linear-gradient(black, black)",
      maskSize: "100% 100%",
      maskPosition: "0 0",
      maskRepeat: "no-repeat",
      clipPath: `polygon(${points.join(", ")})`,
    };
  }

  // A feathered edge is a gradient stop pulled inward from the shape edge.
  // Feather is a fraction of each axis's own extent, so a wide short band
  // softens proportionally on both axes rather than by one shared distance.
  const solidStop = Math.max(0, 100 - feather * 100);
  const inside = mask.invert ? "transparent" : "black";
  const outside = mask.invert ? "black" : "transparent";

  if (mask.kind === "ellipse") {
    return {
      maskImage: `radial-gradient(ellipse ${width / 2}% ${height / 2}% at ${x + width / 2}% ${y + height / 2}%, ${inside} ${solidStop}%, ${outside} 100%)`,
      maskSize: "100% 100%",
      maskPosition: "0 0",
      maskRepeat: "no-repeat",
    };
  }

  const radius = clamp01(mask.radius ?? 0) * 50;

  // A rect needs one gradient per axis. A single `to right` gradient leaves
  // the top and bottom edges unmasked entirely — so a rect never clipped
  // vertically, and a full-width scrim's top edge stayed a hard seam whatever
  // feather was set to.
  const axis = (direction: "to right" | "to bottom", start: number, extent: number) => {
    const inset = (extent * feather) / 2;
    return `linear-gradient(${direction}, ${outside} ${start}%, ${inside} ${start + inset}%, ${inside} ${start + extent - inset}%, ${outside} ${start + extent}%)`;
  };

  return {
    maskImage: `${axis("to right", x, width)}, ${axis("to bottom", y, height)}`,
    maskSize: "100% 100%",
    maskPosition: "0 0",
    maskRepeat: "no-repeat",
    // Keeping the inside means inside-x AND inside-y. Inverting negates that
    // to outside-x OR outside-y, which is a union.
    maskComposite: mask.invert ? "add" : "intersect",
    webkitMaskComposite: mask.invert ? "source-over" : "source-in",
    clipPath: radius > 0
      ? `inset(${y}% ${Math.max(0, 100 - x - width)}% ${Math.max(0, 100 - y - height)}% ${x}% round ${radius}%)`
      : undefined,
  };
}

/**
 * Directional blur for an element moving at `velocityPxPerFrame`.
 *
 * Returns an SVG filter's stdDeviation pair rather than a CSS `blur()`,
 * because CSS blur is isotropic and real motion blur is not: movement smears
 * along the direction of travel only.
 */
export function resolveMotionBlur(
  motionBlur: CreativeMotionBlur | undefined,
  velocityX: number,
  velocityY: number,
): { stdDeviationX: number; stdDeviationY: number } | undefined {
  if (!motionBlur) return undefined;

  // Shutter angle over a full rotation gives the fraction of the frame the
  // shutter is open; that fraction of the motion is what smears.
  const openFraction = Math.max(0, motionBlur.shutterAngle) / 360;
  if (openFraction <= 0) return undefined;

  const cap = motionBlur.maxBlurPx ?? 32;
  const stdDeviationX = Math.min(cap, Math.abs(velocityX) * openFraction * 0.5);
  const stdDeviationY = Math.min(cap, Math.abs(velocityY) * openFraction * 0.5);

  if (stdDeviationX < 0.1 && stdDeviationY < 0.1) return undefined;
  return { stdDeviationX, stdDeviationY };
}
