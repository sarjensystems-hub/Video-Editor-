import { describe, expect, it } from "vitest";
import {
  DEFAULT_MUSIC_MODEL,
  DEFAULT_SPEECH_MODEL,
  ELEVENLABS_VOICES,
  SPEECH_MODEL_IDS,
  SPEECH_MODELS,
  normalizeSpeechLanguage,
  resolveSpeechSettings,
} from "./audio-workers";

describe("speech worker configuration", () => {
  it("routes speech through ElevenLabs Eleven v4 by default", () => {
    expect(DEFAULT_SPEECH_MODEL).toBe("elevenlabs/eleven-v4");
    expect(resolveSpeechSettings(undefined, undefined)).toEqual({ model: "eleven-v4", voice: "sarah" });
    expect(ELEVENLABS_VOICES).toHaveLength(21);
  });

  it("wires every ElevenLabs speech model OpenRouter carries, and nothing else", () => {
    expect(SPEECH_MODEL_IDS).toEqual([
      "eleven-v4",
      "eleven-v4-turbo",
      "eleven-v3",
      "eleven-v3-conversational",
      "eleven-multilingual-v2",
      "eleven-flash-v2.5",
      "eleven-turbo-v2",
    ]);
    for (const id of SPEECH_MODEL_IDS) expect(SPEECH_MODELS[id].slug).toBe(`elevenlabs/${id}`);
  });

  it("selects a model by id or by OpenRouter slug, and canonicalizes the voice", () => {
    expect(resolveSpeechSettings("eleven-flash-v2.5", "George")).toEqual({ model: "eleven-flash-v2.5", voice: "george" });
    expect(resolveSpeechSettings("elevenlabs/eleven-multilingual-v2", undefined)).toEqual({ model: "eleven-multilingual-v2", voice: "sarah" });
  });

  it("no longer offers Gemini TTS or its voices", () => {
    expect(() => resolveSpeechSettings("gemini", undefined)).toThrow(/Unknown speech model gemini/);
    expect(() => resolveSpeechSettings("google/gemini-3.8-flash-tts", undefined)).toThrow(/Unknown speech model/);
    expect(() => resolveSpeechSettings(undefined, "Kore")).toThrow(/Available voices: sarah/);
  });

  it("pins the clip-length music model rather than the full-song one", () => {
    expect(DEFAULT_MUSIC_MODEL).toBe("google/lyria-3-clip-preview");
  });

  it("keeps multilingual language labels and defaults to auto detection", () => {
    expect(normalizeSpeechLanguage("hi")).toBe("hi");
    expect(normalizeSpeechLanguage("GU")).toBe("gu");
    expect(normalizeSpeechLanguage("pt_BR")).toBe("pt-br");
    expect(normalizeSpeechLanguage(undefined)).toBe("auto");
  });
});
