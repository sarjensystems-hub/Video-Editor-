/**
 * GET /api/videos/status/[id]
 *
 * Polls (and advances) a video_generations row:
 *  - pending/in_progress → re-checks the OpenRouter job, updates status
 *  - completed on OpenRouter but not yet persisted → downloads the raw
 *    video bytes (no re-encoding) and stores them, then marks the row done
 *  - failed/cancelled/expired → records the error
 *
 * Terminal rows (already completed/failed/cancelled/expired with a
 * video_url or error already recorded) are returned as-is without an
 * upstream call.
 */
import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { uploadAnyBytes } from "@/lib/storage";
import type { VideoGenerationRow } from "@/lib/video-gen";
import { pollVideoJob, downloadVideoContent } from "@/lib/video-gen-api";

export const maxDuration = 60;

const TERMINAL_STATES = new Set(["completed", "failed", "cancelled", "expired"]);

export async function GET(
  _req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { id } = await params;

  const { data: row } = await supabase
    .from("video_generations")
    .select("*")
    .eq("id", id)
    .eq("user_id", user.id)
    .single();

  if (!row) return NextResponse.json({ error: "Not found" }, { status: 404 });

  const current = row as VideoGenerationRow;

  // Already settled and fully persisted — nothing more to do.
  if (current.status === "completed" && current.video_url) {
    return NextResponse.json({ job: current });
  }
  if (TERMINAL_STATES.has(current.status) && current.status !== "completed") {
    return NextResponse.json({ job: current });
  }

  let upstream;
  try {
    upstream = await pollVideoJob(current.openrouter_job_id);
  } catch (e) {
    const message = e instanceof Error ? e.message : "Failed to check generation status.";
    return NextResponse.json({ error: message }, { status: 502 });
  }

  // Still running — reflect the latest status without touching anything else.
  if (upstream.status === "pending" || upstream.status === "in_progress") {
    if (upstream.status !== current.status) {
      await supabase
        .from("video_generations")
        .update({ status: upstream.status, updated_at: new Date().toISOString() })
        .eq("id", id);
    }
    return NextResponse.json({ job: { ...current, status: upstream.status } });
  }

  if (upstream.status === "completed") {
    try {
      const { bytes, contentType } = await downloadVideoContent(current.openrouter_job_id);
      const ext  = contentType.includes("mp4") ? "mp4" : contentType.split("/")[1] || "mp4";
      const path = `${user.id}/video-${current.id}.${ext}`;
      const url  = await uploadAnyBytes(bytes, path, contentType);

      if (!url) throw new Error("Failed to store the generated video.");

      const { data: updated } = await supabase
        .from("video_generations")
        .update({
          status:     "completed",
          video_url:  url,
          cost_usd:   upstream.usage?.cost ?? null,
          updated_at: new Date().toISOString(),
        })
        .eq("id", id)
        .select()
        .single();

      return NextResponse.json({ job: updated ?? { ...current, status: "completed", video_url: url } });
    } catch (e) {
      const message = e instanceof Error ? e.message : "Failed to download the generated video.";
      const { data: updated } = await supabase
        .from("video_generations")
        .update({ status: "failed", error: message, updated_at: new Date().toISOString() })
        .eq("id", id)
        .select()
        .single();
      // Return 200 with the updated job (not a 502) — the state transition itself
      // succeeded, so the client should render the failure, not just an error banner.
      return NextResponse.json({ job: updated ?? { ...current, status: "failed", error: message } });
    }
  }

  // failed / cancelled / expired
  const errorMessage = upstream.error ?? "Video generation failed.";
  const { data: updated } = await supabase
    .from("video_generations")
    .update({ status: upstream.status, error: errorMessage, updated_at: new Date().toISOString() })
    .eq("id", id)
    .select()
    .single();

  return NextResponse.json({ job: updated ?? { ...current, status: upstream.status, error: errorMessage } });
}
