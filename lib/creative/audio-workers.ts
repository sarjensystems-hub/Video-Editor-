/**
 * Speech and music generation workers.
 *
 * Both are *generative workers*: they produce an asset and register it. They
 * never edit a scene, and nothing here reinterprets creative instruction —
 * the assistant writes the script and the music prompt, Studio turns
 * them into bytes and stores them. Same contract as Seedance video.
 *
 * Model choices, from the live OpenRouter catalogue:
 *
 * - Speech: `google/gemini-3.1-flash-tts-preview`. It supports 70+ languages,
 *   thirty named voices, natural-language performance direction and inline
 *   audio tags. Language is detected from the script rather than coupled to a
 *   provider-specific voice id.
 * - Music: `google/lyria-3-clip-preview` at $0.04 per 30-second clip. The Pro
 *   variant generates full songs for $0.08 and is overkill for short social.
 *
 * The optional language value is retained as asset metadata for callers that
 * want it; Gemini detects the language from the supplied script itself.
 */

export const DEFAULT_SPEECH_MODEL = "google/gemini-3.1-flash-tts-preview";
export const DEFAULT_MUSIC_MODEL = "google/lyria-3-clip-preview";

/**
 * The wire format the speech endpoint will actually accept.
 *
 * Not a preference - Gemini TTS rejects anything else outright: `Gemini TTS
 * only supports response_format="pcm". Got "mp3"`. Kokoro accepted `mp3` on
 * this same OpenRouter endpoint, which is why the swap to Gemini looked like a
 * one-line model change and was not: OpenRouter transcodes for some speech
 * models and passes the provider's own constraint through for others.
 */
export const SPEECH_RESPONSE_FORMAT = "pcm";

/**
 * What that PCM actually is, since headerless PCM carries no description of
 * itself. Gemini TTS emits 24kHz 16-bit mono; `audio-generate.ts` wraps it in a
 * WAV header on the way out so the rest of the pipeline sees a real container.
 */
export const SPEECH_PCM_FORMAT = { sampleRate: 24000, channels: 1, bitsPerSample: 16 } as const;

export const GEMINI_TTS_VOICE_STYLES = {
  Zephyr: "Bright", Puck: "Upbeat", Charon: "Informative", Kore: "Firm",
  Fenrir: "Excitable", Leda: "Youthful", Orus: "Firm", Aoede: "Breezy",
  Callirrhoe: "Easy-going", Autonoe: "Bright", Enceladus: "Breathy", Iapetus: "Clear",
  Umbriel: "Easy-going", Algieba: "Smooth", Despina: "Smooth", Erinome: "Clear",
  Algenib: "Gravelly", Rasalgethi: "Informative", Laomedeia: "Upbeat", Achernar: "Soft",
  Alnilam: "Firm", Schedar: "Even", Gacrux: "Mature", Pulcherrima: "Forward",
  Achird: "Friendly", Zubenelgenubi: "Casual", Vindemiatrix: "Gentle", Sadachbia: "Lively",
  Sadaltager: "Knowledgeable", Sulafat: "Warm",
} as const;

export type GeminiTtsVoice = keyof typeof GEMINI_TTS_VOICE_STYLES;
export const GEMINI_TTS_VOICES = Object.keys(GEMINI_TTS_VOICE_STYLES) as GeminiTtsVoice[];

/** Normalizes an optional metadata label; Gemini detects the spoken language. */
export function normalizeSpeechLanguage(value: unknown): string {
  const raw = typeof value === "string" ? value.trim().toLowerCase() : "";
  return raw ? raw.replace(/_/g, "-") : "auto";
}

/** Resolves an OpenRouter-advertised Gemini voice, case-insensitively. */
export function resolveSpeechVoice(requested: unknown): GeminiTtsVoice {
  if (typeof requested !== "string" || !requested.trim()) return "Kore";
  const raw = requested.trim();
  const voice = GEMINI_TTS_VOICES.find((candidate) => candidate.toLowerCase() === raw.toLowerCase());
  if (voice) return voice;
  throw new Error(`Unknown voice ${raw}. Available Gemini voices: ${GEMINI_TTS_VOICES.join(", ")}`);
}
