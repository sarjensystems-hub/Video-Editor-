/**
 * Video generation — pure constants and types, safe to import from both
 * Server and Client Components (mirrors the credit-costs.ts / credits.ts
 * split). The actual OpenRouter calls (server-only: API key, Buffer, fetch
 * to a third party) live in lib/video-gen-api.ts.
 *
 * Character references: OpenRouter's `input_references` field only accepts
 * `{ type: "image_url", image_url: { url } }` — there is no per-image name
 * field in the API, and the model never sees the URL or filename, only
 * decoded pixels. lib/video-gen-api.ts turns the `name` on each character
 * here into an auto-generated legend line prepended to the prompt at
 * submit time, so names still reach the model — as real text, the only
 * channel that actually works.
 */

export const VIDEO_ASPECT_RATIOS = ["16:9", "9:16"] as const;
export type VideoAspectRatio = (typeof VIDEO_ASPECT_RATIOS)[number];

export const VIDEO_RESOLUTIONS = ["720p", "480p"] as const;
export type VideoResolution = (typeof VIDEO_RESOLUTIONS)[number];

/** Seedance 2.0 Fast's own supported_durations is 4-15s (confirmed via the
 *  OpenRouter video models endpoint) — there is no shorter option. */
export const VIDEO_MIN_DURATION = 4;
export const VIDEO_MAX_DURATION = 15;

export const MAX_VIDEO_CHARACTERS = 12;

/**
 * How a model takes images:
 *  - "references": any number (up to maxImages) of `input_references`, with
 *    the name legend prepended to the prompt (Seedance, Grok Imagine 1.5).
 *  - "first_frame": exactly one image sent as `frame_images` with
 *    `frame_type: "first_frame"` — the video starts on that picture. No
 *    legend, since there is no list of references to name (Grok Imagine
 *    1.5 Lite).
 */
export type VideoImageInput = "references" | "first_frame";

export interface VideoModelSpec {
  id:          string;
  label:       string;
  minDuration: number;
  maxDuration: number;
  imageInput:  VideoImageInput;
  /** Most images one request may carry. */
  maxImages:   number;
}

export const VIDEO_MODELS = [
  {
    id: "bytedance/seedance-2.0-fast",
    label: "Seedance 2.0 Fast",
    minDuration: VIDEO_MIN_DURATION,
    maxDuration: VIDEO_MAX_DURATION,
    imageInput: "references",
    maxImages: MAX_VIDEO_CHARACTERS,
  },
  {
    id: "x-ai/grok-imagine-video-1.5",
    label: "Grok Imagine Video 1.5",
    minDuration: 1,
    maxDuration: 15,
    imageInput: "references",
    maxImages: 7,
  },
  {
    id: "x-ai/grok-imagine-video-1.5-lite",
    label: "Grok Imagine Video 1.5 Lite",
    minDuration: 1,
    maxDuration: 15,
    imageInput: "first_frame",
    maxImages: 1,
  },
] as const satisfies readonly VideoModelSpec[];

export const VIDEO_MODEL_IDS = VIDEO_MODELS.map((m) => m.id);

/** The catalog entry for a model id, or undefined for an id we don't know
 *  (still sent as-is, with Seedance-style references). */
export function videoModelSpec(id: string | undefined): VideoModelSpec | undefined {
  const key = id?.trim();
  return VIDEO_MODELS.find((m) => m.id === key);
}

export type VideoJobState = "pending" | "in_progress" | "completed" | "failed" | "cancelled" | "expired";

export interface VideoCharacterRef {
  /** Turned into an auto-generated legend line at submit time — see module doc above. */
  name: string;
  url:  string;
}

/** Shape of a `video_generations` row (supabase/add_video_generations.sql). */
export interface VideoGenerationRow {
  id:                 string;
  user_id:            string;
  openrouter_job_id:  string;
  status:             VideoJobState;
  prompt:             string;
  characters:         VideoCharacterRef[];
  aspect_ratio:       VideoAspectRatio;
  resolution:         VideoResolution;
  duration_seconds:   number;
  generate_audio:     boolean;
  video_url:          string | null;
  error:              string | null;
  credits_charged:    number;
  cost_usd:           number | null;
  created_at:         string;
  updated_at:         string;
}
