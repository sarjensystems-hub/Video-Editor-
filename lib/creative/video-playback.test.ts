import { describe, expect, it } from "vitest";
import type { CreativeVideoElement } from "./schema";
import { resolveClipSourceTimeMs } from "./speed-ramp";
import { resolveVideoPlaybackPlan, resolveVideoSourceTimeMs } from "./video-playback";

function video(overrides: Partial<CreativeVideoElement> = {}): CreativeVideoElement {
  return {
    id: "clip",
    name: "clip",
    type: "video",
    assetId: "asset",
    sourceStartMs: 5000,
    sourceEndMs: 11000,
    fit: "cover",
    volume: 0,
    playbackRate: 1,
    transform: {
      x: 0,
      y: 0,
      width: 1080,
      height: 1920,
      rotation: 0,
      opacity: 1,
      anchorX: 0.5,
      anchorY: 0.5,
      zIndex: 0,
    },
    ...overrides,
  };
}

describe("video source-time parity", () => {
  it("freezes at the requested absolute source time without adding sourceStart twice", () => {
    const element = video({ sourceStartMs: 7000, sourceEndMs: 13000, freezeAtSourceMs: 8500 });
    expect(resolveVideoSourceTimeMs(element, 3000)).toBe(8500);
    expect(resolveVideoPlaybackPlan(element, 3000, 30)).toEqual({
      mode: "exact-frame",
      sourceFrame: 255,
      trimBefore: 255,
      trimAfter: 256,
      freezeFrame: 0,
    });
  });

  it("uses the integrated speed-ramp source position for both preview and render", () => {
    const element = video({
      speedRamp: {
        keyframes: [
          { atMs: 0, speed: 0.7 },
          { atMs: 1600, speed: 2.4 },
          { atMs: 3600, speed: 0.45 },
          { atMs: 6000, speed: 1 },
        ],
      },
    });
    const localMs = 3000;
    const expectedSourceMs = resolveClipSourceTimeMs(element, localMs);
    const expectedSourceFrame = Math.max(0, Math.round((expectedSourceMs / 1000) * 30));

    expect(resolveVideoSourceTimeMs(element, localMs)).toBeCloseTo(expectedSourceMs, 8);
    expect(resolveVideoPlaybackPlan(element, localMs, 30)).toEqual({
      mode: "exact-frame",
      sourceFrame: expectedSourceFrame,
      trimBefore: expectedSourceFrame,
      trimAfter: expectedSourceFrame + 1,
      freezeFrame: 0,
    });
  });

  it("keeps unmodified clips on continuous playback with their source trim", () => {
    const element = video({ sourceStartMs: 2000, sourceEndMs: 9000 });
    expect(resolveVideoSourceTimeMs(element, 1000)).toBe(3000);
    expect(resolveVideoPlaybackPlan(element, 1000, 30)).toEqual({
      mode: "continuous",
      trimBefore: 60,
      trimAfter: 270,
      playbackRate: 1,
    });
  });

  it("seeks a rate-changed clip instead of handing the rate to the player", () => {
    // This asserted `mode: "continuous", playbackRate: 1.5` and passed, because
    // it only checked that a plan came back. In the renderer the source still
    // advanced 1:1 and trimAfter truncated, so the clip ran out of footage
    // partway through its scene and the rest of the scene rendered black.
    const element = video({ sourceStartMs: 2000, sourceEndMs: 9000, playbackRate: 1.5 });
    expect(resolveVideoSourceTimeMs(element, 1000)).toBe(3500);
    expect(resolveVideoPlaybackPlan(element, 1000, 30)).toEqual({
      mode: "exact-frame",
      sourceFrame: 105,
      trimBefore: 105,
      trimAfter: 106,
      freezeFrame: 0,
    });
  });

  it("holds a slowed clip inside its source window for the whole scene", () => {
    // The end card that shipped black: playbackRate 0.5 over 13300-15000ms
    // under a 3400ms scene. Half speed consumes exactly the 1700ms window, so
    // every moment of the scene has real footage behind it — the engine just
    // was not asking for it.
    const element = video({ sourceStartMs: 13_300, sourceEndMs: 15_000, playbackRate: 0.5 });
    for (const localMs of [0, 850, 1700, 2550, 3400]) {
      const sourceMs = resolveVideoSourceTimeMs(element, localMs);
      expect(sourceMs).toBeGreaterThanOrEqual(13_300);
      expect(sourceMs).toBeLessThanOrEqual(15_000);

      const plan = resolveVideoPlaybackPlan(element, localMs, 30);
      expect(plan.mode).toBe("exact-frame");
      expect(plan.trimBefore).toBe(Math.round((sourceMs / 1000) * 30));
    }
  });

  it("does not push an ordinary clip onto the expensive per-frame path", () => {
    // Exact-frame seeking costs a trim per frame. It buys correctness where the
    // rate is not 1 and nothing anywhere else, so rate 1 must stay continuous.
    expect(resolveVideoPlaybackPlan(video(), 1000, 30).mode).toBe("continuous");
  });
});

/**
 * Preview/render parity for video timing.
 *
 * Every other module the two renderers share is consumed through the same
 * function by both. `video-playback` is the exception: the browser preview
 * seeks a `<video>` by time via `resolveVideoSourceTimeMs`, while Remotion
 * trims by frame via `resolveVideoPlaybackPlan`. Two expressions of one
 * decision is a place they can silently disagree — and they did. Before the
 * rate fix the preview showed the correct frame while the render showed black,
 * which is the single worst failure this product can have: a still that lies
 * about its own MP4.
 *
 * So the invariant is asserted directly rather than assumed from the fact that
 * one function calls the other.
 */
describe("the preview and the renderer resolve the same source moment", () => {
  const fps = 30;
  const frameMs = 1000 / fps;

  const cases: Array<{ name: string; element: CreativeVideoElement }> = [
    { name: "an ordinary clip", element: video({ sourceStartMs: 2000, sourceEndMs: 9000 }) },
    { name: "a slowed clip", element: video({ sourceStartMs: 13_300, sourceEndMs: 15_000, playbackRate: 0.5 }) },
    { name: "a sped-up clip", element: video({ sourceStartMs: 0, sourceEndMs: 12_000, playbackRate: 2.5 }) },
    { name: "a barely-retimed clip", element: video({ sourceStartMs: 1000, playbackRate: 0.98 }) },
    { name: "a frozen clip", element: video({ freezeAtSourceMs: 4200 }) },
    {
      name: "a ramped clip",
      element: video({
        speedRamp: {
          keyframes: [
            { atMs: 0, speed: 0.6 },
            { atMs: 1200, speed: 2.2 },
            { atMs: 3000, speed: 1 },
          ],
        },
      }),
    },
  ];

  for (const { name, element } of cases) {
    it(`agrees for ${name}`, () => {
      for (const localMs of [0, 40, 333, 900, 1700, 2500, 3400]) {
        const previewSourceMs = resolveVideoSourceTimeMs(element, localMs);
        const plan = resolveVideoPlaybackPlan(element, localMs, fps);

        // Whichever branch the plan took, the source moment it lands on has to
        // be the one the preview is showing, to within the frame both are
        // quantised to.
        const renderedSourceMs =
          plan.mode === "exact-frame"
            ? plan.sourceFrame * frameMs
            : plan.trimBefore * frameMs + localMs;

        expect(
          Math.abs(renderedSourceMs - previewSourceMs),
          `${name} at ${localMs}ms: preview ${previewSourceMs}ms vs render ${renderedSourceMs}ms`,
        ).toBeLessThanOrEqual(frameMs);
      }
    });
  }

  it("never lets the renderer run past an out point the preview respects", () => {
    // The black-frame shape: the render truncating at trimAfter while the
    // preview happily kept showing footage.
    const element = video({ sourceStartMs: 13_300, sourceEndMs: 15_000, playbackRate: 0.5 });
    for (const localMs of [0, 850, 1700, 2550, 3400]) {
      const plan = resolveVideoPlaybackPlan(element, localMs, fps);
      if (plan.mode !== "exact-frame") continue;
      // The last frame legitimately lands on the out point, and frameMs is not
      // exact in binary, so the bound is the out point plus the frame it is
      // quantised to — not a hair under it.
      expect(plan.sourceFrame * frameMs).toBeLessThanOrEqual(15_000 + frameMs);
    }
  });
});
