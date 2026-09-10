import Image from "next/image";
import { cn } from "@/components/ui/cn";
import { BRAND } from "@/lib/brand";

/**
 * The Studio lockup, in whichever variant the background can carry.
 *
 * The wordmark in the source artwork is near-black, so on any dark surface —
 * the dark theme's chrome, or the homepage hero — it disappears and leaves the
 * orange mark floating on its own. `logo-dark.png` is the same artwork with
 * only its dark pixels lifted to the light ink token, so both variants are the
 * one logo rather than two designs.
 *
 * Both are rendered and one is hidden by CSS, so the correct variant is present
 * in the very first paint: choosing in JavaScript would flash the wrong logo
 * while the theme is still being read.
 */
export default function BrandLogo({
  className,
  /** Always use the light-ink variant, for a dark surface in either theme. */
  onDark = false,
  priority = false,
}: {
  className?: string;
  onDark?: boolean;
  priority?: boolean;
}) {
  const dimensions = { width: 1920, height: 480 };

  return (
    <span className={cn("relative block", className)}>
      <Image
        src="/logo.png"
        alt={BRAND.name}
        {...dimensions}
        priority={priority}
        className={cn("h-full w-auto object-contain", onDark ? "hidden" : "block dark:hidden")}
      />
      <Image
        src="/logo-dark.png"
        alt={BRAND.name}
        {...dimensions}
        priority={priority}
        // Decorative when it is the hidden twin of a labelled image; the alt
        // above already names the brand for assistive technology.
        aria-hidden={!onDark}
        className={cn("h-full w-auto object-contain", onDark ? "block" : "hidden dark:block")}
      />
    </span>
  );
}
