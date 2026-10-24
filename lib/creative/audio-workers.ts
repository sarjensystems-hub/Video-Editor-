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
 * - Speech: every ElevenLabs text-to-speech model OpenRouter carries, with
 *   `elevenlabs/eleven-v4` the default. Eleven v4 ranked first on Artificial
 *   Analysis's blind-vote TTS arena and its pronunciation benchmark, and it
 *   speaks exactly what is written rather than adding breaths of its own -
 *   which matters when captions are timed to the script. Prose direction is
 *   spoken aloud by every ElevenLabs model, so none of them takes any; the v3
 *   and v4 families take inline audio tags such as [excited] or [whispers].
 *   OpenRouter exposes the same 21 preset voices on each model, and any of
 *   them speaks every language its model supports - there is no separate
 *   "Indian voice": a Hindi or Tamil script is spoken in Hindi or Tamil.
 * - Music: `google/lyria-3-clip-preview` at $0.04 per 30-second clip. The Pro
 *   variant generates full songs for $0.08 and is overkill for short social.
 *
 * The optional language value is retained as asset metadata for callers that
 * want it; the speech models detect the language from the script itself.
 */

export const DEFAULT_MUSIC_MODEL = "google/lyria-3-clip-preview";

/** Normalizes an optional metadata label; the model detects the spoken language. */
export function normalizeSpeechLanguage(value: unknown): string {
  const raw = typeof value === "string" ? value.trim().toLowerCase() : "";
  return raw ? raw.replace(/_/g, "-") : "auto";
}

/** ElevenLabs' preset voices as OpenRouter exposes them, on every model. */
export const ELEVENLABS_VOICES = [
  "sarah", "george", "adam", "alice", "bella", "bill", "brian", "callum", "charlie", "chris", "daniel",
  "eric", "harry", "jessica", "laura", "liam", "lily", "matilda", "river", "roger", "will",
] as const;
export type ElevenLabsVoice = (typeof ELEVENLABS_VOICES)[number];

/** The Indian languages Eleven v4 speaks, as its model page lists them. */
export const ELEVEN_V4_INDIAN_LANGUAGES = [
  "Hindi", "Bengali", "Marathi", "Gujarati", "Tamil", "Telugu", "Kannada",
  "Malayalam", "Punjabi", "Odia", "Assamese", "Nepali", "Urdu", "Sindhi",
] as const;

export interface SpeechModelConfig {
  slug: string;
  label: string;
  /** What the model is for and what it speaks, for the tool description. */
  summary: string;
  /** Whether [audio tags] steer delivery; on the other models they are read aloud. */
  audioTags: boolean;
  voices: readonly string[];
  defaultVoice: string;
}

const INDIAN_V4 = ELEVEN_V4_INDIAN_LANGUAGES.join(", ");

export const SPEECH_MODELS = {
  "eleven-v4": {
    slug: "elevenlabs/eleven-v4",
    label: "ElevenLabs Eleven v4",
    summary: `the default and most expressive; 90+ languages including ${INDIAN_V4}`,
    audioTags: true,
    voices: ELEVENLABS_VOICES,
    defaultVoice: "sarah",
  },
  "eleven-v4-turbo": {
    slug: "elevenlabs/eleven-v4-turbo",
    label: "ElevenLabs Eleven v4 Turbo",
    summary: "Eleven v4's delivery, languages and audio tags, faster and cheaper",
    audioTags: true,
    voices: ELEVENLABS_VOICES,
    defaultVoice: "sarah",
  },
  "eleven-v3": {
    slug: "elevenlabs/eleven-v3",
    label: "ElevenLabs Eleven v3",
    summary: "the previous expressive model; 70+ languages, 5,000 characters per request",
    audioTags: true,
    voices: ELEVENLABS_VOICES,
    defaultVoice: "sarah",
  },
  "eleven-v3-conversational": {
    slug: "elevenlabs/eleven-v3-conversational",
    label: "ElevenLabs Eleven v3 Conversational",
    summary: "v3 tuned for natural back-and-forth dialogue",
    audioTags: true,
    voices: ELEVENLABS_VOICES,
    defaultVoice: "sarah",
  },
  "eleven-multilingual-v2": {
    slug: "elevenlabs/eleven-multilingual-v2",
    label: "ElevenLabs Eleven Multilingual v2",
    summary: "steady, consistent long-form narration; 29 languages including Hindi and Tamil",
    audioTags: false,
    voices: ELEVENLABS_VOICES,
    defaultVoice: "sarah",
  },
  "eleven-flash-v2.5": {
    slug: "elevenlabs/eleven-flash-v2.5",
    label: "ElevenLabs Eleven Flash v2.5",
    summary: "ultra-low latency and cheaper; 32 languages including Hindi and Tamil, 40,000 characters per request",
    audioTags: false,
    voices: ELEVENLABS_VOICES,
    defaultVoice: "sarah",
  },
  "eleven-turbo-v2": {
    slug: "elevenlabs/eleven-turbo-v2",
    label: "ElevenLabs Eleven Turbo v2",
    summary: "fast, English only",
    audioTags: false,
    voices: ELEVENLABS_VOICES,
    defaultVoice: "sarah",
  },
} satisfies Record<string, SpeechModelConfig>;

export type SpeechModelId = keyof typeof SPEECH_MODELS;
export const SPEECH_MODEL_IDS = Object.keys(SPEECH_MODELS) as SpeechModelId[];
export const DEFAULT_SPEECH_MODEL_ID: SpeechModelId = "eleven-v4";
/** The OpenRouter slug speech uses unless a caller asks for another model. */
export const DEFAULT_SPEECH_MODEL = SPEECH_MODELS[DEFAULT_SPEECH_MODEL_ID].slug;

/** Picks the speech model and voice together, since voices belong to a model. */
export function resolveSpeechSettings(requestedModel: unknown, requestedVoice: unknown): { model: SpeechModelId; voice: string } {
  const voiceRaw = typeof requestedVoice === "string" ? requestedVoice.trim() : "";
  const modelRaw = typeof requestedModel === "string" ? requestedModel.trim().toLowerCase() : "";
  let model: SpeechModelId = DEFAULT_SPEECH_MODEL_ID;
  if (modelRaw) {
    const match = SPEECH_MODEL_IDS.find((id) => id === modelRaw || SPEECH_MODELS[id].slug === modelRaw);
    if (!match) throw new Error(`Unknown speech model ${modelRaw}. Use one of: ${SPEECH_MODEL_IDS.join(", ")}`);
    model = match;
  }
  const config: SpeechModelConfig = SPEECH_MODELS[model];
  if (!voiceRaw) return { model, voice: config.defaultVoice };
  const voice = config.voices.find((candidate) => candidate.toLowerCase() === voiceRaw.toLowerCase());
  if (voice) return { model, voice };
  throw new Error(`Unknown voice ${voiceRaw} for ${config.label}. Available voices: ${config.voices.join(", ")}`);
}
