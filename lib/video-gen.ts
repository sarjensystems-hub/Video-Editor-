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
  site_id:            string;
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
