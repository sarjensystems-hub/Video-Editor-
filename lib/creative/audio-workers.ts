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
 * - Speech, by default: `elevenlabs/eleven-v4`. Ranked first on Artificial
 *   Analysis's blind-vote TTS arena and its pronunciation benchmark, ahead of
 *   Gemini 3.8 Flash TTS, and it speaks exactly what is written rather than
 *   adding breaths of its own - which matters when captions are timed to the
 *   script. 90+ languages (14 Indian), 21 preset voices, inline audio tags
 *   such as [excited] or [whispers]. Prose direction is spoken aloud, so it
 *   takes none. About 5 cents for a 76-second voiceover through OpenRouter.
 * - Speech, on request: `google/gemini-3.8-flash-tts`. 130+ languages (about
 *   20 Indian), thirty named voices and natural-language performance
 *   direction, at under half the price.
 * - Music: `google/lyria-3-clip-preview` at $0.04 per 30-second clip. The Pro
 *   variant generates full songs for $0.08 and is overkill for short social.
 *
 * The optional language value is retained as asset metadata for callers that
 * want it; both speech models detect the language from the script itself.
 */

export const DEFAULT_MUSIC_MODEL = "google/lyria-3-clip-preview";

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

/** ElevenLabs' preset voices as OpenRouter exposes them. */
export const ELEVENLABS_VOICES = [
  "sarah", "george", "adam", "alice", "bella", "bill", "brian", "callum", "charlie", "chris", "daniel",
  "eric", "harry", "jessica", "laura", "liam", "lily", "matilda", "river", "roger", "will",
] as const;
export type ElevenLabsVoice = (typeof ELEVENLABS_VOICES)[number];

export interface SpeechModelConfig {
  slug: string;
  label: string;
  /**
   * Not a preference: Gemini TTS rejects anything but PCM outright (`Gemini
   * TTS only supports response_format="pcm". Got "mp3"`), and its PCM is
   * headerless, so `pcm` describes it for the WAV header `audio-generate.ts`
   * wraps it in. ElevenLabs returns ordinary MP3.
   */
  responseFormat: "mp3" | "pcm";
  pcm: { sampleRate: number; channels: number; bitsPerSample: number } | null;
  voices: readonly string[];
  defaultVoice: string;
}

export const SPEECH_MODELS = {
  "eleven-v4": {
    slug: "elevenlabs/eleven-v4",
    label: "ElevenLabs Eleven v4",
    responseFormat: "mp3",
    pcm: null,
    voices: ELEVENLABS_VOICES,
    defaultVoice: "sarah",
  },
  gemini: {
    slug: "google/gemini-3.8-flash-tts",
    label: "Google Gemini 3.8 Flash TTS",
    responseFormat: "pcm",
    pcm: { sampleRate: 24000, channels: 1, bitsPerSample: 16 },
    voices: Object.keys(GEMINI_TTS_VOICE_STYLES),
    defaultVoice: "Kore",
  },
} satisfies Record<string, SpeechModelConfig>;

export type SpeechModelId = keyof typeof SPEECH_MODELS;
export const SPEECH_MODEL_IDS = Object.keys(SPEECH_MODELS) as SpeechModelId[];
export const DEFAULT_SPEECH_MODEL_ID: SpeechModelId = "eleven-v4";
/** The OpenRouter slug speech uses unless a caller asks for another model. */
export const DEFAULT_SPEECH_MODEL = SPEECH_MODELS[DEFAULT_SPEECH_MODEL_ID].slug;

/**
 * Picks the speech model and voice together, since voices belong to a model.
 * A Gemini voice name with no model chosen selects Gemini, so a caller written
 * before ElevenLabs became the default keeps getting the voice it named.
 */
export function resolveSpeechSettings(requestedModel: unknown, requestedVoice: unknown): { model: SpeechModelId; voice: string } {
  const voiceRaw = typeof requestedVoice === "string" ? requestedVoice.trim() : "";
  const modelRaw = typeof requestedModel === "string" ? requestedModel.trim().toLowerCase() : "";
  let model: SpeechModelId;
  if (modelRaw) {
    const match = SPEECH_MODEL_IDS.find((id) => id === modelRaw || SPEECH_MODELS[id].slug === modelRaw);
    if (!match) throw new Error(`Unknown speech model ${modelRaw}. Use one of: ${SPEECH_MODEL_IDS.join(", ")}`);
    model = match;
  } else if (voiceRaw && GEMINI_TTS_VOICES.some((voice) => voice.toLowerCase() === voiceRaw.toLowerCase())) {
    model = "gemini";
  } else {
    model = DEFAULT_SPEECH_MODEL_ID;
  }
  const config: SpeechModelConfig = SPEECH_MODELS[model];
  if (!voiceRaw) return { model, voice: config.defaultVoice };
  const voice = config.voices.find((candidate) => candidate.toLowerCase() === voiceRaw.toLowerCase());
  if (voice) return { model, voice };
  throw new Error(`Unknown voice ${voiceRaw} for ${config.label}. Available voices: ${config.voices.join(", ")}`);
}

/** Resolves an OpenRouter-advertised Gemini voice, case-insensitively. */
/** Resolves an OpenRouter-advertised Gemini voice, case-insensitively. */
export function resolveSpeechVoice(requested: unknown): GeminiTtsVoice {
  if (typeof requested !== "string" || !requested.trim()) return "Kore";
  const raw = requested.trim();
  const voice = GEMINI_TTS_VOICES.find((candidate) => candidate.toLowerCase() === raw.toLowerCase());
  if (voice) return voice;
  throw new Error(`Unknown voice ${raw}. Available Gemini voices: ${GEMINI_TTS_VOICES.join(", ")}`);
}
