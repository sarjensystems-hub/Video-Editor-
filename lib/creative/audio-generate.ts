/**
 * Server-only OpenRouter calls for speech and music generation.
 *
 * Kept apart from `audio-workers.ts` so the model choices and voice tables
 * stay pure and unit-testable; this file is the side-effecting boundary that
 * reads the API key and returns bytes.
 *
 * Speech uses OpenRouter's dedicated TTS endpoint (POST /audio/speech), which
 * returns a raw audio bytestream rather than JSON — deliberately not the
 * chat-completions endpoint.
 */
import { requireOpenRouterKey } from "../openrouter-key";
import { appUrl } from "@/lib/app-url";
import { resolveAudioContainer, audioContentTypeFor } from "./audio-format";
import {
  DEFAULT_MUSIC_MODEL,
  DEFAULT_SPEECH_MODEL_ID,
  SPEECH_MODELS,
  type SpeechModelConfig,
  type SpeechModelId,
} from "./audio-workers";

const API_BASE = "https://openrouter.ai/api/v1";

async function authHeaders(): Promise<Record<string, string>> {
  return {
    Authorization: `Bearer ${await requireOpenRouterKey()}`,
    "HTTP-Referer": appUrl(),
    "X-Title": "Studio",
  };
}

export interface GeneratedAudio {
  bytes: Buffer;
  contentType: string;
  /** OpenRouter generation id, for cost lookup after the fact. */
  generationId: string | null;
}

const EMPTY_SPEECH_MESSAGE = "Speech generation returned no audio.";

function isEmptyAudioStream(detail: string): boolean {
  return /empty audio stream/i.test(detail);
}

/** Synthesizes speech and returns the exact bytes OpenRouter produced. */
export async function generateSpeechBytes(input: {
  text: string;
  voice: string;
  model?: SpeechModelId;
  speed?: number;
}): Promise<GeneratedAudio> {
  const config: SpeechModelConfig = SPEECH_MODELS[input.model ?? DEFAULT_SPEECH_MODEL_ID];
  const request: RequestInit = {
    method: "POST",
    headers: { ...(await authHeaders()), "Content-Type": "application/json" },
    body: JSON.stringify({
      model: config.slug,
      input: input.text,
      voice: input.voice,
      response_format: "mp3",
      ...(input.speed === undefined ? {} : { speed: input.speed }),
    }),
  };
  let response: Response | null = null;
  for (let attempt = 0; attempt < 2; attempt += 1) {
    response = await fetch(`${API_BASE}/audio/speech`, request);
    if (response.ok) break;
    const detail = await response.text().catch(() => "");
    // An empty audio stream is deterministic, not transient, so the retry is
    // spent for nothing and the caller waits twice as long to learn the same
    // thing. Measured: the same input returns it on every attempt.
    if (isEmptyAudioStream(detail)) throw new Error(EMPTY_SPEECH_MESSAGE);
    if (response.status < 500 || attempt === 1) {
      throw new Error(`Speech generation failed (${response.status}): ${detail.slice(0, 500)}`);
    }
  }
  if (!response?.ok) throw new Error("Speech generation failed without a response");

  const bytes = Buffer.from(await response.arrayBuffer());
  // Same condition, caught here instead when the provider returns 200 with a
  // zero-length body and OpenRouter passes it through rather than flagging it.
  if (bytes.byteLength <= 0) throw new Error(EMPTY_SPEECH_MESSAGE);

  return {
    bytes,
    contentType: audioContentTypeFor(
      resolveAudioContainer(bytes, response.headers.get("content-type")?.split("/").pop()),
    ),
    generationId: response.headers.get("x-generation-id"),
  };
}

/**
 * OpenRouter audio output is an SSE-only contract: audio bytes arrive as
 * base64 fragments on `choices[0].delta.audio.data`. Keep the parser narrow
 * and tolerant of SSE comments/heartbeats, but reject malformed `data:`
 * events rather than silently producing corrupt media.
 */
function parseAudioSse(payload: string): {
  data: string;
  format: string | null;
  generationId: string | null;
} {
  const chunks: string[] = [];
  let format: string | null = null;
  let generationId: string | null = null;

  for (const rawLine of payload.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith(":")) continue;
    if (!line.startsWith("data:")) continue;
    const data = line.slice(5).trim();
    if (!data || data === "[DONE]") continue;

    let event: {
      id?: string;
      choices?: Array<{ delta?: { audio?: { data?: string; format?: string } } }>;
    };
    try {
      event = JSON.parse(data) as typeof event;
    } catch {
      throw new Error("Music generation returned malformed streaming audio data");
    }

    if (!generationId && typeof event.id === "string" && event.id) generationId = event.id;
    const audio = event.choices?.[0]?.delta?.audio;
    if (typeof audio?.format === "string" && audio.format) format = audio.format;
    if (typeof audio?.data === "string" && audio.data) chunks.push(audio.data);
  }

  return { data: chunks.join(""), format, generationId };
}

/**
 * Generates a music clip.
 *
 * OpenRouter requires audio-output chat completions to use `stream: true`.
 * Lyria therefore arrives as server-sent events rather than one JSON message;
 * we concatenate the documented `delta.audio.data` fragments and decode the
 * resulting base64 payload once, preserving the exact generated bytes.
 */
export async function generateMusicBytes(input: {
  prompt: string;
  model?: string;
}): Promise<GeneratedAudio> {
  const response = await fetch(`${API_BASE}/chat/completions`, {
    method: "POST",
    headers: { ...(await authHeaders()), "Content-Type": "application/json" },
    body: JSON.stringify({
      model: input.model ?? DEFAULT_MUSIC_MODEL,
      modalities: ["text", "audio"],
      stream: true,
      messages: [{ role: "user", content: input.prompt }],
    }),
  });

  if (!response.ok) {
    const detail = await response.text().catch(() => "");
    throw new Error(`Music generation failed (${response.status}): ${detail.slice(0, 500)}`);
  }

  const audio = parseAudioSse(await response.text());
  if (!audio.data) throw new Error("Music generation returned no audio");

  const bytes = Buffer.from(audio.data, "base64");
  if (bytes.byteLength <= 0) throw new Error("Music generation returned empty audio");
  return {
    bytes,
    contentType: audioContentTypeFor(resolveAudioContainer(bytes, audio.format)),
    generationId: audio.generationId,
  };
}
