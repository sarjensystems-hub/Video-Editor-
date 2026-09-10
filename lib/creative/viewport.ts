/**
 * Zoom-and-pan arithmetic for the editor canvas.
 *
 * The stage is drawn as `translate(panX, panY) scale(zoom)`, so a screen point
 * and a stage point are related by `screen = pan + stage * zoom`. Every helper
 * here is a rearrangement of that one equation, kept pure so the gesture code
 * in the component is only bookkeeping.
 */

export interface Viewport {
  zoom: number;
  panX: number;
  panY: number;
}

export const MIN_ZOOM = 0.1;
export const MAX_ZOOM = 8;

export const IDENTITY_VIEWPORT: Viewport = { zoom: 1, panX: 0, panY: 0 };

/**
 * NaN is the only input without a direction to clamp toward, so it alone falls
 * back to 1; an infinite zoom is an overflow and clamps to the bound like any
 * other out-of-range number. Degenerate gestures are rejected where they are
 * measured rather than smuggled through here as NaN.
 */
export function clampZoom(zoom: number): number {
  if (Number.isNaN(zoom)) return 1;
  return Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, zoom));
}

/**
 * The zoom at which the whole canvas is visible inside the viewport, leaving
 * `padding` device pixels of margin on the tighter axis.
 *
 * @returns 1 when either box is degenerate — a zoom derived from a zero-sized
 * viewport would be `Infinity` and blank the editor on first paint, before the
 * ResizeObserver has reported anything.
 */
export function fitZoom(
  viewportWidth: number,
  viewportHeight: number,
  canvasWidth: number,
  canvasHeight: number,
  padding = 0,
): number {
  if (viewportWidth <= 0 || viewportHeight <= 0) return 1;
  if (canvasWidth <= 0 || canvasHeight <= 0) return 1;
  const usableWidth = Math.max(1, viewportWidth - padding * 2);
  const usableHeight = Math.max(1, viewportHeight - padding * 2);
  return clampZoom(Math.min(usableWidth / canvasWidth, usableHeight / canvasHeight));
}

/** Centres a canvas of this size within the viewport at the given zoom. */
export function centerViewport(
  viewportWidth: number,
  viewportHeight: number,
  canvasWidth: number,
  canvasHeight: number,
  zoom: number,
): Viewport {
  return {
    zoom,
    panX: (viewportWidth - canvasWidth * zoom) / 2,
    panY: (viewportHeight - canvasHeight * zoom) / 2,
  };
}

/** The zoom and pan that fit the canvas and centre it in one step. */
export function fitViewport(
  viewportWidth: number,
  viewportHeight: number,
  canvasWidth: number,
  canvasHeight: number,
  padding = 0,
): Viewport {
  const zoom = fitZoom(viewportWidth, viewportHeight, canvasWidth, canvasHeight, padding);
  return centerViewport(viewportWidth, viewportHeight, canvasWidth, canvasHeight, zoom);
}

/**
 * Rescales about a fixed screen point, so the stage content under a pinch's
 * midpoint — or under the cursor during a wheel zoom — does not slide away.
 *
 * Solving `screen = pan + stage * zoom` for the stage point under `focal` and
 * requiring it to map back to the same `focal` at the new zoom gives
 * `panNext = focal - (focal - pan) * zoomNext / zoom`.
 */
export function zoomAroundPoint(
  viewport: Viewport,
  nextZoom: number,
  focalX: number,
  focalY: number,
): Viewport {
  const zoom = clampZoom(nextZoom);
  const ratio = zoom / viewport.zoom;
  return {
    zoom,
    panX: focalX - (focalX - viewport.panX) * ratio,
    panY: focalY - (focalY - viewport.panY) * ratio,
  };
}

/** Converts a screen point to stage coordinates. */
export function screenToStage(
  viewport: Viewport,
  screenX: number,
  screenY: number,
): { x: number; y: number } {
  return {
    x: (screenX - viewport.panX) / viewport.zoom,
    y: (screenY - viewport.panY) / viewport.zoom,
  };
}

export function pointerDistance(a: { x: number; y: number }, b: { x: number; y: number }): number {
  return Math.hypot(a.x - b.x, a.y - b.y);
}

export function pointerMidpoint(
  a: { x: number; y: number },
  b: { x: number; y: number },
): { x: number; y: number } {
  return { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
}
