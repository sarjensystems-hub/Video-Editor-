import { describe, expect, it } from "vitest";
import { alignVoiceoverText, normalizeVoiceoverTranscript, voiceoverTimingsToMarkers } from "./voiceover-timing";

describe("voiceover timing markers", () => {
  it("removes inline performance tags and prefers an explicit spoken transcript", () => {
    expect(normalizeVoiceoverTranscript("[whispers] Hello [laughs] world.")).toBe("Hello world.");
    expect(normalizeVoiceoverTranscript("Director note: cheerful", "Hello world.")).toBe("Hello world.");
  });

  it("labels estimated timing provenance and spans the measured duration", () => {
    const timing = alignVoiceoverText("Build faster. Ship with confidence!", 4200);
    expect(timing.source).toBe("duration-aligned-estimate");
    expect(timing.words.map((word) => word.text)).toEqual(["Build", "faster.", "Ship", "with", "confidence!"]);
    expect(timing.sentences.map((sentence) => sentence.text)).toEqual(["Build faster.", "Ship with confidence!"]);
    expect(timing.words[0].startMs).toBe(0);
    expect(timing.words.at(-1)?.endMs).toBe(4200);
  });

  it("returns deterministic timeline-ready markers at an audio clip offset", () => {
    const timing = alignVoiceoverText("One two. Three.", 3000);
    const first = voiceoverTimingsToMarkers("asset-1", timing, { offsetMs: 1250, granularity: "both" });
    expect(first).toEqual(voiceoverTimingsToMarkers("asset-1", timing, { offsetMs: 1250, granularity: "both" }));
    expect(first[0]).toMatchObject({ timeMs: 1250, kind: "word", label: "One" });
    expect(first.some((marker) => marker.kind === "sentence")).toBe(true);
  });
});
