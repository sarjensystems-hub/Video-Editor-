import { describe, expect, it } from "vitest";
import {
  DEFAULT_MUSIC_MODEL,
  DEFAULT_SPEECH_MODEL,
  GEMINI_TTS_VOICES,
  normalizeSpeechLanguage,
  resolveSpeechVoice,
} from "./audio-workers";

describe("speech worker configuration", () => {
  it("routes speech through Gemini 3.1 Flash TTS", () => {
    expect(DEFAULT_SPEECH_MODEL).toBe("google/gemini-3.1-flash-tts-preview");
  });

  it("pins the clip-length music model rather than the full-song one", () => {
    expect(DEFAULT_MUSIC_MODEL).toBe("google/lyria-3-clip-preview");
  });

  it("publishes the complete Gemini voice catalogue", () => {
    expect(GEMINI_TTS_VOICES).toHaveLength(30);
    expect(GEMINI_TTS_VOICES).toEqual(expect.arrayContaining(["Kore", "Puck", "Aoede", "Sulafat"]));
  });

  it("keeps multilingual language labels and defaults to auto detection", () => {
    expect(normalizeSpeechLanguage("hi")).toBe("hi");
    expect(normalizeSpeechLanguage("GU")).toBe("gu");
    expect(normalizeSpeechLanguage("pt_BR")).toBe("pt-br");
    expect(normalizeSpeechLanguage(undefined)).toBe("auto");
  });

  it("defaults to Kore and canonicalizes explicit voice names", () => {
    expect(resolveSpeechVoice(undefined)).toBe("Kore");
    expect(resolveSpeechVoice("aoede")).toBe("Aoede");
  });

  it("rejects voices that Gemini does not expose", () => {
    expect(() => resolveSpeechVoice("af_heart")).toThrow(/voice/i);
    expect(() => resolveSpeechVoice("not_a_voice")).toThrow(/voice/i);
  });
});
