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

export const VIDEO_RESOLUTIONS = ["720p", "480p", "360p", "1080p"] as const;
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

/** Frames a model can be pinned to, sent as OpenRouter `frame_images`. */
export const VIDEO_FRAME_TYPES = ["first_frame", "last_frame"] as const;
export type VideoFrameType = (typeof VIDEO_FRAME_TYPES)[number];

export interface VideoModelSpec {
  id:          string;
  label:       string;
  minDuration: number;
  maxDuration: number;
  imageInput:  VideoImageInput;
  /** Most images one request may carry. */
  maxImages:   number;
  /** Resolutions the model accepts, as OpenRouter's video models endpoint
   *  lists them (narrowed to VIDEO_RESOLUTIONS). */
  resolutions: readonly VideoResolution[];
  /** For a "references" model: frames it also takes alongside the references.
   *  An image tagged with one of these goes to `frame_images`, not the list. */
  frameImages?: readonly VideoFrameType[];
}

export const VIDEO_MODELS = [
  {
    id: "bytedance/seedance-2.0-fast",
    label: "Seedance 2.0 Fast",
    minDuration: VIDEO_MIN_DURATION,
    maxDuration: VIDEO_MAX_DURATION,
    imageInput: "references",
    maxImages: MAX_VIDEO_CHARACTERS,
    resolutions: ["480p", "720p"],
  },
  {
    id: "x-ai/grok-imagine-video-1.5",
    label: "Grok Imagine Video 1.5",
    minDuration: 1,
    maxDuration: 15,
    imageInput: "references",
    maxImages: 7,
    resolutions: ["480p", "720p", "1080p"],
  },
  {
    id: "x-ai/grok-imagine-video-1.5-lite",
    label: "Grok Imagine Video 1.5 Lite",
    minDuration: 1,
    maxDuration: 15,
    imageInput: "first_frame",
    maxImages: 1,
    resolutions: ["480p", "720p", "1080p"],
  },
  {
    // OpenRouter lists 3-15s and 360p/720p/1080p/4K, no 480p (4K not offered here).
    id: "google/gemini-omni-1.2-flash",
    label: "Gemini Omni 1.2 Flash",
    minDuration: 3,
    maxDuration: 15,
    imageInput: "references",
    maxImages: 3,
    resolutions: ["360p", "720p", "1080p"],
    frameImages: ["first_frame", "last_frame"],
  },
] as const satisfies readonly VideoModelSpec[];

export const VIDEO_MODEL_IDS = VIDEO_MODELS.map((m) => m.id);

/** Resolutions a model accepts. An unknown model id is held to 480p/720p,
 *  the two every model here has supported since before the list existed. */
export function videoModelResolutions(spec: VideoModelSpec | undefined): readonly VideoResolution[] {
  return spec?.resolutions ?? ["720p", "480p"];
}

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
  /** Pin this image as the clip's first or last frame instead of a named
   *  reference, on a model whose spec lists that frame in frameImages. */
  frame?: VideoFrameType;
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
