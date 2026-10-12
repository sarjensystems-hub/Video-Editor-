import { NextResponse } from "next/server";
import { createServiceClient } from "@/lib/supabase/service";
import { verifyJobCallbackToken } from "@/lib/job-callbacks";
import { withUserOpenRouterKey } from "@/lib/openrouter-key";
import { createVideoJobAdvancer } from "@/lib/mcp-server/user-runtime";

export const runtime = "nodejs";
/* Downloading and storing a finished clip can take a while. */
export const maxDuration = 300;

/**
 * POST /api/videos/callback/[id]?token=…
 *
 * OpenRouter calls this when a video job finishes (the `callback_url` set at
 * submit time). Before it existed a job only advanced when someone polled
 * it, so a video whose tab was closed, or whose assistant stopped checking,
 * was paid for and never downloaded.
 *
 * The body is not trusted: the token says which job to look at, and the job
 * is then re-checked against OpenRouter on its owner's own key, exactly as a
 * poll would. The one thing read from the body is the OpenRouter job id, and
 * only for a row that never got to record it (its submit request died right
 * after OpenRouter accepted the job); the advancer then verifies that id
 * against OpenRouter on the owner's key before anything is stored.
 */
export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const token = new URL(request.url).searchParams.get("token");
  if (!verifyJobCallbackToken("video", id, token)) {
    return NextResponse.json({ error: "Invalid callback" }, { status: 401 });
  }

  // No user session here, only the signed token: the service client reads
  // the job and its owner's key.
  const supabase = createServiceClient();
  const { data: row } = await supabase
    .from("video_generations")
    .select("id, user_id, openrouter_job_id, status")
    .eq("id", id)
    .maybeSingle();
  if (!row) return NextResponse.json({ error: "Video job not found" }, { status: 404 });

  if (!row.openrouter_job_id && (row.status === "pending" || row.status === "in_progress")) {
    const payload = (await request.json().catch(() => null)) as { data?: { id?: unknown }; id?: unknown } | null;
    const upstreamId = payload?.data?.id ?? payload?.id;
    if (typeof upstreamId === "string" && upstreamId.trim()) {
      await supabase
        .from("video_generations")
        .update({ openrouter_job_id: upstreamId.trim(), status: "in_progress", updated_at: new Date().toISOString() })
        .eq("id", id)
        .is("openrouter_job_id", null);
    }
  }

  try {
    const userId = String(row.user_id);
    const job = await withUserOpenRouterKey(supabase, userId, () => createVideoJobAdvancer(supabase).get(userId, id));
    return NextResponse.json({ status: job?.status ?? null });
  } catch (error) {
    // A 5xx makes OpenRouter retry the delivery, which is what we want.
    console.error("[video-callback] could not advance video job", id, error);
    return NextResponse.json({ error: "Could not advance video job" }, { status: 500 });
  }
}
