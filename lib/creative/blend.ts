/**
 * Blend mode resolution.
 *
 * There is nothing to compute — every value `BlendMode` can take is already a
 * literal CSS `mix-blend-mode` keyword — but it still goes through a pure
 * module and a shared constant rather than being read off the element
 * directly in each renderer's JSX. That is what lets a guard test prove both
 * renderers apply it instead of trusting that they do: mask and blur have
 * each already shipped once with only one renderer actually wired up.
 */
import type { BlendMode } from "./schema";

/**
 * CSS `mix-blend-mode` value, or undefined when there is nothing to apply.
 *
 * Typed as `Exclude<BlendMode, "normal">` rather than widened to `string` so
 * a renderer can assign the result straight into a `mixBlendMode` style
 * property with no cast: every value this can return is already one of
 * React's own accepted `mix-blend-mode` keywords.
 */
export function resolveBlendModeCss(blendMode: BlendMode | undefined): Exclude<BlendMode, "normal"> | undefined {
  return blendMode && blendMode !== "normal" ? blendMode : undefined;
}
