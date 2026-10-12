import { NextResponse } from "next/server";
import { createServiceClient } from "@/lib/supabase/service";
import { verifyJobCallbackToken } from "@/lib/job-callbacks";
import { RENDER_SETTLE_COLUMNS, settleRenderJob, type SettleableRenderJob } from "@/lib/creative/render-settle";

export const runtime = "nodejs";
export const maxDuration = 300;

/**
 * POST /api/creative/render/[id]/callback?token=…
 *
 * Called by the render's own sandbox when the render finishes, fails or
 * stalls, so the job is closed and the sandbox stopped at once instead of
 * idling until its 45-minute timeout waiting for someone to poll.
 *
 * There is no signed-in user here, only the signed token, so the job is read
 * with the service client. The token only authorises "check this job now":
 * nothing in the request body is read, and the outcome comes from the
 * sandbox and storage themselves.
 */
export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const token = new URL(request.url).searchParams.get("token");
  if (!verifyJobCallbackToken("render", id, token)) {
    return NextResponse.json({ error: "Invalid callback" }, { status: 401 });
  }

  const supabase = createServiceClient();
  const { data: job } = await supabase
    .from("creative_render_jobs")
    .select(RENDER_SETTLE_COLUMNS)
    .eq("id", id)
    .maybeSingle();
  if (!job) return NextResponse.json({ error: "Render job not found" }, { status: 404 });

  try {
    const outcome = await settleRenderJob(supabase, job as SettleableRenderJob);
    return NextResponse.json({ outcome });
  } catch (error) {
    console.error("[render-callback] could not settle render job", id, error);
    return NextResponse.json({ error: "Could not settle render job" }, { status: 500 });
  }
}
