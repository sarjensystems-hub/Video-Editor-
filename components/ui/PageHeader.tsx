import type { ReactNode } from "react";
import { cn } from "./cn";

/**
 * The masthead every workspace page opens with.
 *
 * Pages used to each invent their own heading block, which is why Settings,
 * Videos and Creative Studio all sat at slightly different sizes and margins.
 * One component means one rhythm: accent eyebrow, display title, one line of
 * explanation, actions pinned right.
 */
export default function PageHeader({
  eyebrow,
  title,
  description,
  actions,
  className,
}: {
  eyebrow?: string;
  title: string;
  description?: ReactNode;
  actions?: ReactNode;
  className?: string;
}) {
  return (
    <header className={cn("mb-6 flex flex-wrap items-end justify-between gap-4", className)}>
      <div className="min-w-0">
        {eyebrow && (
          <p className="text-[10px] font-bold uppercase tracking-[0.18em] text-fire">{eyebrow}</p>
        )}
        <h1 className="mt-1.5 font-display text-2xl font-bold tracking-tight text-ink">{title}</h1>
        {description && (
          <p className="mt-1.5 max-w-2xl text-sm leading-relaxed text-ink-muted">{description}</p>
        )}
      </div>
      {actions && <div className="flex shrink-0 items-center gap-2">{actions}</div>}
    </header>
  );
}
