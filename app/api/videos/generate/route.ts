/**
 * POST /api/videos/generate
 *
 * Submits a Seedance 2.0 Fast video generation job via OpenRouter and
 * records it in `video_generations`. Returns immediately with the row id —
 * generation itself is async; the client polls GET /api/videos/status.
 *
 * Body: {
 *   prompt: string,               // the user's own text — stored as-is;
 *                                 // lib/video-gen-api.ts prepends an
 *                                 // auto-generated character-name legend
 *                                 // only in the outbound OpenRouter call
 *   aspectRatio: "16:9" | "9:16",
 *   resolution: "720p" | "480p",
 *   duration: number,             // 4-15 seconds
 *   characters: { name: string, url: string }[],  // up to 12, upload order preserved
 *   generateAudio: boolean,       // dialogue/music/sound alongside the video
 * }
 */
import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { getActiveSiteId } from "@/lib/active-site";
import {
  VIDEO_ASPECT_RATIOS,
  VIDEO_RESOLUTIONS,
  VIDEO_MIN_DURATION,
  VIDEO_MAX_DURATION,
  MAX_VIDEO_CHARACTERS,
  type VideoAspectRatio,
  type VideoResolution,
  type VideoCharacterRef,
} from "@/lib/video-gen";
import { submitVideoJob } from "@/lib/video-gen-api";

export const maxDuration = 60;


export async function POST(request: Request) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const siteId = await getActiveSiteId();
  if (!siteId) return NextResponse.json({ error: "No site selected" }, { status: 400 });

  const body = await request.json().catch(() => null);
  if (!body || typeof body !== "object") {
    return NextResponse.json({ error: "Invalid request body" }, { status: 400 });
  }

  const prompt = (body as Record<string, unknown>).prompt;
  if (typeof prompt !== "string" || !prompt.trim()) {
    return NextResponse.json({ error: "A prompt is required" }, { status: 400 });
  }

  const aspectRatio = (body as Record<string, unknown>).aspectRatio;
  if (!VIDEO_ASPECT_RATIOS.includes(aspectRatio as VideoAspectRatio)) {
    return NextResponse.json({ error: `aspectRatio must be one of ${VIDEO_ASPECT_RATIOS.join(", ")}` }, { status: 400 });
  }

  const resolution = (body as Record<string, unknown>).resolution;
  if (!VIDEO_RESOLUTIONS.includes(resolution as VideoResolution)) {
    return NextResponse.json({ error: `resolution must be one of ${VIDEO_RESOLUTIONS.join(", ")}` }, { status: 400 });
  }

  const duration = Number((body as Record<string, unknown>).duration);
  if (!Number.isInteger(duration) || duration < VIDEO_MIN_DURATION || duration > VIDEO_MAX_DURATION) {
    return NextResponse.json(
      { error: `duration must be an integer between ${VIDEO_MIN_DURATION} and ${VIDEO_MAX_DURATION} seconds` },
      { status: 400 },
    );
  }

  const charactersInput = (body as Record<string, unknown>).characters;
  const characters: VideoCharacterRef[] = Array.isArray(charactersInput)
    ? charactersInput
        .filter((c): c is { name?: unknown; url?: unknown } => !!c && typeof c === "object")
        .map((c) => ({ name: typeof c.name === "string" ? c.name : "", url: typeof c.url === "string" ? c.url : "" }))
        .filter((c) => c.url.trim().length > 0)
    : [];

  if (characters.length > MAX_VIDEO_CHARACTERS) {
    return NextResponse.json({ error: `Maximum ${MAX_VIDEO_CHARACTERS} characters` }, { status: 400 });
  }

  const generateAudio = (body as Record<string, unknown>).generateAudio === true;

  let submission;
  try {
    submission = await submitVideoJob({
      prompt,
      aspectRatio: aspectRatio as VideoAspectRatio,
      resolution:  resolution as VideoResolution,
      duration,
      characters,
      generateAudio,
    });
  } catch (e) {
    const message = e instanceof Error ? e.message : "Video generation failed to start.";
    return NextResponse.json({ error: message }, { status: 502 });
  }

  const { data: row, error: insertError } = await supabase
    .from("video_generations")
    .insert({
      user_id:            user.id,
      site_id:            siteId,
      openrouter_job_id:  submission.id,
      status:             submission.status ?? "pending",
      prompt,
      characters,
      aspect_ratio:       aspectRatio,
      resolution,
      duration_seconds:   duration,
      generate_audio:     generateAudio,
    })
    .select()
    .single();

  if (insertError || !row) {
    console.error("[videos/generate] insert failed:", insertError?.message, insertError?.details);
    return NextResponse.json(
      { error: insertError?.message ?? "Failed to save the generation job" },
      { status: 500 },
    );
  }

  return NextResponse.json({ job: row });
}
