"use client";

import { forwardRef } from "react";
import type { ButtonHTMLAttributes } from "react";
import { cn } from "./cn";

export type ButtonVariant = "primary" | "ghost" | "subtle" | "danger";
export type ButtonSize = "sm" | "md";

const VARIANTS: Record<ButtonVariant, string> = {
  primary: "bg-fire text-white hover:bg-fire-hover border border-transparent",
  ghost: "bg-transparent text-ink-muted hover:text-ink hover:bg-canvas-subtle border border-edge",
  subtle: "bg-canvas-subtle text-ink-muted hover:text-ink hover:bg-canvas-muted border border-transparent",
  danger: "bg-danger-wash text-danger hover:brightness-110 border border-transparent",
};

/**
 * Touch targets are 44px on phones and tighten to 36px only from `sm` up.
 * A control that is comfortable under a thumb is oversized under a cursor, so
 * the size is a function of the pointer rather than a single compromise.
 */
const SIZES: Record<ButtonSize, string> = {
  sm: "h-10 sm:h-8 px-3 text-xs gap-1.5 rounded-lg",
  md: "h-11 sm:h-9 px-4 text-sm gap-2 rounded-xl",
};

const BASE =
  "inline-flex items-center justify-center font-semibold whitespace-nowrap " +
  "transition-colors duration-150 select-none " +
  "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-fire/40 " +
  "disabled:opacity-40 disabled:pointer-events-none";

export interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: ButtonVariant;
  size?: ButtonSize;
  /** Stretches to the container width — useful inside sheets and stacked forms. */
  block?: boolean;
}

export const Button = forwardRef<HTMLButtonElement, ButtonProps>(function Button(
  { variant = "ghost", size = "md", block, className, type = "button", ...rest },
  ref,
) {
  return (
    <button
      ref={ref}
      type={type}
      className={cn(BASE, VARIANTS[variant], SIZES[size], block && "w-full", className)}
      {...rest}
    />
  );
});

const ICON_SIZES: Record<ButtonSize, string> = {
  sm: "h-9 w-9 sm:h-8 sm:w-8 rounded-lg",
  md: "h-11 w-11 sm:h-9 sm:w-9 rounded-xl",
};

export interface IconButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: ButtonVariant;
  size?: ButtonSize;
  /** Required: an icon alone gives a screen reader nothing to announce. */
  label: string;
}

export const IconButton = forwardRef<HTMLButtonElement, IconButtonProps>(function IconButton(
  { variant = "ghost", size = "md", label, className, type = "button", ...rest },
  ref,
) {
  return (
    <button
      ref={ref}
      type={type}
      aria-label={label}
      title={label}
      className={cn(BASE, VARIANTS[variant], ICON_SIZES[size], "p-0 shrink-0", className)}
      {...rest}
    />
  );
});
