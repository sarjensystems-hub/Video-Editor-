/**
 * Frosted-glass surfaces.
 *
 * Everything here is reachable today with a shape, an adjustment block and a
 * stroke — which is the problem. A convincing glass panel is a backdrop blur,
 * a slight saturation lift, a translucent tint, a hairline border, a specular
 * highlight along the top edge and a soft shadow, and it only reads as glass
 * when all six agree. Authoring them separately means six values to keep
 * consistent across every panel in a film, and a panel that drifts from the
 * others looks like a mistake rather than a style.
 *
 * So this takes one intensity and a tint and resolves the whole set. The
 * individual adjustment controls stay exactly as they were for anyone who
 * wants to build a surface by hand; this is the convenience over that
 * vocabulary, not a replacement for it.
 *
 * The defaults are the point of the primitive. They are what makes two panels
 * authored a week apart look like the same material.
 */
import type { ColorValue, CreativeDesignSystem, CreativeGlass } from "./schema";

const clamp01 = (value: number) => Math.min(1, Math.max(0, value));

export interface ResolvedGlassCss {
  /** Blur and saturate applied to whatever shows through the panel. */
  backdropFilter: string;
  /** Tint and top-edge highlight, as stacked background layers. */
  background: string;
  /** Hairline edge, or undefined at zero. */
  border?: string;
  borderRadius?: string;
  /** Soft shadow beneath the panel, or undefined at zero. */
  boxShadow?: string;
}

/**
 * A colour at a given alpha.
 *
 * Hex is parsed directly rather than handed to `color-mix`, because the result
 * has to be identical in the editor preview and in the render worker, and
 * those are two different Chromium builds. Anything that is not hex — a named
 * colour, an rgb() string — falls back to color-mix, which is correct wherever
 * it is supported and is the only general way to alpha an arbitrary CSS
 * colour without parsing every syntax.
 */
export function colorAtAlpha(color: string, alpha: number): string {
  const a = clamp01(alpha);
  const hex = color.trim();
  const match = /^#([0-9a-f]{3,8})$/i.exec(hex);
  if (match) {
    const digits = match[1];
    const expand = (value: string) => parseInt(value.length === 1 ? value + value : value, 16);
    if (digits.length === 3 || digits.length === 4) {
      const [r, g, b] = [digits[0], digits[1], digits[2]].map(expand);
      return `rgba(${r}, ${g}, ${b}, ${a})`;
    }
    if (digits.length === 6 || digits.length === 8) {
      const [r, g, b] = [digits.slice(0, 2), digits.slice(2, 4), digits.slice(4, 6)].map(expand);
      return `rgba(${r}, ${g}, ${b}, ${a})`;
    }
  }
  return `color-mix(in srgb, ${hex} ${(a * 100).toFixed(1)}%, transparent)`;
}

function resolveTint(designSystem: CreativeDesignSystem, color: ColorValue | undefined): string {
  if (!color) return "#ffffff";
  if (color.kind === "literal") return color.value;
  if (color.kind === "token") {
    const resolved = designSystem.colors[color.token];
    if (!resolved) throw new Error(`Unknown creative color token: ${color.token}`);
    return resolved;
  }
  // A gradient tint would fight the backdrop it is meant to sit over, and the
  // highlight layer already provides the only gradient a glass panel wants.
  throw new Error("A glass tint cannot be a gradient.");
}

/** Whether this block would change a single pixel. */
export function hasVisibleGlass(glass: CreativeGlass | undefined): boolean {
  if (!glass) return false;
  return (glass.blurPx ?? 0) > 0
    || (glass.tintOpacity ?? 0) > 0
    || (glass.borderOpacity ?? 0) > 0
    || (glass.highlight ?? 0) > 0
    || (glass.shadow ?? 0) > 0;
}

/**
 * The full CSS for one glass surface.
 *
 * Layer order is fixed: the highlight sits over the tint, both over the
 * blurred backdrop. Backgrounds are order-dependent in CSS, so emitting them
 * in a stable order is what keeps the preview and the render identical rather
 * than merely similar.
 */
export function resolveGlassCss(
  designSystem: CreativeDesignSystem,
  glass: CreativeGlass,
): ResolvedGlassCss | undefined {
  if (!hasVisibleGlass(glass)) return undefined;

  const blurPx = Math.max(0, glass.blurPx ?? 0);
  const saturation = Math.min(3, Math.max(0, glass.saturation ?? 1.4));
  const tint = resolveTint(designSystem, glass.tint);
  const tintOpacity = clamp01(glass.tintOpacity ?? 0.12);
  const borderOpacity = clamp01(glass.borderOpacity ?? 0.18);
  const highlight = clamp01(glass.highlight ?? 0.25);
  const shadow = clamp01(glass.shadow ?? 0.18);

  const backdropParts: string[] = [];
  if (blurPx > 0) backdropParts.push(`blur(${blurPx}px)`);
  if (saturation !== 1) backdropParts.push(`saturate(${saturation})`);

  const layers: string[] = [];
  if (highlight > 0) {
    // The specular is a short fade from the top edge, not a wash over the
    // whole panel: glass catches light where it turns, not across its face.
    layers.push(
      `linear-gradient(to bottom, ${colorAtAlpha("#ffffff", highlight)} 0%, ${colorAtAlpha("#ffffff", 0)} 45%)`,
    );
  }
  const tintLayer = colorAtAlpha(tint, tintOpacity);
  layers.push(`linear-gradient(${tintLayer}, ${tintLayer})`);

  return {
    backdropFilter: backdropParts.join(" ") || "none",
    background: layers.join(", "),
    border: borderOpacity > 0 ? `1px solid ${colorAtAlpha("#ffffff", borderOpacity)}` : undefined,
    borderRadius: glass.radius !== undefined ? `${Math.max(0, glass.radius)}px` : undefined,
    boxShadow: shadow > 0 ? `0 8px 32px ${colorAtAlpha("#000000", shadow)}` : undefined,
  };
}
