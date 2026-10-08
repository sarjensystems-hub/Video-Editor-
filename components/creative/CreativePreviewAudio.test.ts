import { describe, expect, it } from "vitest";
import type { CreativeAudioClip } from "@/lib/creative/schema";
import { previewClipVolume } from "./CreativePreviewAudio";

const clip = (overrides: Partial<CreativeAudioClip>): CreativeAudioClip => ({
  id: "c", name: "c", assetId: "a", kind: "voiceover", startMs: 1000, endMs: 5000, sourceStartMs: 0, gain: 1, ...overrides,
});

describe("preview audio mix", () => {
  it("is silent outside the clip and while muted", () => {
    expect(previewClipVolume(clip({}), [], 500)).toBe(0);
    expect(previewClipVolume(clip({}), [], 5000)).toBe(0);
    expect(previewClipVolume(clip({ muted: true }), [], 2000)).toBe(0);
  });

  it("applies fades", () => {
    expect(previewClipVolume(clip({ fadeInMs: 1000 }), [], 1500)).toBeCloseTo(0.5);
    expect(previewClipVolume(clip({ fadeOutMs: 1000 }), [], 4750)).toBeCloseTo(0.25);
  });

  it("ducks music while a voiceover sounds", () => {
    const music = clip({ id: "m", kind: "music", startMs: 0, endMs: 10000, gain: 0.8, duckUnderVoice: true, duckToGain: 0.25 });
    const voice = clip({ id: "v", startMs: 2000, endMs: 4000 });
    expect(previewClipVolume(music, [music, voice], 1000)).toBeCloseTo(0.8);
    expect(previewClipVolume(music, [music, voice], 3000)).toBeCloseTo(0.2);
  });

  it("caps gain above unity at full volume", () => {
    expect(previewClipVolume(clip({ gain: 1.8 }), [], 2000)).toBe(1);
  });
});
