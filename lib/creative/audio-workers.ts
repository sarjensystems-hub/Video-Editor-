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
 * - Speech: `elevenlabs/eleven-v4`, the only speech model. Ranked first on
 *   Artificial Analysis's blind-vote TTS arena and its pronunciation
 *   benchmark, and it speaks exactly what is written rather than adding
 *   breaths of its own - which matters when captions are timed to the script.
 *   Prose direction is spoken aloud, so it takes none; inline audio tags such
 *   as [excited] or [whispers] steer delivery. OpenRouter exposes 21 preset
 *   voices, and each speaks all 90+ of its languages - there is no separate
 *   "Indian voice": a Hindi or Tamil script is spoken in Hindi or Tamil.
 * - Music: `google/lyria-3-clip-preview` at $0.04 per 30-second clip. The Pro
 *   variant generates full songs for $0.08 and is overkill for short social.
 *
 * The optional language value is retained as asset metadata for callers that
 * want it; the speech model detects the language from the script itself.
 */

export const DEFAULT_MUSIC_MODEL = "google/lyria-3-clip-preview";

/** Normalizes an optional metadata label; the model detects the spoken language. */
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

/** The Indian languages Eleven v4 speaks, as its model page lists them. */
export const ELEVEN_V4_INDIAN_LANGUAGES = [
  "Hindi", "Bengali", "Marathi", "Gujarati", "Tamil", "Telugu", "Kannada",
  "Malayalam", "Punjabi", "Odia", "Assamese", "Nepali", "Urdu", "Sindhi",
] as const;

export interface SpeechModelConfig {
  slug: string;
  label: string;
  voices: readonly string[];
  defaultVoice: string;
}

export const SPEECH_MODELS = {
  "eleven-v4": {
    slug: "elevenlabs/eleven-v4",
    label: "ElevenLabs Eleven v4",
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
