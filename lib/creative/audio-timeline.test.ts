import { describe, expect, it } from "vitest";
import {
  audioClipsAtTime,
  getCreativeAudioClips,
  resolveAudioClipGain,
} from "./audio-timeline";
import { createCanonicalCreativeFixture } from "./fixtures";
import type { CreativeAudioClip, CreativeDocument } from "./schema";

const music = (o: Partial<CreativeAudioClip> = {}): CreativeAudioClip => ({
  id: "bed", name: "Music bed", assetId: "music-1", kind: "music",
  startMs: 0, endMs: 8_000, sourceStartMs: 0, gain: 1, ...o,
});
const vo = (o: Partial<CreativeAudioClip> = {}): CreativeAudioClip => ({
  id: "vo-1", name: "VO", assetId: "vo-1", kind: "voiceover",
  startMs: 2_000, endMs: 5_000, sourceStartMs: 0, gain: 1, ...o,
});

function docWithAudio(audio: CreativeAudioClip[]): CreativeDocument {
  return { ...createCanonicalCreativeFixture(), audio };
}

describe("getCreativeAudioClips", () => {
  it("returns an empty list for a document written before audio existed", () => {
    expect(getCreativeAudioClips(createCanonicalCreativeFixture())).toEqual([]);
  });

  it("returns the document's clips when present", () => {
    expect(getCreativeAudioClips(docWithAudio([music()]))).toHaveLength(1);
  });
});

describe("audioClipsAtTime", () => {
  it("includes a clip inside its window and excludes it outside", () => {
    const clips = [music(), vo()];
    expect(audioClipsAtTime(clips, 0).map((c) => c.id)).toEqual(["bed"]);
    expect(audioClipsAtTime(clips, 3_000).map((c) => c.id)).toEqual(["bed", "vo-1"]);
    expect(audioClipsAtTime(clips, 6_000).map((c) => c.id)).toEqual(["bed"]);
  });

  it("treats the end of a clip as exclusive so two adjacent clips never both play", () => {
    const a = music({ id: "a", startMs: 0, endMs: 1_000 });
    const b = music({ id: "b", startMs: 1_000, endMs: 2_000 });
    expect(audioClipsAtTime([a, b], 1_000).map((c) => c.id)).toEqual(["b"]);
  });

  it("skips muted clips", () => {
    expect(audioClipsAtTime([music({ muted: true })], 100)).toEqual([]);
  });
});

describe("resolveAudioClipGain", () => {
  it("plays at the clip gain in the steady state", () => {
    expect(resolveAudioClipGain(music({ gain: 0.8 }), [], 4_000)).toBe(0.8);
  });

  it("is silent outside the clip window", () => {
    expect(resolveAudioClipGain(music(), [], 9_000)).toBe(0);
    expect(resolveAudioClipGain(music({ startMs: 1_000 }), [], 500)).toBe(0);
  });

  it("ramps a fade in from silence to the clip gain", () => {
    const clip = music({ gain: 1, fadeInMs: 1_000 });
    expect(resolveAudioClipGain(clip, [], 0)).toBe(0);
    expect(resolveAudioClipGain(clip, [], 500)).toBeCloseTo(0.5, 5);
    expect(resolveAudioClipGain(clip, [], 1_000)).toBe(1);
  });

  it("ramps a fade out to silence at the very end", () => {
    const clip = music({ gain: 1, fadeOutMs: 2_000, endMs: 8_000 });
    expect(resolveAudioClipGain(clip, [], 6_000)).toBe(1);
    expect(resolveAudioClipGain(clip, [], 7_000)).toBeCloseTo(0.5, 5);
    expect(resolveAudioClipGain(clip, [], 7_999)).toBeLessThan(0.01);
  });

  it("scales fades by the clip gain rather than ignoring it", () => {
    const clip = music({ gain: 0.4, fadeInMs: 1_000 });
    expect(resolveAudioClipGain(clip, [], 500)).toBeCloseTo(0.2, 5);
  });

  it("ducks music under a voiceover and restores it afterwards", () => {
    const bed = music({ gain: 1, duckUnderVoice: true, duckToGain: 0.25 });
    const clips = [bed, vo()];
    expect(resolveAudioClipGain(bed, clips, 1_000)).toBe(1);
    expect(resolveAudioClipGain(bed, clips, 3_000)).toBe(0.25);
    expect(resolveAudioClipGain(bed, clips, 6_000)).toBe(1);
  });

  it("does not duck when the flag is off", () => {
    const bed = music({ gain: 1, duckUnderVoice: false });
    expect(resolveAudioClipGain(bed, [bed, vo()], 3_000)).toBe(1);
  });

  it("never ducks a voiceover under itself", () => {
    const voice = vo({ gain: 1, duckUnderVoice: true, duckToGain: 0.2 });
    expect(resolveAudioClipGain(voice, [voice], 3_000)).toBe(1);
  });

  it("ignores a muted voiceover when deciding whether to duck", () => {
    const bed = music({ gain: 1, duckUnderVoice: true, duckToGain: 0.25 });
    expect(resolveAudioClipGain(bed, [bed, vo({ muted: true })], 3_000)).toBe(1);
  });

  it("combines a fade and a duck without exceeding either", () => {
    const bed = music({ gain: 1, fadeInMs: 4_000, duckUnderVoice: true, duckToGain: 0.5 });
    // 2000ms into a 4000ms fade is 0.5, then ducked by half again.
    expect(resolveAudioClipGain(bed, [bed, vo()], 2_000)).toBeCloseTo(0.25, 5);
  });

  it("returns zero for a muted clip regardless of gain", () => {
    expect(resolveAudioClipGain(music({ gain: 1, muted: true }), [], 4_000)).toBe(0);
  });
});
