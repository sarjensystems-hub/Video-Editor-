/**
 * Server-only OpenRouter calls for video generation — ByteDance Seedance
 * 2.0 Fast via OpenRouter's dedicated async video API (POST/GET
 * /api/v1/videos — NOT the chat-completions endpoint used elsewhere in
 * lib/openrouter.ts).
 *
 * Flow: submit a job → poll until `completed` → download the raw video
 * bytes from the content endpoint.
 *
 * Character naming: OpenRouter's `input_references` field only accepts
 * `{ type: "image_url", image_url: { url } }` — there is no per-image name
 * field in the API, and the model never sees the image URL or filename
 * (only the decoded pixels). The ONLY channel that reaches the model with
 * real name information is the text prompt itself. So when characters are
 * attached, we prepend one auto-generated legend line — e.g. "Reference
 * image 1 is Alice. Reference image 2 is Bob. Match each character's
 * appearance exactly to their reference image." — built from the `name`
 * each character was given in the UI, in upload order (the same order
 * they're sent as input_references). The user's own prompt text after that
 * line is untouched — nothing else is added, rewritten, or trimmed. With
 * zero characters attached, the prompt is sent completely as-is.
 *
 * Client-safe constants/types live in lib/video-gen.ts — import those from
 * Client Components, import this module only from server code (route
 * handlers), since it resolves the request's OpenRouter key and uses Buffer.
 */
import { requireOpenRouterKey } from "@/lib/openrouter-key";
import type { VideoAspectRatio, VideoResolution, VideoJobState, VideoCharacterRef } from "@/lib/video-gen";

export const DEFAULT_VIDEO_MODEL = "bytedance/seedance-2.0-fast";
const API_BASE = "https://openrouter.ai/api/v1/videos";

/**
 * Builds the character-name legend line — the only channel that actually
 * gets a name to the model. Numbering always matches array position (not
 * just named entries) so it stays aligned with the input_references array
 * built from the same list. Repeating a name across multiple uploaded
 * images is intentional and valid.
 */
function buildCharacterLegend(characters: VideoCharacterRef[], instruction?: string): string {
  if (characters.length === 0) return "";
  const lines = characters.map((c, i) => `Reference image ${i + 1} is ${c.name.trim() || `Character ${i + 1}`}.`);
  const matchInstruction = instruction?.trim() || "Match each character's appearance exactly to their reference image.";
  return `${lines.join(" ")} ${matchInstruction}`;
}

async function authHeaders(): Promise<Record<string, string>> {
  return {
    Authorization: `Bearer ${await requireOpenRouterKey()}`,
    "HTTP-Referer": process.env.NEXT_PUBLIC_APP_URL ?? "https://studio.example.com",
    "X-Title": "Studio",
  };
}

export interface SubmitVideoJobParams {
  /** The user's own prompt text, exactly as typed — see module doc for
   *  the one thing that's prepended to it (the character/reference legend). */
  prompt: string;
  aspectRatio: VideoAspectRatio;
  resolution: VideoResolution;
  duration: number;
  /** Character/reference images + names, in the order they should be sent. */
  characters: VideoCharacterRef[];
  /** Whether to request dialogue/music/sound alongside the video. */
  generateAudio: boolean;
  /** Optional provider model override. Existing Studio callers omit it. */
  model?: string;
  /** Optional legend instruction for non-character references (cars/products/etc.). */
  referenceInstruction?: string;
}

export interface VideoJobSubmission {
  id: string;
  status: string;
  polling_url?: string;
}

/** Submit a new generation job. Returns immediately with a job id to poll. */
export async function submitVideoJob(params: SubmitVideoJobParams): Promise<VideoJobSubmission> {
  const legend = buildCharacterLegend(params.characters, params.referenceInstruction);
  const prompt = legend ? `${legend}\n\n${params.prompt}` : params.prompt;

  const body: Record<string, unknown> = {
    model: params.model?.trim() || DEFAULT_VIDEO_MODEL,
    prompt,
    duration: params.duration,
    resolution: params.resolution,
    aspect_ratio: params.aspectRatio,
    generate_audio: params.generateAudio,
  };

  if (params.characters.length > 0) {
    body.input_references = params.characters.map((c) => ({
      type: "image_url",
      image_url: { url: c.url },
    }));
  }

  const res = await fetch(API_BASE, {
    method: "POST",
    headers: { "Content-Type": "application/json", ...(await authHeaders()) },
    body: JSON.stringify(body),
  });

  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(`OpenRouter video submit ${res.status}: ${text.slice(0, 600)}`);
  }

  return res.json();
}

export interface VideoJobStatus {
  id: string;
  status: VideoJobState;
  polling_url: string;
  error?: string;
  generation_id?: string;
  unsigned_urls?: string[];
  usage?: {
    cost: number | null;
    is_byok: boolean;
  };
}

/** Poll a job's current status. */
export async function pollVideoJob(jobId: string): Promise<VideoJobStatus> {
  const res = await fetch(`${API_BASE}/${jobId}`, { headers: await authHeaders() });

  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(`OpenRouter video poll ${res.status}: ${text.slice(0, 600)}`);
  }

  return res.json();
}

/**
 * Download the raw, unmodified video bytes for a completed job straight
 * from OpenRouter's content endpoint — no transcoding, no re-encoding.
 */
export async function downloadVideoContent(
  jobId: string,
  index = 0,
): Promise<{ bytes: Buffer; contentType: string }> {
  const res = await fetch(`${API_BASE}/${jobId}/content?index=${index}`, { headers: await authHeaders() });

  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(`OpenRouter video download ${res.status}: ${text.slice(0, 600)}`);
  }

  const contentType = res.headers.get("content-type") ?? "video/mp4";
  const bytes = Buffer.from(await res.arrayBuffer());
  return { bytes, contentType };
}
