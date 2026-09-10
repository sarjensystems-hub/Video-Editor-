/**
 * Native counting-number text.
 *
 * A count-up used to be authored as six or seven timed text elements per
 * figure - one text swap standing in for every intermediate value, spaced by
 * hand to look roughly linear. This resolves the number itself: a
 * CreativeTextCounter on an ordinary text element interpolates between two
 * values over a duration and formats the result, the same way an animated
 * transform interpolates a position instead of being authored as a run of
 * static poses.
 *
 * Pure module, called directly and identically by CreativeScenePreview.tsx
 * and remotion/CreativeComposition.tsx wherever they read a text element's
 * content - the same arrangement text-animation.ts's resolveTextUnitState
 * already uses for kinetic typography, for the same reason: preview and
 * final render show the exact same digits at the exact same frame because
 * both call the identical function with the identical inputs, not because
 * either renderer decided anything on its own.
 *
 * Formatting is deliberately not a second implementation. chart.ts already
 * writes a number deterministically for a value label, and a KPI counter is
 * the same problem, so format/precision share formatChartValue and its
 * vocabulary (plain/compact/percent) rather than inventing a parallel one.
 */
import { applyCreativeEasing } from "./evaluate";
import { formatChartValue } from "./chart";
import type { CreativeTextCounter } from "./schema";

/**
 * The raw interpolated number at `localMs`, measured from the start of the
 * element's own visible window - the same element-local clock
 * apply_text_animation uses. Clamped before the run starts and after it
 * finishes, exactly like evaluateAnimation: a counter read before startMs is
 * `from`, and one read after the run completes holds at `to` rather than
 * extrapolating past it, so a caller never has to special-case the ends.
 */
export function resolveCounterValue(counter: CreativeTextCounter, localMs: number): number {
  if (localMs <= counter.startMs) return counter.from;
  if (counter.durationMs <= 0 || localMs >= counter.startMs + counter.durationMs) return counter.to;
  const raw = (localMs - counter.startMs) / counter.durationMs;
  const progress = applyCreativeEasing(counter.easing, raw);
  return counter.from + (counter.to - counter.from) * progress;
}

/** Applies format, precision, prefix and suffix to an already-resolved number. */
export function formatCounterValue(counter: CreativeTextCounter, value: number): string {
  const body = formatChartValue(value, counter.format ?? "plain", counter.precision ?? 0);
  return `${counter.prefix ?? ""}${body}${counter.suffix ?? ""}`;
}

/**
 * The exact string a counter shows at `localMs` - what a text element renders
 * in place of its authored `text` whenever `counter` is set.
 */
export function resolveCounterText(counter: CreativeTextCounter, localMs: number): string {
  return formatCounterValue(counter, resolveCounterValue(counter, localMs));
}
