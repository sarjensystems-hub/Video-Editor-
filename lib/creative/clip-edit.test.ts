import { describe, expect, it } from "vitest";
import {
  duplicateVideoClip,
  freezeVideoClip,
  setVideoClipSpeed,
  slipVideoClip,
  splitVideoClip,
  trimVideoClip,
  videoClipSourceLengthMs,
  videoClipWindow,
} from "./clip-edit";
import { createDefaultTransform } from "./defaults";
import type { CreativeVideoElement } from "./schema";

const SCENE_MS = 10_000;

function clip(overrides: Partial<CreativeVideoElement> = {}): CreativeVideoElement {
  return {
    id: "shot-1",
    name: "B-roll",
    type: "video",
    assetId: "asset-1",
    sourceStartMs: 2_000,
    sourceEndMs: 8_000,
    fit: "cover",
    volume: 1,
    playbackRate: 1,
    timing: { startMs: 0, endMs: 6_000 },
    transform: createDefaultTransform({ x: 0, y: 0, width: 1080, height: 1920 }),
    ...overrides,
  } as CreativeVideoElement;
}

describe("clip window helpers", () => {
  it("falls back to the whole scene when the clip has no explicit timing", () => {
    const bare = clip({ timing: undefined });
    expect(videoClipWindow(bare, SCENE_MS)).toEqual({ startMs: 0, endMs: SCENE_MS });
  });

  it("reports source length consumed at the clip playback rate", () => {
    expect(videoClipSourceLengthMs(clip(), SCENE_MS)).toBe(6_000);
    expect(videoClipSourceLengthMs(clip({ playbackRate: 2 }), SCENE_MS)).toBe(12_000);
  });
});

describe("splitVideoClip", () => {
  it("splits into two clips that lose and duplicate no frames", () => {
    const { left, right } = splitVideoClip(clip(), SCENE_MS, 2_500);

    expect(left.timing).toEqual({ startMs: 0, endMs: 2_500 });
    expect(right.timing).toEqual({ startMs: 2_500, endMs: 6_000 });
    // The cut point is shared exactly: no gap, no overlap.
    expect(left.sourceEndMs).toBe(right.sourceStartMs);
    expect(left.sourceStartMs).toBe(2_000);
    expect(right.sourceEndMs).toBe(8_000);
    // Total source consumed is unchanged by the split.
    const before = videoClipSourceLengthMs(clip(), SCENE_MS);
    const after =
      videoClipSourceLengthMs(left, SCENE_MS) + videoClipSourceLengthMs(right, SCENE_MS);
    expect(after).toBe(before);
  });

  it("consumes source at the playback rate when splitting a sped-up clip", () => {
    const fast = clip({ playbackRate: 2, sourceEndMs: 14_000 });
    const { left, right } = splitVideoClip(fast, SCENE_MS, 2_500);
    // 2500ms of timeline at 2x consumes 5000ms of source.
    expect(left.sourceEndMs).toBe(7_000);
    expect(right.sourceStartMs).toBe(7_000);
  });

  it("gives the two halves distinct ids and keeps the original untouched", () => {
    const original = clip();
    const { left, right } = splitVideoClip(original, SCENE_MS, 3_000);
    expect(left.id).toBe("shot-1");
    expect(right.id).not.toBe(left.id);
    expect(original.timing).toEqual({ startMs: 0, endMs: 6_000 });
  });

  it("refuses a split on or outside the clip boundaries instead of producing a zero-length clip", () => {
    expect(() => splitVideoClip(clip(), SCENE_MS, 0)).toThrow(/inside/i);
    expect(() => splitVideoClip(clip(), SCENE_MS, 6_000)).toThrow(/inside/i);
    expect(() => splitVideoClip(clip(), SCENE_MS, 9_000)).toThrow(/inside/i);
    expect(() => splitVideoClip(clip(), SCENE_MS, Number.NaN)).toThrow(/finite/i);
  });
});

describe("trimVideoClip", () => {
  it("moves the in-point without shifting the frames that remain", () => {
    const trimmed = trimVideoClip(clip(), SCENE_MS, { startMs: 1_000 });
    expect(trimmed.timing).toEqual({ startMs: 1_000, endMs: 6_000 });
    // The retained edge keeps the same source frame: 1000ms consumed off the head.
    expect(trimmed.sourceStartMs).toBe(3_000);
    expect(trimmed.sourceEndMs).toBe(8_000);
  });

  it("moves the out-point without shifting the frames that remain", () => {
    const trimmed = trimVideoClip(clip(), SCENE_MS, { endMs: 4_000 });
    expect(trimmed.timing).toEqual({ startMs: 0, endMs: 4_000 });
    expect(trimmed.sourceStartMs).toBe(2_000);
    expect(trimmed.sourceEndMs).toBe(6_000);
  });

  it("rejects a trim that would empty the clip", () => {
    expect(() => trimVideoClip(clip(), SCENE_MS, { startMs: 6_000 })).toThrow(/positive/i);
    expect(() => trimVideoClip(clip(), SCENE_MS, { startMs: 4_000, endMs: 4_000 })).toThrow(/positive/i);
    expect(() => trimVideoClip(clip(), SCENE_MS, {})).toThrow(/start_ms or end_ms/i);
  });
});

describe("slipVideoClip", () => {
  it("moves the source window without moving the clip on the timeline", () => {
    const slipped = slipVideoClip(clip(), SCENE_MS, 500);
    expect(slipped.timing).toEqual({ startMs: 0, endMs: 6_000 });
    expect(slipped.sourceStartMs).toBe(2_500);
    expect(slipped.sourceEndMs).toBe(8_500);
  });

  it("keeps the source window length identical", () => {
    const before = clip();
    const after = slipVideoClip(before, SCENE_MS, -1_000);
    expect(after.sourceEndMs! - after.sourceStartMs!).toBe(before.sourceEndMs! - before.sourceStartMs!);
    expect(after.sourceStartMs).toBe(1_000);
  });

  it("refuses to slip the source window before the start of the asset", () => {
    expect(() => slipVideoClip(clip(), SCENE_MS, -5_000)).toThrow(/before the start/i);
  });
});

describe("setVideoClipSpeed", () => {
  it("holding source keeps the frames and changes how long they occupy", () => {
    const fast = setVideoClipSpeed(clip(), SCENE_MS, 2, "hold_source");
    expect(fast.playbackRate).toBe(2);
    expect(fast.sourceStartMs).toBe(2_000);
    expect(fast.sourceEndMs).toBe(8_000);
    // 6000ms of source at 2x occupies 3000ms of timeline.
    expect(fast.timing).toEqual({ startMs: 0, endMs: 3_000 });
  });

  it("holding duration keeps the slot and changes which frames fill it", () => {
    const slow = setVideoClipSpeed(clip(), SCENE_MS, 0.5, "hold_duration");
    expect(slow.playbackRate).toBe(0.5);
    expect(slow.timing).toEqual({ startMs: 0, endMs: 6_000 });
    // 6000ms of timeline at 0.5x consumes 3000ms of source.
    expect(slow.sourceEndMs).toBe(5_000);
  });

  it("rejects a non-positive or non-finite speed", () => {
    expect(() => setVideoClipSpeed(clip(), SCENE_MS, 0, "hold_source")).toThrow(/positive/i);
    expect(() => setVideoClipSpeed(clip(), SCENE_MS, -1, "hold_source")).toThrow(/positive/i);
    expect(() => setVideoClipSpeed(clip(), SCENE_MS, Number.NaN, "hold_source")).toThrow(/finite/i);
  });
});

describe("freezeVideoClip", () => {
  it("holds an exact source frame for the whole visible window", () => {
    const frozen = freezeVideoClip(clip(), SCENE_MS, 3_000);
    // 3000ms into the clip at 1x is 5000ms into the source.
    expect(frozen.freezeAtSourceMs).toBe(5_000);
    expect(frozen.timing).toEqual({ startMs: 0, endMs: 6_000 });
  });

  it("resolves the freeze point at the clip playback rate", () => {
    const frozen = freezeVideoClip(clip({ playbackRate: 2, sourceEndMs: 14_000 }), SCENE_MS, 1_000);
    expect(frozen.freezeAtSourceMs).toBe(4_000);
  });

  it("refuses a freeze point outside the clip window", () => {
    expect(() => freezeVideoClip(clip(), SCENE_MS, 6_000)).toThrow(/inside/i);
    expect(() => freezeVideoClip(clip(), SCENE_MS, -1)).toThrow(/inside/i);
  });
});

describe("duplicateVideoClip", () => {
  it("copies the clip with a new id at an offset slot", () => {
    const copy = duplicateVideoClip(clip(), SCENE_MS, 6_000);
    expect(copy.id).not.toBe("shot-1");
    expect(copy.timing).toEqual({ startMs: 6_000, endMs: 12_000 });
    expect(copy.sourceStartMs).toBe(2_000);
    expect(copy.sourceEndMs).toBe(8_000);
  });

  it("deep-copies nested structures so the copy cannot alias the original", () => {
    const original = clip({ crop: { x: 0, y: 0, width: 1, height: 0.5 } });
    const copy = duplicateVideoClip(original, SCENE_MS, 0);
    expect(copy.crop).toEqual(original.crop);
    expect(copy.crop).not.toBe(original.crop);
    expect(copy.transform).not.toBe(original.transform);
  });
});
