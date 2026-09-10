import { describe, expect, it } from "vitest";
import { rampSourceLengthMs, resolveClipSourceTimeMs, sourceOffsetAt, speedAt } from "./speed-ramp";
import { createDefaultTransform } from "./defaults";
import type { CreativeSpeedRamp, CreativeVideoElement } from "./schema";

const ramp = (keyframes: Array<{ atMs: number; speed: number }>): CreativeSpeedRamp => ({ keyframes });

const clip = (o: Partial<CreativeVideoElement> = {}): CreativeVideoElement => ({
  id: "c", name: "c", type: "video", assetId: "a",
  sourceStartMs: 1_000, fit: "cover", volume: 1, playbackRate: 1,
  transform: createDefaultTransform({ x: 0, y: 0, width: 100, height: 100 }),
  ...o,
} as CreativeVideoElement);

describe("speedAt", () => {
  it("holds flat before the first and after the last keyframe", () => {
    const r = ramp([{ atMs: 1_000, speed: 1 }, { atMs: 2_000, speed: 3 }]);
    expect(speedAt(r, 0)).toBe(1);
    expect(speedAt(r, 5_000)).toBe(3);
  });

  it("interpolates linearly between keyframes", () => {
    const r = ramp([{ atMs: 0, speed: 1 }, { atMs: 1_000, speed: 3 }]);
    expect(speedAt(r, 500)).toBe(2);
    expect(speedAt(r, 250)).toBe(1.5);
  });
});

describe("sourceOffsetAt", () => {
  it("matches constant-rate playback when the curve is flat", () => {
    const r = ramp([{ atMs: 0, speed: 2 }, { atMs: 4_000, speed: 2 }]);
    expect(sourceOffsetAt(r, 1_000)).toBe(2_000);
    expect(sourceOffsetAt(r, 4_000)).toBe(8_000);
  });

  it("integrates a linear ramp as the area under the curve, not the endpoint speed", () => {
    // 1x rising to 3x over 1000ms: average 2x, so 2000ms of source consumed.
    const r = ramp([{ atMs: 0, speed: 1 }, { atMs: 1_000, speed: 3 }]);
    expect(sourceOffsetAt(r, 1_000)).toBe(2_000);
    // Half way in, speed has reached 2x, average 1.5x over 500ms = 750ms.
    expect(sourceOffsetAt(r, 500)).toBe(750);
  });

  it("accumulates across multiple segments", () => {
    const r = ramp([
      { atMs: 0, speed: 1 },
      { atMs: 1_000, speed: 1 },
      { atMs: 2_000, speed: 3 },
    ]);
    // 1000ms at 1x = 1000, then 1000ms averaging 2x = 2000.
    expect(sourceOffsetAt(r, 2_000)).toBe(3_000);
  });

  it("is monotonic, so a ramp can never run source backwards", () => {
    const r = ramp([{ atMs: 0, speed: 0.25 }, { atMs: 2_000, speed: 4 }]);
    let previous = -1;
    for (let t = 0; t <= 3_000; t += 100) {
      const offset = sourceOffsetAt(r, t);
      expect(offset).toBeGreaterThanOrEqual(previous);
      previous = offset;
    }
  });

  it("consumes nothing at or before the clip start", () => {
    const r = ramp([{ atMs: 0, speed: 2 }, { atMs: 1_000, speed: 2 }]);
    expect(sourceOffsetAt(r, 0)).toBe(0);
    expect(sourceOffsetAt(r, -50)).toBe(0);
  });

  it("reports total source consumed across a window", () => {
    const r = ramp([{ atMs: 0, speed: 1 }, { atMs: 2_000, speed: 3 }]);
    expect(rampSourceLengthMs(r, 2_000)).toBe(4_000);
  });
});

describe("resolveClipSourceTimeMs", () => {
  it("falls back to constant playbackRate when there is no ramp", () => {
    expect(resolveClipSourceTimeMs(clip({ playbackRate: 2 }), 500)).toBe(2_000);
  });

  it("offsets from the clip source in-point", () => {
    expect(resolveClipSourceTimeMs(clip({ playbackRate: 1 }), 0)).toBe(1_000);
  });

  it("uses the ramp when present, ignoring playbackRate", () => {
    const ramped = clip({
      playbackRate: 99,
      speedRamp: ramp([{ atMs: 0, speed: 1 }, { atMs: 1_000, speed: 3 }]),
    });
    expect(resolveClipSourceTimeMs(ramped, 1_000)).toBe(1_000 + 2_000);
  });

  it("holds the stored frame for a frozen clip, ramp or not", () => {
    const frozen = clip({
      freezeAtSourceMs: 4_242,
      speedRamp: ramp([{ atMs: 0, speed: 1 }, { atMs: 1_000, speed: 3 }]),
    });
    expect(resolveClipSourceTimeMs(frozen, 0)).toBe(4_242);
    expect(resolveClipSourceTimeMs(frozen, 900)).toBe(4_242);
  });
});
