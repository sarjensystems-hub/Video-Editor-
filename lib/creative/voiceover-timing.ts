import type { CreativeMarker } from "./schema";

export interface VoiceoverTimingSpan { text: string; startMs: number; endMs: number }
export interface VoiceoverTiming {
  /** Explicitly an estimate: Gemini/OpenRouter speech audio has no native timestamp payload. */
  source: "duration-aligned-estimate";
  durationMs: number;
  words: VoiceoverTimingSpan[];
  sentences: VoiceoverTimingSpan[];
}

/** Use an explicit spoken transcript when supplied; otherwise omit inline TTS performance tags. */
export function normalizeVoiceoverTranscript(prompt: string, transcript?: string): string {
  const source = transcript?.trim() || prompt;
  return source.replace(/\[[^\]\r\n]+\]/g, " ").replace(/\s+/g, " ").trim();
}

/** Deterministically distribute script tokens over the measured audio duration. */
export function alignVoiceoverText(text: string, durationMs: number): VoiceoverTiming {
  if (!Number.isFinite(durationMs) || durationMs <= 0) throw new Error("durationMs must be positive");
  const tokens = text.trim().match(/\S+/g) ?? [];
  if (!tokens.length) return { source: "duration-aligned-estimate", durationMs, words: [], sentences: [] };
  const weights = tokens.map((token) => {
    const spoken = token.replace(/[^\p{L}\p{N}]/gu, "").length;
    return Math.max(1, spoken) + (/[.!?][\]"')]*$/.test(token) ? 2.5 : /[,;:][\]"')]*$/.test(token) ? 1 : 0);
  });
  const total = weights.reduce((sum, weight) => sum + weight, 0);
  let elapsed = 0;
  const words = tokens.map((token, index) => {
    const startMs = index === 0 ? 0 : Math.round((elapsed / total) * durationMs);
    elapsed += weights[index];
    const endMs = index === tokens.length - 1 ? durationMs : Math.round((elapsed / total) * durationMs);
    return { text: token, startMs, endMs };
  });
  const sentences: VoiceoverTimingSpan[] = [];
  let sentenceStart = 0;
  for (let index = 0; index < words.length; index += 1) {
    if (!/[.!?][\]"')]*$/.test(words[index].text) && index < words.length - 1) continue;
    const span = words.slice(sentenceStart, index + 1);
    sentences.push({ text: span.map((word) => word.text).join(" "), startMs: span[0].startMs, endMs: span.at(-1)!.endMs });
    sentenceStart = index + 1;
  }
  return { source: "duration-aligned-estimate", durationMs, words, sentences };
}

export function voiceoverTimingsToMarkers(
  assetId: string,
  timing: VoiceoverTiming,
  options: { offsetMs?: number; granularity?: "words" | "sentences" | "both" } = {},
): CreativeMarker[] {
  const offsetMs = options.offsetMs ?? 0;
  if (!Number.isFinite(offsetMs) || offsetMs < 0) throw new Error("offsetMs must be non-negative");
  const granularity = options.granularity ?? "both";
  const marker = (span: VoiceoverTimingSpan, kind: "word" | "sentence", index: number): CreativeMarker => ({
    id: `voice-${assetId}-${kind}-${index + 1}`, timeMs: offsetMs + span.startMs, kind, label: span.text,
  });
  return [
    ...(granularity === "sentences" ? [] : timing.words.map((span, index) => marker(span, "word", index))),
    ...(granularity === "words" ? [] : timing.sentences.map((span, index) => marker(span, "sentence", index))),
  ].sort((left, right) => left.timeMs - right.timeMs || (left.kind === "word" ? -1 : 1));
}
