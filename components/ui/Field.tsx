"use client";

import type { ReactNode, SelectHTMLAttributes, TextareaHTMLAttributes } from "react";
import { cn } from "./cn";

/**
 * 16px on phones is not a style choice: iOS Safari zooms the whole page when a
 * focused input's text is smaller, which throws the editor's canvas off screen.
 * The size tightens to 12px only once there is a cursor.
 */
const CONTROL =
  "w-full rounded-lg border border-field-edge bg-field text-ink " +
  "px-3 py-2.5 sm:py-1.5 text-base sm:text-xs " +
  "focus:outline-none focus:ring-2 focus:ring-fire/30 focus:border-fire/40 " +
  "transition-shadow";

export function Field({ label, children, className }: { label: ReactNode; children: ReactNode; className?: string }) {
  return (
    <label className={cn("grid gap-1.5", className)}>
      <span className="text-[10px] font-semibold uppercase tracking-[0.06em] text-ink-faint">{label}</span>
      {children}
    </label>
  );
}

/**
 * Commits on blur rather than on every keystroke: each commit is one editor
 * transaction and one undo entry, and typing "1080" should not cost four.
 * The `key` remounts the input when the value changes underneath it — the
 * canvas dragging a layer has to win over a stale uncommitted draft.
 */
export function NumberField({
  label,
  value,
  onCommit,
  min,
  max,
  step = 1,
  className,
}: {
  label: ReactNode;
  value: number;
  onCommit: (value: number) => void;
  min?: number;
  max?: number;
  step?: number;
  className?: string;
}) {
  return (
    <Field label={label} className={className}>
      <input
        key={`${value}`}
        type="number"
        inputMode="decimal"
        defaultValue={Number(value.toFixed(3))}
        min={min}
        max={max}
        step={step}
        onBlur={(event) => {
          let next = Number(event.currentTarget.value);
          if (!Number.isFinite(next)) return;
          if (min !== undefined) next = Math.max(min, next);
          if (max !== undefined) next = Math.min(max, next);
          if (next !== value) onCommit(next);
        }}
        className={cn(CONTROL, "tabular-nums")}
      />
    </Field>
  );
}

export function SelectField({
  label,
  className,
  children,
  ...rest
}: { label: ReactNode } & SelectHTMLAttributes<HTMLSelectElement>) {
  return (
    <Field label={label} className={className}>
      <select {...rest} className={CONTROL}>
        {children}
      </select>
    </Field>
  );
}

export function TextAreaField({
  label,
  className,
  ...rest
}: { label: ReactNode } & TextareaHTMLAttributes<HTMLTextAreaElement>) {
  return (
    <Field label={label} className={className}>
      <textarea {...rest} className={cn(CONTROL, "resize-y leading-relaxed")} />
    </Field>
  );
}
