import { describe, expect, it } from "vitest";
import {
  IDENTITY_VIEWPORT,
  MAX_ZOOM,
  MIN_ZOOM,
  centerViewport,
  clampZoom,
  fitViewport,
  fitZoom,
  screenToStage,
  zoomAroundPoint,
} from "./viewport";

describe("clampZoom", () => {
  it("holds the zoom inside the usable range", () => {
    expect(clampZoom(0.0001)).toBe(MIN_ZOOM);
    expect(clampZoom(500)).toBe(MAX_ZOOM);
    expect(clampZoom(1.5)).toBe(1.5);
  });

  it("falls back to 1 rather than propagating a non-finite zoom", () => {
    expect(clampZoom(Number.NaN)).toBe(1);
    expect(clampZoom(Number.POSITIVE_INFINITY)).toBe(MAX_ZOOM);
  });
});

describe("fitZoom", () => {
  it("fits by the tighter axis", () => {
    // A 1080x1920 canvas in a wide short viewport is limited by height.
    expect(fitZoom(1000, 480, 1080, 1920)).toBeCloseTo(480 / 1920, 6);
    // ...and by width when the viewport is tall and narrow.
    expect(fitZoom(270, 2000, 1080, 1920)).toBeCloseTo(270 / 1080, 6);
  });

  it("reserves the requested padding on both sides", () => {
    expect(fitZoom(1080 + 40, 4000, 1080, 1920, 20)).toBeCloseTo(1, 6);
  });

  it("returns 1 for a viewport that has not been measured yet", () => {
    // A zero-sized viewport is what the first paint reports; dividing by it
    // would blank the editor before the ResizeObserver fires.
    expect(fitZoom(0, 0, 1080, 1920)).toBe(1);
    expect(fitZoom(800, 600, 0, 0)).toBe(1);
  });
});

describe("centerViewport", () => {
  it("splits the leftover space evenly", () => {
    const viewport = centerViewport(1000, 800, 400, 200, 1);
    expect(viewport.panX).toBe(300);
    expect(viewport.panY).toBe(300);
  });

  it("accounts for the zoom when measuring the leftover", () => {
    const viewport = centerViewport(1000, 800, 400, 200, 2);
    expect(viewport.panX).toBe(100);
    expect(viewport.panY).toBe(200);
  });
});

describe("fitViewport", () => {
  it("leaves the canvas centred and fully visible", () => {
    const viewport = fitViewport(600, 900, 1080, 1920, 12);
    const width = 1080 * viewport.zoom;
    const height = 1920 * viewport.zoom;
    expect(width).toBeLessThanOrEqual(600);
    expect(height).toBeLessThanOrEqual(900);
    expect(viewport.panX + width / 2).toBeCloseTo(300, 6);
    expect(viewport.panY + height / 2).toBeCloseTo(450, 6);
  });
});

describe("zoomAroundPoint", () => {
  it("keeps the stage point under the focal point fixed", () => {
    const before = { zoom: 1, panX: 40, panY: 90 };
    const focalX = 220;
    const focalY = 310;
    const anchored = screenToStage(before, focalX, focalY);

    const after = zoomAroundPoint(before, 2.75, focalX, focalY);

    // The same stage point must still land on the same screen pixel.
    expect(after.panX + anchored.x * after.zoom).toBeCloseTo(focalX, 6);
    expect(after.panY + anchored.y * after.zoom).toBeCloseTo(focalY, 6);
  });

  it("holds the anchor when zooming back out too", () => {
    const before = { zoom: 3, panX: -220, panY: -410 };
    const anchored = screenToStage(before, 150, 150);
    const after = zoomAroundPoint(before, 0.6, 150, 150);
    expect(after.panX + anchored.x * after.zoom).toBeCloseTo(150, 6);
    expect(after.panY + anchored.y * after.zoom).toBeCloseTo(150, 6);
  });

  it("clamps the zoom and still keeps the anchor honest", () => {
    const before = { zoom: 1, panX: 0, panY: 0 };
    const anchored = screenToStage(before, 80, 80);
    const after = zoomAroundPoint(before, 9999, 80, 80);
    expect(after.zoom).toBe(MAX_ZOOM);
    expect(after.panX + anchored.x * after.zoom).toBeCloseTo(80, 6);
  });
});

describe("screenToStage", () => {
  it("inverts the stage transform", () => {
    const viewport = { zoom: 2.5, panX: -60, panY: 25 };
    const stage = screenToStage(viewport, 190, 150);
    expect(viewport.panX + stage.x * viewport.zoom).toBeCloseTo(190, 6);
    expect(viewport.panY + stage.y * viewport.zoom).toBeCloseTo(150, 6);
  });

  it("is the identity under the identity viewport", () => {
    expect(screenToStage(IDENTITY_VIEWPORT, 12, 34)).toEqual({ x: 12, y: 34 });
  });
});
