/**
 * Gradient resolution.
 *
 * Pure module turning a `ColorGradient` into the CSS gradient function that
 * `resolveColor` in evaluate.ts embeds wherever a background can render one.
 * Kept separate from evaluate.ts, on the precedent of mask.ts sitting beside
 * resolveColor rather than inside it: stop sorting and CSS assembly are their
 * own concern with their own tests, not the colour choke-point's.
 *
 * Stops are sorted by offset here rather than required to arrive pre-sorted.
 * An agent inserting one new stop into an existing array should not have to
 * re-order the rest, and a sort at resolve time is exact regardless of
 * authored order — the same reasoning animation keyframes do NOT get, because
 * a keyframe's order is also its narrative (which one happened first), while
 * a gradient stop's order is purely positional and fully described by its own
 * offset. Two stops at the same offset are a deliberate hard edge (a flag
 * split, a badge stripe) and keep the relative order they were authored in.
 */
import type { ColorGradient, ColorValue, CreativeDesignSystem, GradientStop } from "./schema";

const clamp01 = (value: number) => Math.min(1, Math.max(0, value));

/**
 * A stop's own colour, never a gradient.
 *
 * Validation already rejects a gradient nested inside a stop before a real
 * document can reach this — see `validateGradientValue` in validate.ts — but
 * this still guards the invariant independently, the same way `resolveColor`
 * guards a missing token even though validation also checks tokens exist.
 */
function resolveStopColor(designSystem: CreativeDesignSystem, color: ColorValue): string {
  if (color.kind === "literal") return color.value;
  if (color.kind === "token") {
    const resolved = designSystem.colors[color.token];
    if (!resolved) throw new Error(`Unknown creative color token: ${color.token}`);
    return resolved;
  }
  throw new Error("A gradient stop cannot itself be a gradient.");
}

function sortedStops(stops: GradientStop[]): GradientStop[] {
  // A stable sort keeps same-offset stops in authored order, which is what
  // makes a same-offset pair a predictable hard edge rather than a coin flip.
  return [...stops].sort((a, b) => a.offset - b.offset);
}

function stopListCss(designSystem: CreativeDesignSystem, stops: GradientStop[]): string {
  return sortedStops(stops)
    .map((stop) => `${resolveStopColor(designSystem, stop.color)} ${(clamp01(stop.offset) * 100).toFixed(2)}%`)
    .join(", ");
}

/**
 * CSS gradient function for a `ColorGradient` — e.g. for use as `background`.
 *
 * Requires at least two stops the same way validation does, so a malformed
 * gradient built directly (bypassing `validateCreativeDocument`, as a few
 * internal fixtures do) fails loudly here instead of silently rendering a
 * one-colour band with no gradient effect at all.
 */
export function resolveGradientCss(designSystem: CreativeDesignSystem, gradient: ColorGradient): string {
  if (gradient.stops.length < 2) throw new Error("A gradient needs at least two stops.");

  const stops = stopListCss(designSystem, gradient.stops);
  const centerX = clamp01(gradient.centerX ?? 0.5) * 100;
  const centerY = clamp01(gradient.centerY ?? 0.5) * 100;

  switch (gradient.kind) {
    case "linear": {
      // CSS itself defaults an angle-less linear-gradient to "to bottom",
      // i.e. 180deg; matching that default rather than picking a new one
      // means a gradient authored without an angle looks the way every other
      // CSS author already expects it to.
      const angle = gradient.angle ?? 180;
      return `linear-gradient(${angle}deg, ${stops})`;
    }
    case "radial":
      // A fixed circle, not the CSS default ellipse: a radial glow or vignette
      // is usually meant to read as round regardless of the element's aspect
      // ratio, and an ellipse would stretch it to match a non-square box.
      return `radial-gradient(circle at ${centerX}% ${centerY}%, ${stops})`;
    case "conic":
      // CSS defaults a conic-gradient's start angle to 0deg, pointing up —
      // the 12 o'clock position a progress ring or pie chart wants to start
      // from — so, as with linear, an omitted angle matches CSS's own default.
      return `conic-gradient(from ${gradient.angle ?? 0}deg at ${centerX}% ${centerY}%, ${stops})`;
  }
}
