"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type { PointerEvent as ReactPointerEvent, ReactNode } from "react";
import { createPortal } from "react-dom";
import { X } from "lucide-react";
import { IconButton } from "./Button";
import { cn } from "./cn";

/** Past this many pixels of downward drag, releasing dismisses the sheet. */
const DISMISS_AFTER_PX = 110;

/**
 * A bottom sheet: the phone's answer to a sidebar.
 *
 * It is portalled to `document.body` so no ancestor's `overflow` or stacking
 * context can clip it — the editor canvas that opens these sheets is itself a
 * clipped, transformed surface.
 */
export default function Sheet({
  open,
  onClose,
  title,
  children,
  footer,
}: {
  open: boolean;
  onClose: () => void;
  title: ReactNode;
  children: ReactNode;
  footer?: ReactNode;
}) {
  const [mounted, setMounted] = useState(false);
  const [dragY, setDragY] = useState(0);
  const [dragging, setDragging] = useState(false);
  const dragFrom = useRef<number | null>(null);
  const panelRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => setMounted(true), []);

  useEffect(() => {
    if (!open) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    // Locking the page keeps a scroll gesture inside the sheet instead of
    // dragging the canvas around behind it.
    const previous = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      window.removeEventListener("keydown", onKey);
      document.body.style.overflow = previous;
    };
  }, [open, onClose]);

  useEffect(() => {
    if (open) {
      setDragY(0);
      setDragging(false);
      dragFrom.current = null;
      panelRef.current?.focus();
    }
  }, [open]);

  const startDrag = useCallback((event: ReactPointerEvent<HTMLDivElement>) => {
    // Drag-to-dismiss is a bottom-sheet gesture; the desktop drawer slides
    // sideways and would fight a vertical drag.
    if (event.pointerType === "mouse") return;
    dragFrom.current = event.clientY;
    setDragging(true);
    event.currentTarget.setPointerCapture(event.pointerId);
  }, []);

  const moveDrag = useCallback((event: ReactPointerEvent<HTMLDivElement>) => {
    if (dragFrom.current == null) return;
    // Only downward drag counts; pulling up must not stretch the sheet.
    setDragY(Math.max(0, event.clientY - dragFrom.current));
  }, []);

  const endDrag = useCallback(() => {
    if (dragFrom.current == null) return;
    dragFrom.current = null;
    setDragging(false);
    // Read the travel outside the state updater: an updater must stay pure, and
    // closing from inside one fires twice under StrictMode.
    const dismissed = dragY > DISMISS_AFTER_PX;
    setDragY(0);
    if (dismissed) onClose();
  }, [dragY, onClose]);

  if (!mounted) return null;

  return createPortal(
    <div className={cn("fixed inset-0 z-50", !open && "pointer-events-none")} aria-hidden={!open}>
      <div
        onClick={onClose}
        className={cn(
          "absolute inset-0 bg-overlay transition-opacity duration-200",
          open ? "opacity-100" : "opacity-0",
        )}
      />

      <div
        ref={panelRef}
        role="dialog"
        aria-modal="true"
        aria-label={typeof title === "string" ? title : undefined}
        tabIndex={-1}
        style={{ transform: open ? `translate(0, ${dragY}px)` : undefined }}
        className={cn(
          "absolute flex flex-col bg-sheet shadow-lg outline-none",
          // Phone: a sheet rising from the bottom edge, within thumb reach.
          "inset-x-0 bottom-0 max-h-[85dvh] rounded-t-2xl border-t border-edge",
          // Desktop: a drawer down the right edge, so the stage keeps the
          // middle of the screen instead of being covered by a centred dialog.
          "lg:inset-y-0 lg:left-auto lg:right-0 lg:w-[26rem] lg:max-h-none lg:rounded-l-2xl lg:rounded-tr-none lg:border-l lg:border-t-0",
          !open && "translate-y-full lg:translate-x-full lg:translate-y-0",
          // No transition mid-drag: the sheet must track the finger exactly.
          !dragging && "transition-transform duration-200 ease-out",
        )}
      >
        <div
          onPointerDown={startDrag}
          onPointerMove={moveDrag}
          onPointerUp={endDrag}
          onPointerCancel={endDrag}
          className="shrink-0 cursor-grab touch-none px-4 pb-2 pt-3 active:cursor-grabbing lg:cursor-default"
        >
          {/* The grab handle is a touch affordance; a mouse gets the close button. */}
          <div className="mx-auto h-1 w-10 rounded-full bg-sheet-grip lg:hidden" />
          <div className="mt-3 flex items-center justify-between gap-3 lg:mt-0">
            <h2 className="text-sm font-bold text-ink">{title}</h2>
            <IconButton label="Close" size="sm" onClick={onClose}>
              <X className="h-4 w-4" />
            </IconButton>
          </div>
        </div>

        <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain px-4 pb-2">{children}</div>

        {footer && (
          <div className="shrink-0 border-t border-edge-faint px-4 pt-3">{footer}</div>
        )}

        {/* Clears the iOS home indicator so the last row stays tappable. */}
        <div className="h-[max(0.75rem,env(safe-area-inset-bottom))] shrink-0" />
      </div>
    </div>,
    document.body,
  );
}
