/**
 * POST /api/videos/generate
 *
 * Submits a video generation job (Seedance 2.0 Fast by default) via OpenRouter and
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
 *   model?: string,               // one of VIDEO_MODEL_IDS; default Seedance.
 *                                 // Grok Imagine 1.5 Lite takes one image,
 *                                 // used as the first frame
 * }
 */
import { randomUUID } from "node:crypto";
import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import {
  VIDEO_ASPECT_RATIOS,
  VIDEO_RESOLUTIONS,
  VIDEO_MIN_DURATION,
  VIDEO_MAX_DURATION,
  MAX_VIDEO_CHARACTERS,
  VIDEO_MODEL_IDS,
  videoModelSpec,
  type VideoAspectRatio,
  type VideoResolution,
  type VideoCharacterRef,
} from "@/lib/video-gen";
import { withOpenRouterKeyScope } from "@/lib/openrouter-key-route";
import { DEFAULT_VIDEO_MODEL, submitVideoJob } from "@/lib/video-gen-api";
import { requestOrigin } from "@/lib/app-url";
import { jobCallbackUrl } from "@/lib/job-callbacks";

export const maxDuration = 60;


async function handlePOST(request: Request) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

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

  const modelInput = (body as Record<string, unknown>).model;
  const spec = modelInput === undefined || modelInput === null || modelInput === ""
    ? undefined
    : videoModelSpec(typeof modelInput === "string" ? modelInput : undefined);
  if (modelInput !== undefined && modelInput !== null && modelInput !== "" && !spec) {
    return NextResponse.json({ error: `model must be one of ${VIDEO_MODEL_IDS.join(", ")}` }, { status: 400 });
  }
  const minDuration = spec?.minDuration ?? VIDEO_MIN_DURATION;
  const maxDuration = spec?.maxDuration ?? VIDEO_MAX_DURATION;
  const maxImages = spec?.maxImages ?? MAX_VIDEO_CHARACTERS;

  const duration = Number((body as Record<string, unknown>).duration);
  if (!Number.isInteger(duration) || duration < minDuration || duration > maxDuration) {
    return NextResponse.json(
      { error: `duration must be an integer between ${minDuration} and ${maxDuration} seconds` },
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

  if (characters.length > maxImages) {
    const error = spec?.imageInput === "first_frame"
      ? `${spec.label} takes a single image, used as the first frame`
      : `Maximum ${maxImages} characters`;
    return NextResponse.json({ error }, { status: 400 });
  }

  const generateAudio = (body as Record<string, unknown>).generateAudio === true;
  const model = spec?.id ?? DEFAULT_VIDEO_MODEL;

  // The row's id is chosen before submitting so OpenRouter can be handed a
  // callback URL naming it: a finished video is then fetched even if this
  // browser tab is closed before it polls.
  const jobId = randomUUID();
  const callbackUrl = jobCallbackUrl(await requestOrigin().catch(() => ""), "video", jobId);

  // Recorded before anything is spent, so a job OpenRouter accepted always has
  // a row to land in, even if this function dies right after submitting.
  const { error: reserveError } = await supabase
    .from("video_generations")
    .insert({
      id:                 jobId,
      user_id:            user.id,
      model,
      openrouter_job_id:  null,
      status:             "pending",
      prompt,
      characters,
      aspect_ratio:       aspectRatio,
      resolution,
      duration_seconds:   duration,
      generate_audio:     generateAudio,
    });
  if (reserveError) {
    console.error("[videos/generate] insert failed:", reserveError.message, reserveError.details);
    return NextResponse.json({ error: reserveError.message }, { status: 500 });
  }

  let submission;
  try {
    submission = await submitVideoJob({
      prompt,
      aspectRatio: aspectRatio as VideoAspectRatio,
      resolution:  resolution as VideoResolution,
      duration,
      characters,
      generateAudio,
      model,
      callbackUrl,
    });
  } catch (e) {
    const message = e instanceof Error ? e.message : "Video generation failed to start.";
    // Nothing was accepted upstream, so the reservation has nothing to track.
    await supabase.from("video_generations").delete().eq("id", jobId).eq("user_id", user.id).is("openrouter_job_id", null);
    return NextResponse.json({ error: message }, { status: 502 });
  }

  const { data: row, error: updateError } = await supabase
    .from("video_generations")
    .update({
      openrouter_job_id:  submission.id,
      status:             submission.status ?? "pending",
      updated_at:         new Date().toISOString(),
    })
    .eq("id", jobId)
    .eq("user_id", user.id)
    .select()
    .single();

  if (updateError || !row) {
    // The job is running and paid for; its callback carries the OpenRouter id
    // and adopts it into this row (app/api/videos/callback).
    console.error("[videos/generate] could not record the OpenRouter job id:", updateError?.message);
    return NextResponse.json(
      { error: "The video was started but could not be recorded yet; it will appear when it finishes." },
      { status: 500 },
    );
  }

  return NextResponse.json({ job: row });
}

/* Generation on this route bills the signed-in account's own OpenRouter key. */
export const POST = withOpenRouterKeyScope(handlePOST);
