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
 *   as [excited] or [whispers] steer delivery. OpenRouter lists 21 preset
 *   voices, and each speaks all 90+ of its languages. It also accepts any
 *   ElevenLabs Voice Library voice by its 20-character ID, which is how the
 *   Indian English voices below are reached on the same OpenRouter key.
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

/**
 * Indian English voices from the ElevenLabs Voice Library, sent to OpenRouter
 * by ID. Each returned Eleven v4 audio through OpenRouter on 24 Oct 2026; the
 * IDs come from json2video.com's ElevenLabs catalogue. Only Ranbir has been
 * judged by ear, and none has been tried on a Hindi script yet.
 */
export const ELEVENLABS_LIBRARY_VOICES = {
  Ranbir: { id: "2iAXJEMO2o0PqUHzvZwQ", gender: "male", note: "neutral and clean, middle-aged; the one picked by ear for calm narration" },
  Raju: { id: "pzxut4zZz4GImZNlqQ3H", gender: "male" },
  Viraj: { id: "bajNon13EdhNMndG3z05", gender: "male" },
  Manav: { id: "2BsEFcU7jUhLaUwV4h7l", gender: "male" },
  Aakash: { id: "MXGyTMlsvQgQ4BL0emIa", gender: "male" },
  Tara: { id: "P7vsEyTOpZ6YUTulin8m", gender: "female" },
  Sia: { id: "6JsmTroalVewG1gA6Jmw", gender: "female" },
  Naina: { id: "6BZyx2XekeeXOkTVn8un", gender: "female" },
  Simran: { id: "1ea3IFhmSWgw8sJkSvfJ", gender: "female" },
} satisfies Record<string, { id: string; gender: "male" | "female"; note?: string }>;
export type ElevenLabsLibraryVoice = keyof typeof ELEVENLABS_LIBRARY_VOICES;
export const ELEVENLABS_LIBRARY_VOICE_NAMES = Object.keys(ELEVENLABS_LIBRARY_VOICES) as ElevenLabsLibraryVoice[];

/** An ElevenLabs voice ID: 20 letters and digits. */
const VOICE_ID_PATTERN = /^[A-Za-z0-9]{20}$/;

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

/**
 * Picks the speech model and voice together, since voices belong to a model.
 * `voice` is what goes on the wire: a preset's name, or a library voice's ID.
 * `voiceName` is the readable name, kept on the asset.
 */
export function resolveSpeechSettings(
  requestedModel: unknown,
  requestedVoice: unknown,
): { model: SpeechModelId; voice: string; voiceName: string } {
  const voiceRaw = typeof requestedVoice === "string" ? requestedVoice.trim() : "";
  const modelRaw = typeof requestedModel === "string" ? requestedModel.trim().toLowerCase() : "";
  let model: SpeechModelId = DEFAULT_SPEECH_MODEL_ID;
  if (modelRaw) {
    const match = SPEECH_MODEL_IDS.find((id) => id === modelRaw || SPEECH_MODELS[id].slug === modelRaw);
    if (!match) throw new Error(`Unknown speech model ${modelRaw}. Use one of: ${SPEECH_MODEL_IDS.join(", ")}`);
    model = match;
  }
  const config: SpeechModelConfig = SPEECH_MODELS[model];
  if (!voiceRaw) return { model, voice: config.defaultVoice, voiceName: config.defaultVoice };
  const preset = config.voices.find((candidate) => candidate.toLowerCase() === voiceRaw.toLowerCase());
  if (preset) return { model, voice: preset, voiceName: preset };
  const library = ELEVENLABS_LIBRARY_VOICE_NAMES.find((name) => name.toLowerCase() === voiceRaw.toLowerCase());
  if (library) return { model, voice: ELEVENLABS_LIBRARY_VOICES[library].id, voiceName: library };
  const known = ELEVENLABS_LIBRARY_VOICE_NAMES.find((name) => ELEVENLABS_LIBRARY_VOICES[name].id === voiceRaw);
  if (known) return { model, voice: voiceRaw, voiceName: known };
  if (VOICE_ID_PATTERN.test(voiceRaw)) return { model, voice: voiceRaw, voiceName: voiceRaw };
  throw new Error(
    `Unknown voice ${voiceRaw} for ${config.label}. Available voices: ${config.voices.join(", ")}; ` +
    `Indian English: ${ELEVENLABS_LIBRARY_VOICE_NAMES.join(", ")}; or any 20-character ElevenLabs voice ID`,
  );
}
