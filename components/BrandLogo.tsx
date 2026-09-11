import { cn } from "@/components/ui/cn";
import { BRAND } from "@/lib/brand";

/**
 * The Studio lockup: an aperture mark plus the wordmark.
 *
 * Drawn rather than loaded. The artwork used to be a pair of PNGs — one per
 * theme, because the wordmark was near-black and vanished on dark ground —
 * which meant every palette change needed the images re-exported. As vector,
 * the mark reads the accent token and the wordmark inherits the surrounding
 * ink, so the lockup follows the theme instead of being re-cut for it.
 *
 * `className` sets the height; everything scales from there.
 */
export default function BrandLogo({
  className,
  /** Always use light ink, for a dark surface in either theme. */
  onDark = false,
}: {
  className?: string;
  onDark?: boolean;
  /** Accepted for call-site compatibility; a drawn mark has nothing to preload. */
  priority?: boolean;
}) {
  return (
    <span className={cn("inline-flex items-center gap-2.5", className)} aria-label={BRAND.name}>
      <svg
        viewBox="0 0 32 32"
        role="presentation"
        className="h-full w-auto shrink-0"
        style={{ aspectRatio: "1 / 1" }}
      >
        <defs>
          <linearGradient id="brand-mark" x1="0" y1="0" x2="1" y2="1">
            <stop offset="0%" stopColor="var(--fire)" />
            <stop offset="100%" stopColor="var(--fire-hover)" />
          </linearGradient>
        </defs>
        <rect x="0" y="0" width="32" height="32" rx="9" fill="url(#brand-mark)" />
        {/* Aperture: a play triangle cut out of the corner blade. */}
        <path d="M13 10.2 L22.4 16 L13 21.8 Z" fill="white" fillOpacity="0.95" />
        <path d="M9.4 10.2 L11.6 10.2 L11.6 21.8 L9.4 21.8 Z" fill="white" fillOpacity="0.45" />
      </svg>
      <span
        className="font-display text-[17px] font-bold leading-none tracking-[-0.02em]"
        style={{ color: onDark ? "var(--chalk)" : "var(--ink)" }}
      >
        {BRAND.name}
      </span>
    </span>
  );
}
