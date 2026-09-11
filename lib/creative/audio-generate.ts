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
import { resolveAudioContainer, audioContentTypeFor, sniffAudioContainer, wrapPcmInWav } from "./audio-format";
import {
  DEFAULT_MUSIC_MODEL,
  DEFAULT_SPEECH_MODEL,
  SPEECH_PCM_FORMAT,
  SPEECH_RESPONSE_FORMAT,
} from "./audio-workers";

const API_BASE = "https://openrouter.ai/api/v1";

async function authHeaders(): Promise<Record<string, string>> {
  return {
    Authorization: `Bearer ${await requireOpenRouterKey()}`,
    "HTTP-Referer": process.env.NEXT_PUBLIC_APP_URL ?? "https://studio.example.com",
    "X-Title": "Studio",
  };
}

export interface GeneratedAudio {
  bytes: Buffer;
  contentType: string;
  /** OpenRouter generation id, for cost lookup after the fact. */
  generationId: string | null;
}

/**
 * Gemini returns HTTP 200 and zero audio frames when it reads the entire
 * prompt as performance direction and finds nothing left to speak.
 *
 * Measured against the live model, holding the voice constant:
 *
 *   "Still."                                             -> 1160ms of audio
 *   "Dry, deadpan. Still."                               -> empty
 *   "[deadpan] White. Black. Still."                     -> empty
 *   `Say the following line ...: "White. Black. Still."` -> 3000ms of audio
 *   "[deadpan] White. Black. Still. This is how every    -> 13080ms of audio
 *    promotional film used to begin, and ..."
 *
 * So it is neither the length nor the amount of direction - the fourth case
 * carries more direction than the third and works. It is direction that is
 * not marked off from the script, next to a line too short to outweigh it.
 * Framing the words to be spoken fixes it at any length.
 *
 * This has to be said in the error rather than left to the caller, because the
 * provider's own message ("empty audio stream after returning HTTP 200")
 * reads as a transient fault: the first agent to hit it diagnosed a flake and
 * asked for a retry, which was already in the code and had already run.
 */
const EMPTY_SPEECH_MESSAGE =
  "Speech generation returned no audio. Gemini read the whole prompt as performance " +
  "direction and found nothing to speak - it does this when direction is not marked " +
  "off from the script and the line is short. Frame the words instead: " +
  'Say the following line in a dry, deadpan tone: "White. Black. Still."' +
  " Direction inline with a longer line is fine; a bare [tag] on a few words is not.";

function isEmptyAudioStream(detail: string): boolean {
  return /empty audio stream/i.test(detail);
}

/** Synthesizes speech and returns the exact bytes OpenRouter produced. */
export async function generateSpeechBytes(input: {
  text: string;
  voice: string;
  model?: string;
  speed?: number;
}): Promise<GeneratedAudio> {
  const request: RequestInit = {
    method: "POST",
    headers: { ...(await authHeaders()), "Content-Type": "application/json" },
    body: JSON.stringify({
      model: input.model ?? DEFAULT_SPEECH_MODEL,
      input: input.text,
      voice: input.voice,
      response_format: SPEECH_RESPONSE_FORMAT,
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

  const raw = Buffer.from(await response.arrayBuffer());
  // Same condition, caught here instead when the provider returns 200 with a
  // zero-length body and OpenRouter passes it through rather than flagging it.
  if (raw.byteLength <= 0) throw new Error(EMPTY_SPEECH_MESSAGE);

  // Headerless PCM is the one thing the sniffer cannot recognise, so it would
  // fall through to the "mp3" default and be stored as .mp3 over bytes that are
  // not MP3. Wrap it in a WAV header instead - lossless, and pcm-s16 is already
  // a supported codec downstream. Guarded by a sniff so that a provider which
  // ignores the pcm request and returns a real container is passed through
  // untouched rather than double-wrapped.
  const bytes = sniffAudioContainer(raw) === null
    ? wrapPcmInWav(raw, SPEECH_PCM_FORMAT)
    : raw;

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
