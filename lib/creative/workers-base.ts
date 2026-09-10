import { generateSocialImage } from "../image-gen";
import { audioExtensionFor, containerFromFormat } from "./audio-format";
import {
  getRuntimeCreativeProject,
  registerRuntimeCreativeAsset,
  type CreativeRuntimeContext,
} from "./project-runtime";

export type CreativeImageFormat = "landscape" | "square" | "portrait";

export function normalizeCreativeImageFormat(value: unknown): CreativeImageFormat {
  return value === "landscape" || value === "square" || value === "portrait" ? value : "portrait";
}

export function canPromoteVideoGeneration(value: { status?: unknown; video_url?: unknown }): boolean {
  return value.status === "completed" && typeof value.video_url === "string" && /^https:\/\//i.test(value.video_url);
}

export function normalizeGeneratedAssetFilename(label: string | null | undefined, extension: string): string {
  const safe = (label ?? "")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 80);
  const base = safe || `generated-${Date.now().toString(36)}`;
  return `${base}.${extension.replace(/[^a-z0-9]/gi, "").toLowerCase() || "bin"}`;
}

export async function generateCreativeImageAsset(
  context: CreativeRuntimeContext,
  input: {
    projectId: string;
    prompt: string;
    format?: CreativeImageFormat;
    label?: string;
    referenceImages?: string[];
  },
) {
  const project = await getRuntimeCreativeProject(context, input.projectId);
  if (!project) throw new Error("Project not found");
  const prompt = input.prompt.trim();
  if (!prompt) throw new Error("prompt is required");
  const format = normalizeCreativeImageFormat(input.format);
  const generated = await generateSocialImage(prompt, format, input.referenceImages ?? []);
  if (!generated) throw new Error("Image generation returned no image");
  const label = input.label?.trim() || "creative-image";
  const { uploadAIImage } = await import("../storage");
  const url = await uploadAIImage(generated, context.userId, label);
  if (!url) throw new Error("Generated image could not be persisted");
  const filename = normalizeGeneratedAssetFilename(label, "png");
  return registerRuntimeCreativeAsset(context, {
    projectId: input.projectId,
    kind: "image",
    source: "studio-generation",
    url,
    mimeType: "image/png",
    filename,
    metadata: {
      worker: "image",
      prompt,
      format,
      reference_images: input.referenceImages ?? [],
    },
  });
}

export async function promoteCreativeVideoAsset(
  context: CreativeRuntimeContext,
  input: { projectId: string; generationId: string; label?: string },
) {
  const project = await getRuntimeCreativeProject(context, input.projectId);
  if (!project) throw new Error("Project not found");
  const { data, error } = await context.supabase
    .from("video_generations")
    .select("id, user_id, site_id, status, video_url, model, mode, duration_seconds, resolution, aspect_ratio, prompt")
    .eq("id", input.generationId)
    .eq("user_id", context.userId)
    .maybeSingle();
  if (error || !data) throw new Error("Video generation not found");
  if (!canPromoteVideoGeneration(data)) throw new Error("Video generation must be completed with a durable HTTPS URL before promotion");
  const label = input.label?.trim() || `generated-video-${String(data.id).slice(0, 8)}`;
  return registerRuntimeCreativeAsset(context, {
    projectId: input.projectId,
    kind: "video",
    source: "seedance/openrouter",
    url: String(data.video_url),
    mimeType: "video/mp4",
    filename: normalizeGeneratedAssetFilename(label, "mp4"),
    durationMs: data.duration_seconds ? Number(data.duration_seconds) * 1000 : null,
    metadata: {
      worker: "video-promotion",
      source_generation_id: data.id,
      model: data.model,
      mode: data.mode,
      resolution: data.resolution,
      aspect_ratio: data.aspect_ratio,
      prompt: data.prompt,
    },
  });
}


/**
 * Generates a voiceover and registers it as an audio asset.
 *
 * The document is not mutated: the returned asset has to be placed on the
 * timeline with an explicit add_audio_clip transaction, exactly like a
 * promoted video.
 */
export async function generateCreativeSpeechAsset(
  context: CreativeRuntimeContext,
  input: { projectId: string; text: string; transcript?: string; language?: string; voice?: string; label?: string },
) {
  const project = await getRuntimeCreativeProject(context, input.projectId);
  if (!project) throw new Error("Project not found");
  const text = input.text.trim();
  if (!text) throw new Error("text is required");

  const { normalizeSpeechLanguage, resolveSpeechVoice, DEFAULT_SPEECH_MODEL } = await import("./audio-workers");
  const language = normalizeSpeechLanguage(input.language);
  const voice = resolveSpeechVoice(input.voice);

  const { generateSpeechBytes } = await import("./audio-generate");
  const generated = await generateSpeechBytes({ text, voice });

  const label = input.label?.trim() || `voiceover-${language}`;
  const { uploadAnyBytes } = await import("../storage");
  const speechExtension = audioExtensionFor(
    containerFromFormat(generated.contentType.split("/").pop()) ?? "mp3",
  );
  const storagePath = `creative-audio/${context.userId}/${crypto.randomUUID()}.${speechExtension}`;
  const url = await uploadAnyBytes(generated.bytes, storagePath, generated.contentType);
  if (!url) throw new Error("Generated speech could not be persisted");

  return registerRuntimeCreativeAsset(context, {
    projectId: input.projectId,
    kind: "audio",
    source: "gemini-3.1-flash-tts/openrouter",
    url,
    mimeType: generated.contentType,
    filename: normalizeGeneratedAssetFilename(label, speechExtension),
    sizeBytes: generated.bytes.byteLength,
    storagePath,
    metadata: {
      worker: "speech",
      model: DEFAULT_SPEECH_MODEL,
      language,
      voice,
      text,
      ...(input.transcript?.trim() ? { transcript: input.transcript.trim() } : {}),
      generation_id: generated.generationId,
    },
  });
}

export async function addCreativeSfxAsset(
  context: CreativeRuntimeContext,
  input: { projectId: string; effectId: import("./sfx-library").CreativeSfxId; label?: string },
) {
  const project = await getRuntimeCreativeProject(context, input.projectId);
  if (!project) throw new Error("Project not found");
  const { generateDeterministicSfxWav } = await import("./sfx-library");
  const generated = generateDeterministicSfxWav(input.effectId);
  const { uploadAnyBytes } = await import("../storage");
  const storagePath = `creative-audio/${context.userId}/sfx-${input.effectId}-${crypto.randomUUID()}.wav`;
  const url = await uploadAnyBytes(generated.bytes, storagePath, generated.contentType);
  if (!url) throw new Error("Built-in sound effect could not be persisted");
  return registerRuntimeCreativeAsset(context, {
    projectId: input.projectId, kind: "audio", source: "studio-builtin-sfx", url,
    mimeType: generated.contentType, filename: normalizeGeneratedAssetFilename(input.label?.trim() || generated.effect.label, "wav"),
    sizeBytes: generated.bytes.byteLength, durationMs: generated.durationMs, storagePath,
    metadata: { worker: "builtin-sfx", effect_id: input.effectId, deterministic: true },
  });
}

/** Generates a music clip and registers it as an audio asset. */
export async function generateCreativeMusicAsset(
  context: CreativeRuntimeContext,
  input: { projectId: string; prompt: string; label?: string },
) {
  const project = await getRuntimeCreativeProject(context, input.projectId);
  if (!project) throw new Error("Project not found");
  const prompt = input.prompt.trim();
  if (!prompt) throw new Error("prompt is required");

  const { generateMusicBytes } = await import("./audio-generate");
  const { DEFAULT_MUSIC_MODEL } = await import("./audio-workers");
  const generated = await generateMusicBytes({ prompt });

  const label = input.label?.trim() || "music-bed";
  const { uploadAnyBytes } = await import("../storage");
  // The content type is now resolved by sniffing the bytes, so the extension
  // follows it rather than guessing between two of the five possibilities.
  const extension = audioExtensionFor(
    containerFromFormat(generated.contentType.split("/").pop()) ?? "mp3",
  );
  const storagePath = `creative-audio/${context.userId}/${crypto.randomUUID()}.${extension}`;
  const url = await uploadAnyBytes(generated.bytes, storagePath, generated.contentType);
  if (!url) throw new Error("Generated music could not be persisted");

  return registerRuntimeCreativeAsset(context, {
    projectId: input.projectId,
    kind: "audio",
    source: "lyria/openrouter",
    url,
    mimeType: generated.contentType,
    filename: normalizeGeneratedAssetFilename(label, extension),
    sizeBytes: generated.bytes.byteLength,
    storagePath,
    metadata: {
      worker: "music",
      model: DEFAULT_MUSIC_MODEL,
      prompt,
      generation_id: generated.generationId,
    },
  });
}
