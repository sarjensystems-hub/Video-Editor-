import * as base from "./workers-base";
import { probeAudioDurationMs } from "./audio-analysis";
import type { CreativeRuntimeContext } from "./project-runtime";

export * from "./workers-base";

async function persistMeasuredDuration(
  context: CreativeRuntimeContext,
  asset: { id: unknown; url: unknown; duration_ms?: unknown },
) {
  const url = typeof asset.url === "string" ? asset.url : "";
  if (!url) throw new Error("Generated audio asset has no durable URL");
  const durationMs = await probeAudioDurationMs(url);
  const metadata = asset && typeof asset === "object" && "metadata" in asset
    ? ((asset as { metadata?: Record<string, unknown> }).metadata ?? {})
    : {};
  const prompt = typeof metadata.text === "string" ? metadata.text : null;
  const transcript = typeof metadata.transcript === "string" ? metadata.transcript : undefined;
  const timingText = prompt ? (await import("./voiceover-timing")).normalizeVoiceoverTranscript(prompt, transcript) : "";
  const voiceoverTiming = timingText ? (await import("./voiceover-timing")).alignVoiceoverText(timingText, durationMs) : undefined;
  const nextMetadata = voiceoverTiming ? { ...metadata, voiceover_timing: voiceoverTiming } : metadata;
  const durationUpdate = voiceoverTiming ? { duration_ms: durationMs, metadata: nextMetadata } : { duration_ms: durationMs };
  const { error } = await context.supabase
    .from("creative_assets")
    .update(durationUpdate)
    .eq("id", String(asset.id))
    .eq("user_id", context.userId);
  if (error) throw new Error(`Generated audio duration could not be persisted: ${error.message}`);
  return voiceoverTiming ? { ...asset, duration_ms: durationMs, metadata: nextMetadata } : { ...asset, duration_ms: durationMs };
}

/** Generate speech, then refuse to return it until its real duration is known. */
export async function generateCreativeSpeechAsset(
  context: CreativeRuntimeContext,
  input: { projectId: string; text: string; transcript?: string; language?: string; voice?: string; label?: string },
) {
  return persistMeasuredDuration(context, await base.generateCreativeSpeechAsset(context, input));
}

/** Generate music, then refuse to return it until its real duration is known. */
export async function generateCreativeMusicAsset(
  context: CreativeRuntimeContext,
  input: { projectId: string; prompt: string; label?: string },
) {
  return persistMeasuredDuration(context, await base.generateCreativeMusicAsset(context, input));
}
