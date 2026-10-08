"use client";

import { useState } from "react";
import { useFormStatus } from "react-dom";
import { Loader2, Plus } from "lucide-react";
import { Button } from "@/components/ui/Button";
import Sheet from "@/components/ui/Sheet";
import { cn } from "@/components/ui/cn";
import {
  CREATIVE_CANVAS_FORMATS,
  CREATIVE_CANVAS_FORMAT_IDS,
  DEFAULT_CREATIVE_CANVAS_FORMAT,
  type CreativeCanvasFormat,
} from "@/lib/creative/canvas-formats";

function CreateButton() {
  const { pending } = useFormStatus();
  return (
    <Button type="submit" size="sm" disabled={pending}>
      {pending && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
      {pending ? "Creating…" : "Create"}
    </Button>
  );
}

/** A frame drawn at the format's real proportions, so the choice is visible. */
function FrameShape({ format, active }: { format: CreativeCanvasFormat; active: boolean }) {
  const { width, height } = CREATIVE_CANVAS_FORMATS[format];
  const scale = 44 / Math.max(width, height);
  return (
    <span className="grid h-12 w-12 shrink-0 place-items-center">
      <span
        className={cn("rounded-[5px] border-2", active ? "border-fire bg-fire-wash" : "border-ink-faint")}
        style={{ width: Math.round(width * scale), height: Math.round(height * scale) }}
      />
    </span>
  );
}

/**
 * "New creative" asks for the frame shape first. A canvas can be resized
 * later, but layers are not repositioned when it is, so the shape is worth
 * choosing before anything is placed.
 */
export default function NewCreativeButton({ action }: { action: (formData: FormData) => Promise<void> }) {
  const [open, setOpen] = useState(false);
  const [format, setFormat] = useState<CreativeCanvasFormat>(DEFAULT_CREATIVE_CANVAS_FORMAT);

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="inline-flex h-11 items-center gap-2 rounded-xl bg-fire px-4 text-sm font-semibold text-white transition-colors hover:bg-fire-hover focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-fire/40 sm:h-9"
      >
        <Plus className="h-4 w-4" /> New creative
      </button>

      <Sheet open={open} onClose={() => setOpen(false)} title="New creative">
        <form action={action} className="grid gap-4">
          <label className="grid gap-1.5">
            <span className="text-[10px] font-semibold uppercase tracking-[0.06em] text-ink-faint">Name</span>
            <input
              name="title"
              placeholder="Untitled creative"
              maxLength={140}
              className="w-full rounded-lg border border-field-edge bg-field px-3 py-2.5 text-base text-ink focus:border-fire/40 focus:outline-none focus:ring-2 focus:ring-fire/30 sm:py-1.5 sm:text-xs"
            />
          </label>

          <fieldset className="grid gap-2">
            <legend className="mb-1.5 text-[10px] font-semibold uppercase tracking-[0.06em] text-ink-faint">
              Format
            </legend>
            <input type="hidden" name="format" value={format} />
            <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
              {CREATIVE_CANVAS_FORMAT_IDS.map((id) => {
                const item = CREATIVE_CANVAS_FORMATS[id];
                const active = format === id;
                return (
                  <button
                    key={id}
                    type="button"
                    onClick={() => setFormat(id)}
                    aria-pressed={active}
                    className={cn(
                      "flex items-center gap-3 rounded-xl border p-3 text-left transition-colors",
                      "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-fire/40",
                      active ? "border-fire/60 bg-fire-wash" : "border-edge hover:bg-canvas-subtle",
                    )}
                  >
                    <FrameShape format={id} active={active} />
                    <span className="min-w-0">
                      <span className="block text-sm font-semibold text-ink">
                        {id} <span className="font-medium text-ink-muted">· {item.label}</span>
                      </span>
                      <span className="block text-[11px] leading-snug text-ink-faint">{item.hint}</span>
                      <span className="block text-[10px] tabular-nums text-ink-faint">
                        {item.width} × {item.height}
                      </span>
                    </span>
                  </button>
                );
              })}
            </div>
          </fieldset>

          <div className="flex justify-end gap-2">
            <Button type="button" variant="ghost" size="sm" onClick={() => setOpen(false)}>
              Cancel
            </Button>
            <CreateButton />
          </div>
        </form>
      </Sheet>
    </>
  );
}
