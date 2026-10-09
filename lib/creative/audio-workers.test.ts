import { describe, expect, it } from "vitest";
import {
  DEFAULT_MUSIC_MODEL,
  DEFAULT_SPEECH_MODEL,
  ELEVENLABS_VOICES,
  GEMINI_TTS_VOICES,
  normalizeSpeechLanguage,
  resolveSpeechSettings,
  resolveSpeechVoice,
} from "./audio-workers";

describe("speech worker configuration", () => {
  it("routes speech through ElevenLabs Eleven v4 by default", () => {
    expect(DEFAULT_SPEECH_MODEL).toBe("elevenlabs/eleven-v4");
    expect(resolveSpeechSettings(undefined, undefined)).toEqual({ model: "eleven-v4", voice: "sarah" });
    expect(ELEVENLABS_VOICES).toHaveLength(21);
  });

  it("keeps Gemini on request, and for callers that still name a Gemini voice", () => {
    expect(resolveSpeechSettings("gemini", undefined)).toEqual({ model: "gemini", voice: "Kore" });
    expect(resolveSpeechSettings(undefined, "kore")).toEqual({ model: "gemini", voice: "Kore" });
    expect(resolveSpeechSettings("eleven-v4", "George")).toEqual({ model: "eleven-v4", voice: "george" });
  });

  it("refuses a voice that belongs to the other model", () => {
    expect(() => resolveSpeechSettings("eleven-v4", "Kore")).toThrow(/Available voices: sarah/);
    expect(() => resolveSpeechSettings("gemini", "sarah")).toThrow(/Unknown voice sarah/);
    expect(() => resolveSpeechSettings("kokoro", undefined)).toThrow(/Unknown speech model/);
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
