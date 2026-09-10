import type { CreativeDocument, CreativeElement } from "./schema";

/**
 * Works out which web fonts a document needs, and how to ask for them.
 *
 * `fontFamily` was previously handed straight to CSS in a sandbox that ships
 * neither Inter nor Sora, so every render silently fell back to whatever
 * grotesque the base image had. For an engine whose whole claim is that the
 * same document renders the same film, quietly substituting the typeface is
 * the worst kind of failure: nothing errors, and the brand is just gone.
 *
 * This module is pure. The composition does the fetching.
 */

/** CSS generic families — never fetched, the browser resolves them. */
const GENERIC_FAMILIES = new Set([
  "serif",
  "sans-serif",
  "monospace",
  "cursive",
  "fantasy",
  "system-ui",
  "ui-sans-serif",
  "ui-serif",
  "ui-monospace",
  "ui-rounded",
  "math",
  "emoji",
  "fangsong",
  "inherit",
  "initial",
  "unset",
]);

/**
 * Families that ship with the OS or the renderer image. Requesting these from
 * a font service would fail and waste a round trip.
 */
const SYSTEM_FAMILIES = new Set([
  "arial",
  "helvetica",
  "helvetica neue",
  "times",
  "times new roman",
  "courier",
  "courier new",
  "georgia",
  "verdana",
  "tahoma",
  "trebuchet ms",
  "impact",
  "comic sans ms",
  "segoe ui",
  "roboto",
  "dejavu sans",
  "liberation sans",
  "noto sans",
  "-apple-system",
  "blinkmacsystemfont",
]);

/** A family name safe to put in a URL: letters, digits, spaces, hyphens. */
const SAFE_FAMILY = /^[A-Za-z0-9][A-Za-z0-9 -]{0,63}$/;

/** Splits a CSS font stack into its individual family names. */
export function parseFontStack(stack: string): string[] {
  return stack
    .split(",")
    .map((part) => part.trim().replace(/^["']|["']$/g, "").trim())
    .filter(Boolean);
}

/**
 * The first family in a stack that would need downloading.
 *
 * Only the first matters: the rest of the stack is the fallback chain, and
 * fetching a fallback we hope not to use is wasted time in a render that is
 * already the slowest thing in the product.
 */
export function webFontFamilyFromStack(stack: string): string | null {
  for (const family of parseFontStack(stack)) {
    const key = family.toLowerCase();
    if (GENERIC_FAMILIES.has(key) || SYSTEM_FAMILIES.has(key)) return null;
    if (!SAFE_FAMILY.test(family)) continue;
    return family;
  }
  return null;
}

export interface RequiredFont {
  family: string;
  /** Every weight the document actually asks this family to render at. */
  weights: number[];
}

function addWeight(into: Map<string, Set<number>>, stack: string, weight: number): void {
  const family = webFontFamilyFromStack(stack);
  if (!family) return;
  const rounded = Math.round(weight);
  const clamped = Math.min(900, Math.max(100, Number.isFinite(rounded) ? rounded : 400));
  const existing = into.get(family) ?? new Set<number>();
  existing.add(clamped);
  into.set(family, existing);
}

/**
 * Records one text element's font, then - for a composite - does the same
 * for every descendant. A composite child is a real CreativeTextElement with
 * the same `style` shape a top-level text element has, so the same override
 * check applies at any depth; the recursion stops the moment a branch is not
 * itself a composite, since only composite nests real elements this way.
 */
function addElementFonts(
  found: Map<string, Set<number>>,
  document: CreativeDocument,
  element: CreativeElement,
): void {
  if (element.type === "text") {
    const tokenName = element.style?.token;
    const token = tokenName ? document.designSystem.typography?.[tokenName] : undefined;
    const overrides = element.style?.overrides;
    const family = overrides?.fontFamily ?? token?.fontFamily;
    const weight = overrides?.fontWeight ?? token?.fontWeight ?? 400;
    if (family) addWeight(found, family, weight);
    return;
  }
  if (element.type === "composite") {
    for (const child of element.children) addElementFonts(found, document, child);
  }
}

/**
 * Every web font the document renders with, including the weights.
 *
 * Reads both the design-system tokens and per-element style overrides, since
 * an override can name a family the tokens never mention - including a text
 * override nested inside a composite's own children, so a card's headline in
 * a custom face is preloaded exactly like a top-level headline would be,
 * never a fallback-font flash on the first frame it appears.
 */
export function requiredFonts(document: CreativeDocument): RequiredFont[] {
  const found = new Map<string, Set<number>>();

  for (const token of Object.values(document.designSystem.typography ?? {})) {
    if (token?.fontFamily) addWeight(found, token.fontFamily, token.fontWeight ?? 400);
  }

  for (const scene of document.scenes ?? []) {
    for (const element of scene.elements ?? []) {
      addElementFonts(found, document, element);
    }
  }

  return [...found.entries()]
    .map(([family, weights]) => ({ family, weights: [...weights].sort((a, b) => a - b) }))
    .sort((a, b) => a.family.localeCompare(b.family));
}

/**
 * Stylesheet URLs to try for one family, best first.
 *
 * A font service rejects the whole request when any requested weight is
 * outside the family's axis, and there is no way to know a family's range
 * without a font database. So this degrades: the exact weights, then the two
 * weights essentially every family has, then the family bare. The first one
 * that responds wins.
 *
 * `display=block` matters — `swap` would let a frame render in the fallback
 * face, and a render where frame 40 is Sora and frame 39 is Arial is exactly
 * the non-determinism this engine exists to prevent.
 */
export function googleFontsUrlCandidates(font: RequiredFont): string[] {
  if (!SAFE_FAMILY.test(font.family)) return [];
  const name = font.family.trim().replace(/ +/g, "+");
  const exact = [...new Set(font.weights)].sort((a, b) => a - b);
  const urls = [
    `https://fonts.googleapis.com/css2?family=${name}:wght@${exact.join(";")}&display=block`,
    `https://fonts.googleapis.com/css2?family=${name}:wght@400;700&display=block`,
    `https://fonts.googleapis.com/css2?family=${name}&display=block`,
  ];
  return [...new Set(urls)];
}
