/**
 * Kinetic typography resolution.
 *
 * Pure module. Text is split into units — the whole block, lines, words or
 * characters — and each unit's visual state at a given time is derived from
 * one animation description plus its index. Nothing here measures a real
 * glyph or touches the DOM, so preview, still rendering and final render all
 * agree by construction.
 *
 * Text fitting is an *estimate*, deliberately. Real measurement would need a
 * browser and would make the result depend on when and where it ran. An
 * estimate that is slightly wrong but identical everywhere is worth more here
 * than a precise number that differs between preview and export — and the
 * same estimate backs the overflow warnings, so a warning always matches what
 * the renderer actually did.
 */
import { applyCreativeEasing } from "./evaluate";
import type { CreativeTextAnimation, CreativeTextFit, TextAnimationGranularity } from "./schema";

export interface TextUnit {
  text: string;
  /** Position in the flattened unit list. */
  index: number;
  /** Which source line the unit came from. */
  lineIndex: number;
}

export interface TextUnitState {
  opacity: number;
  translateX: number;
  translateY: number;
  scale: number;
  /** Extra letter-spacing in pixels, on top of the styled value. */
  letterSpacingDelta: number;
  /** Percentage of the unit clipped from the right, for mask reveals. */
  clipPercent: number;
}

const DEFAULT_DISTANCE = 40;

export function splitTextUnits(text: string, granularity: TextAnimationGranularity): TextUnit[] {
  if (!text.trim()) return [];

  if (granularity === "block") {
    return [{ text, index: 0, lineIndex: 0 }];
  }

  const lines = text.split("\n");
  const units: TextUnit[] = [];
  let index = 0;

  lines.forEach((line, lineIndex) => {
    if (granularity === "line") {
      if (!line.trim()) return;
      units.push({ text: line, index: index++, lineIndex });
      return;
    }
    if (granularity === "word") {
      for (const word of line.split(/\s+/)) {
        if (!word) continue;
        units.push({ text: word, index: index++, lineIndex });
      }
      return;
    }
    for (const character of [...line]) {
      units.push({ text: character, index: index++, lineIndex });
    }
  });

  return units;
}

/**
 * Groups units back into their source lines.
 *
 * Word and character granularity flatten the text, but the line structure the
 * author wrote still has to survive: renderers lay each group out as its own
 * row so an explicit newline stays a newline.
 */
export function groupTextUnitsByLine(units: TextUnit[]): TextUnit[][] {
  const lines: TextUnit[][] = [];
  for (const unit of units) {
    const line = lines[unit.lineIndex] ?? (lines[unit.lineIndex] = []);
    line.push(unit);
  }
  return lines.filter(Boolean);
}

/** Total length of the run: the last unit's stagger offset plus one duration. */
export function textAnimationTotalMs(animation: CreativeTextAnimation, unitCount: number): number {
  if (unitCount <= 0) return 0;
  return animation.startMs + (unitCount - 1) * animation.staggerMs + animation.durationMs;
}

function restState(): TextUnitState {
  return { opacity: 1, translateX: 0, translateY: 0, scale: 1, letterSpacingDelta: 0, clipPercent: 0 };
}

/**
 * State of one unit at `localMs`, measured from the start of the element's
 * visible window. Units are hidden before their turn and at rest after it.
 */
export function resolveTextUnitState(
  animation: CreativeTextAnimation,
  unitIndex: number,
  _unitCount: number,
  localMs: number,
): TextUnitState {
  const startMs = animation.startMs + unitIndex * animation.staggerMs;
  if (localMs >= startMs + animation.durationMs) return restState();

  const distance = animation.distance ?? DEFAULT_DISTANCE;
  const raw = animation.durationMs <= 0 ? 1 : (localMs - startMs) / animation.durationMs;
  const progress = raw <= 0 ? 0 : applyCreativeEasing(animation.easing, raw);
  const remaining = 1 - progress;
  const state = restState();

  // Every mode fades in except the mask reveal, which is defined by its clip.
  state.opacity = animation.mode === "mask-reveal" ? 1 : progress;

  switch (animation.mode) {
    case "rise":
      state.translateY = distance * remaining;
      break;
    case "fall":
      state.translateY = -distance * remaining;
      break;
    case "slide-left":
      state.translateX = distance * remaining;
      break;
    case "slide-right":
      state.translateX = -distance * remaining;
      break;
    case "scale":
      state.scale = 1 - 0.35 * remaining;
      break;
    case "punch":
      // Overshoot above rest, then settle back down onto it.
      state.scale = 1 + 0.4 * remaining;
      break;
    case "mask-reveal":
      state.clipPercent = 100 * remaining;
      break;
    case "tracking":
      state.letterSpacingDelta = distance * remaining;
      break;
    case "fade":
      break;
  }

  return state;
}

export interface TextBox {
  width: number;
  height: number;
}

export interface EstimatedTextStyle {
  fontFamily: string;
  fontSize: number;
  fontWeight: number;
  lineHeight: number;
  letterSpacing: number;
}

export interface EstimatedTextLayout {
  fontSize: number;
  lineCount: number;
  /** Estimated rendered height in pixels. */
  heightPx: number;
  overflows: boolean;
}

/**
 * Average glyph width as a fraction of font size.
 *
 * A single constant rather than per-font metrics: the value only has to be
 * stable and roughly right, because it is used identically by the renderer
 * and the overflow validator.
 */
const AVERAGE_GLYPH_RATIO = 0.52;

function layoutAt(text: string, style: EstimatedTextStyle, box: TextBox, fontSize: number): EstimatedTextLayout {
  const glyphWidth = fontSize * AVERAGE_GLYPH_RATIO + style.letterSpacing;
  const charsPerLine = Math.max(1, Math.floor(box.width / Math.max(0.0001, glyphWidth)));

  let lineCount = 0;
  for (const paragraph of text.split("\n")) {
    const words = paragraph.split(/\s+/).filter(Boolean);
    if (words.length === 0) {
      lineCount += 1;
      continue;
    }
    let current = 0;
    let lines = 1;
    for (const word of words) {
      const needed = current === 0 ? word.length : current + 1 + word.length;
      if (needed > charsPerLine && current > 0) {
        lines += 1;
        current = word.length;
      } else {
        current = needed;
      }
    }
    lineCount += lines;
  }

  const heightPx = lineCount * fontSize * style.lineHeight;
  return { fontSize, lineCount, heightPx, overflows: heightPx > box.height };
}

/**
 * Estimates how the text lays out in its box, shrinking the font when the
 * element asks for it. Overflow is still reported when the text cannot fit
 * even at the minimum size — fitting never silently truncates.
 */
export function estimateTextLayout(
  text: string,
  style: EstimatedTextStyle,
  box: TextBox,
  fit: CreativeTextFit | undefined,
): EstimatedTextLayout {
  const natural = layoutAt(text, style, box, style.fontSize);
  if (!fit || fit.mode !== "shrink" || !natural.overflows) return natural;

  const minimum = Math.max(1, Math.floor(fit.minFontSize));
  for (let size = Math.floor(style.fontSize) - 1; size >= minimum; size -= 1) {
    const candidate = layoutAt(text, style, box, size);
    if (!candidate.overflows) return candidate;
  }
  return layoutAt(text, style, box, minimum);
}
