"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { PointerEvent as ReactPointerEvent, WheelEvent as ReactWheelEvent } from "react";
import { Maximize2, Minus, Plus } from "lucide-react";
import { IconButton } from "@/components/ui/Button";
import { cn } from "@/components/ui/cn";
import CreativeScenePreview, { type CreativePreviewAssets } from "./CreativeScenePreview";
import type { CreativeDocument, CreativeTransform } from "@/lib/creative/schema";
import type { CreativeTransaction } from "@/lib/creative/transactions";
import {
  type Viewport,
  clampZoom,
  fitViewport,
  pointerDistance,
  pointerMidpoint,
  zoomAroundPoint,
} from "@/lib/creative/viewport";

/**
 * Breathing room between the artwork and the stage edge, in screen pixels.
 * Kept tight on purpose: the artwork is the subject, and every pixel of margin
 * is a pixel it is not being shown at.
 */
const FIT_PADDING = 14;

/** Below this much finger travel a touch counts as a tap, not a drag. */
const TAP_SLOP_PX = 6;

interface DragState {
  pointerId: number;
  mode: "move" | "resize";
  elementId: string;
  startClientX: number;
  startClientY: number;
  moved: boolean;
  start: CreativeTransform;
  draft: CreativeTransform;
}

interface PinchState {
  startDistance: number;
  startZoom: number;
}

export default function CreativeEditorCanvas({
  document: doc,
  sceneId,
  timeMs,
  assets,
  selectedIds,
  onSelect,
  onTransaction,
  className,
}: {
  document: CreativeDocument;
  sceneId: string;
  timeMs: number;
  assets: CreativePreviewAssets;
  selectedIds: string[];
  onSelect: (ids: string[]) => void;
  onTransaction: (transaction: CreativeTransaction) => void;
  className?: string;
}) {
  const scene = doc.scenes.find((item) => item.id === sceneId) ?? doc.scenes[0];
  const viewportRef = useRef<HTMLDivElement | null>(null);
  const stageRef = useRef<HTMLDivElement | null>(null);

  const [viewport, setViewport] = useState<Viewport>({ zoom: 1, panX: 0, panY: 0 });
  const [drag, setDrag] = useState<DragState | null>(null);

  // Live pointers, keyed by id. Two of them means a pinch, whatever either one
  // started out doing.
  const pointers = useRef(new Map<number, { x: number; y: number }>());
  const pinch = useRef<PinchState | null>(null);
  const panFrom = useRef<{ x: number; y: number; panX: number; panY: number } | null>(null);

  const canvasWidth = doc.canvas.width;
  const canvasHeight = doc.canvas.height;

  // Whether the view on screen is the automatic fit or something the user
  // chose. Framing someone set by hand outranks any later relayout.
  const userAdjusted = useRef(false);

  const fit = useCallback(() => {
    const box = viewportRef.current?.getBoundingClientRect();
    if (!box || box.width <= 0 || box.height <= 0) return;
    userAdjusted.current = false;
    setViewport(fitViewport(box.width, box.height, canvasWidth, canvasHeight, FIT_PADDING));
  }, [canvasWidth, canvasHeight]);

  useEffect(() => {
    const node = viewportRef.current;
    if (!node) return;
    fit();
    // The first measurement often predates the final layout, and a phone can
    // rotate or surrender height to a keyboard at any time — so keep refitting
    // while the view is still automatic, and stop the moment it is not.
    const observer = new ResizeObserver(() => {
      if (!userAdjusted.current) fit();
    });
    observer.observe(node);
    return () => observer.disconnect();
  }, [fit]);

  const zoomBy = useCallback((factor: number) => {
    const box = viewportRef.current?.getBoundingClientRect();
    if (!box) return;
    userAdjusted.current = true;
    setViewport((current) =>
      zoomAroundPoint(current, current.zoom * factor, box.width / 2, box.height / 2),
    );
  }, []);

  const overlayTransforms = useMemo(() => {
    const map = new Map<string, CreativeTransform>();
    for (const element of scene.elements) map.set(element.id, element.transform);
    if (drag) map.set(drag.elementId, drag.draft);
    return map;
  }, [scene.elements, drag]);

  /** Screen delta → stage delta. The stage rect already includes the zoom. */
  const toCanvasDelta = useCallback(
    (dx: number, dy: number) => {
      const rect = stageRef.current?.getBoundingClientRect();
      if (!rect || rect.width <= 0 || rect.height <= 0) return null;
      return { dx: (dx * canvasWidth) / rect.width, dy: (dy * canvasHeight) / rect.height };
    },
    [canvasWidth, canvasHeight],
  );

  const endPinch = useCallback(() => {
    pinch.current = null;
    panFrom.current = null;
  }, []);

  const trackPointerDown = useCallback(
    (event: ReactPointerEvent) => {
      pointers.current.set(event.pointerId, { x: event.clientX, y: event.clientY });
      if (pointers.current.size === 2) {
        const [a, b] = [...pointers.current.values()];
        const distance = pointerDistance(a, b);
        // A zero-distance pinch has no scale to derive; ignore it rather than
        // letting an infinite ratio through to the zoom.
        if (distance > 0) {
          pinch.current = { startDistance: distance, startZoom: viewport.zoom };
          const box = viewportRef.current?.getBoundingClientRect();
          const mid = pointerMidpoint(a, b);
          if (box) {
            panFrom.current = {
              x: mid.x - box.left,
              y: mid.y - box.top,
              panX: viewport.panX,
              panY: viewport.panY,
            };
          }
        }
        // A second finger converts an in-flight layer drag into a pinch; the
        // half-finished move is dropped rather than committed.
        setDrag(null);
      }
    },
    [viewport],
  );

  const trackPointerUp = useCallback(
    (event: ReactPointerEvent) => {
      pointers.current.delete(event.pointerId);
      if (pointers.current.size < 2) endPinch();
    },
    [endPinch],
  );

  const handlePinchMove = useCallback((event: ReactPointerEvent) => {
    if (!pointers.current.has(event.pointerId)) return false;
    pointers.current.set(event.pointerId, { x: event.clientX, y: event.clientY });
    if (pointers.current.size < 2 || !pinch.current || !panFrom.current) return false;

    const [a, b] = [...pointers.current.values()];
    const distance = pointerDistance(a, b);
    if (distance <= 0) return true;

    const box = viewportRef.current?.getBoundingClientRect();
    if (!box) return true;

    const mid = pointerMidpoint(a, b);
    const focalX = mid.x - box.left;
    const focalY = mid.y - box.top;
    const start = panFrom.current;
    userAdjusted.current = true;
    const nextZoom = clampZoom(pinch.current.startZoom * (distance / pinch.current.startDistance));

    setViewport((current) => {
      // Scale about the gesture's own midpoint, then carry the pan by however
      // far that midpoint has travelled — pinch and drag in one motion.
      const scaled = zoomAroundPoint(current, nextZoom, focalX, focalY);
      return {
        zoom: scaled.zoom,
        panX: scaled.panX + (focalX - start.x),
        panY: scaled.panY + (focalY - start.y),
      };
    });
    panFrom.current = { ...start, x: focalX, y: focalY };
    return true;
  }, []);

  const startDrag = (
    event: ReactPointerEvent<HTMLDivElement>,
    elementId: string,
    mode: "move" | "resize",
  ) => {
    trackPointerDown(event);
    if (pointers.current.size > 1) return;
    event.stopPropagation();

    const element = scene.elements.find((item) => item.id === elementId);
    if (!element) return;

    const multi = event.shiftKey;
    const selected = selectedIds.includes(elementId);
    onSelect(
      multi
        ? selected
          ? selectedIds.filter((id) => id !== elementId)
          : [...selectedIds, elementId]
        : [elementId],
    );
    if (element.locked || (multi && !selected)) return;

    event.currentTarget.setPointerCapture(event.pointerId);
    setDrag({
      pointerId: event.pointerId,
      mode,
      elementId,
      startClientX: event.clientX,
      startClientY: event.clientY,
      moved: false,
      start: { ...element.transform },
      draft: { ...element.transform },
    });
  };

  const moveDrag = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (handlePinchMove(event)) return;
    if (!drag || event.pointerId !== drag.pointerId) return;

    const screenDx = event.clientX - drag.startClientX;
    const screenDy = event.clientY - drag.startClientY;
    // Under the slop threshold this is still a tap; committing here would turn
    // every selection tap into a one-pixel move in the undo history.
    const moved = drag.moved || Math.hypot(screenDx, screenDy) > TAP_SLOP_PX;
    if (!moved) return;

    const delta = toCanvasDelta(screenDx, screenDy);
    if (!delta) return;

    const draft =
      drag.mode === "move"
        ? { ...drag.start, x: drag.start.x + delta.dx, y: drag.start.y + delta.dy }
        : {
            ...drag.start,
            width: Math.max(10, drag.start.width + delta.dx),
            height: Math.max(10, drag.start.height + delta.dy),
          };
    setDrag({ ...drag, moved: true, draft });
  };

  const finishDrag = (event: ReactPointerEvent<HTMLDivElement>) => {
    trackPointerUp(event);
    if (!drag || event.pointerId !== drag.pointerId) return;
    const { draft, start, mode, elementId, moved } = drag;
    setDrag(null);
    if (!moved) return;

    if (mode === "move" && (draft.x !== start.x || draft.y !== start.y)) {
      onTransaction({
        summary: "Move layer",
        operations: [
          { type: "move_element", sceneId: scene.id, elementId, x: Math.round(draft.x), y: Math.round(draft.y) },
        ],
      });
    }
    if (mode === "resize" && (draft.width !== start.width || draft.height !== start.height)) {
      onTransaction({
        summary: "Resize layer",
        operations: [
          {
            type: "resize_element",
            sceneId: scene.id,
            elementId,
            width: Math.round(draft.width),
            height: Math.round(draft.height),
          },
        ],
      });
    }
  };

  /** Trackpad pinch arrives as ctrl+wheel; a plain wheel scrolls the stage. */
  const onWheel = (event: ReactWheelEvent<HTMLDivElement>) => {
    const box = viewportRef.current?.getBoundingClientRect();
    if (!box) return;
    userAdjusted.current = true;
    if (event.ctrlKey || event.metaKey) {
      const focalX = event.clientX - box.left;
      const focalY = event.clientY - box.top;
      setViewport((current) =>
        zoomAroundPoint(current, current.zoom * Math.exp(-event.deltaY / 220), focalX, focalY),
      );
      return;
    }
    setViewport((current) => ({
      ...current,
      panX: current.panX - event.deltaX,
      panY: current.panY - event.deltaY,
    }));
  };

  const zoomPercent = Math.round(viewport.zoom * 100);

  return (
    // No frame and no rounding: the stage is the room the artwork hangs in, so
    // it runs to the edges of whatever the caller gives it. Positioning comes
    // from the caller too, and an absolute box still establishes the containing
    // block its own zoom controls are positioned against.
    <div className={cn("overflow-hidden bg-stage", className)}>
      <div
        ref={viewportRef}
        onPointerDown={(event) => {
          trackPointerDown(event);
          if (pointers.current.size === 1) onSelect([]);
        }}
        onPointerMove={moveDrag}
        onPointerUp={trackPointerUp}
        onPointerCancel={trackPointerUp}
        onWheel={onWheel}
        // `touch-none` hands every gesture to us; without it the browser
        // scrolls and pinch-zooms the page instead of the canvas.
        className="relative h-full w-full touch-none overflow-hidden bg-stage"
      >
        <div
          ref={stageRef}
          style={{
            width: canvasWidth,
            height: canvasHeight,
            transform: `translate(${viewport.panX}px, ${viewport.panY}px) scale(${viewport.zoom})`,
            transformOrigin: "0 0",
            // Divided by the zoom so the hairline and the lift stay the same
            // on screen at any scale. They are what make the artwork read as a
            // screen sitting in the room rather than a hole cut into it.
            boxShadow: `0 0 0 ${1 / viewport.zoom}px rgba(255,255,255,0.14), 0 ${28 / viewport.zoom}px ${90 / viewport.zoom}px rgba(0,0,0,0.55)`,
          }}
          className="absolute left-0 top-0 origin-top-left will-change-transform"
        >
          <CreativeScenePreview document={doc} sceneId={scene.id} timeMs={timeMs} assets={assets} />

          <div className="absolute inset-0">
            {scene.elements
              .filter((element) => !element.hidden)
              .map((element) => {
                const transform = overlayTransforms.get(element.id) ?? element.transform;
                const selected = selectedIds.includes(element.id);
                // Rings and handles are drawn in stage units, so dividing by the
                // zoom keeps them a constant thickness on screen at any scale.
                const px = (value: number) => value / viewport.zoom;
                return (
                  <div
                    key={element.id}
                    onPointerDown={(event) => startDrag(event, element.id, "move")}
                    onPointerMove={moveDrag}
                    onPointerUp={finishDrag}
                    onPointerCancel={finishDrag}
                    title={element.name}
                    style={{
                      left: `${(transform.x / canvasWidth) * 100}%`,
                      top: `${(transform.y / canvasHeight) * 100}%`,
                      width: `${(transform.width / canvasWidth) * 100}%`,
                      height: `${(transform.height / canvasHeight) * 100}%`,
                      transformOrigin: `${transform.anchorX * 100}% ${transform.anchorY * 100}%`,
                      transform: `rotate(${transform.rotation}deg)`,
                      outline: selected ? `${px(2)}px solid var(--select)` : "none",
                      cursor: element.locked ? "default" : drag?.elementId === element.id ? "grabbing" : "grab",
                    }}
                    className="absolute box-border"
                  >
                    {selected && (
                      <span
                        style={{
                          top: px(-26),
                          padding: `${px(3)}px ${px(7)}px`,
                          borderRadius: px(5),
                          fontSize: px(11),
                        }}
                        className="pointer-events-none absolute left-0 whitespace-nowrap bg-select font-semibold leading-none text-select-ink"
                      >
                        {element.name}
                        {element.locked ? " · locked" : ""}
                      </span>
                    )}

                    {selected && !element.locked && selectedIds.length === 1 && (
                      <div
                        onPointerDown={(event) => startDrag(event, element.id, "resize")}
                        onPointerMove={moveDrag}
                        onPointerUp={finishDrag}
                        onPointerCancel={finishDrag}
                        // The hit area is a finger wide; only the inner square
                        // is painted, so the handle looks small and grabs big.
                        style={{
                          right: px(-22),
                          bottom: px(-22),
                          width: px(44),
                          height: px(44),
                        }}
                        className="absolute grid cursor-nwse-resize place-items-center"
                      >
                        <span
                          style={{ width: px(14), height: px(14), borderWidth: px(2), borderRadius: px(4) }}
                          className="block border-white bg-select"
                        />
                      </div>
                    )}
                  </div>
                );
              })}
          </div>
        </div>
      </div>

      {/* Controls float over the stage on their own dark chip so they never
          claim a strip of the room the artwork could have used. */}
      <div className="pointer-events-none absolute inset-x-0 bottom-0 flex items-end justify-between gap-2 p-3">
        <span className="rounded-full bg-black/50 px-2.5 py-1 text-[10px] font-semibold tabular-nums text-white/70 backdrop-blur-sm">
          {zoomPercent}%
        </span>
        <div className="pointer-events-auto flex items-center gap-1 rounded-full bg-black/50 p-1 backdrop-blur-sm">
          <IconButton
            label="Zoom out"
            size="sm"
            variant="subtle"
            className="!bg-transparent !text-white/70 hover:!bg-white/10 hover:!text-white"
            onClick={() => zoomBy(1 / 1.25)}
          >
            <Minus className="h-4 w-4" />
          </IconButton>
          <IconButton
            label="Fit to screen"
            size="sm"
            variant="subtle"
            className="!bg-transparent !text-white/70 hover:!bg-white/10 hover:!text-white"
            onClick={fit}
          >
            <Maximize2 className="h-4 w-4" />
          </IconButton>
          <IconButton
            label="Zoom in"
            size="sm"
            variant="subtle"
            className="!bg-transparent !text-white/70 hover:!bg-white/10 hover:!text-white"
            onClick={() => zoomBy(1.25)}
          >
            <Plus className="h-4 w-4" />
          </IconButton>
        </div>
      </div>
    </div>
  );
}
