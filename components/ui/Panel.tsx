import type { ReactNode } from "react";
import { cn } from "./cn";

/**
 * A titled surface. Panels are placement-agnostic on purpose: the same panel is
 * a sidebar column on desktop and the body of a bottom sheet on a phone, so it
 * owns no outer margin and no width.
 */
export function Panel({
  title,
  actions,
  children,
  className,
  bare,
}: {
  title?: ReactNode;
  actions?: ReactNode;
  children: ReactNode;
  className?: string;
  /** Drops the border and background — for a panel already inside a sheet. */
  bare?: boolean;
}) {
  return (
    <section className={cn(bare ? "" : "rounded-2xl border border-edge bg-panel", className)}>
      {(title || actions) && (
        <header className={cn("flex items-center justify-between gap-3", bare ? "mb-3" : "px-4 pt-3.5 pb-2")}>
          {title && <PanelTitle>{title}</PanelTitle>}
          {actions && <div className="flex shrink-0 items-center gap-1.5">{actions}</div>}
        </header>
      )}
      <div className={cn(bare ? "" : "px-4 pb-4", !title && !actions && !bare && "pt-4")}>{children}</div>
    </section>
  );
}

export function PanelTitle({ children }: { children: ReactNode }) {
  return (
    <h2 className="min-w-0 truncate text-[11px] font-bold uppercase tracking-[0.08em] text-ink-faint">
      {children}
    </h2>
  );
}

export function EmptyNote({ children }: { children: ReactNode }) {
  return <p className="text-xs leading-relaxed text-ink-faint">{children}</p>;
}
