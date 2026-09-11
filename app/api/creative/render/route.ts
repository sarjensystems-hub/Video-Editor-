import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createServiceClient } from "@/lib/supabase/service";
import { runAfterResponse } from "@/lib/creative/background";
import { creativeRenderAdapter } from "@/lib/creative/render";
import { getCreativeDocumentAssetIds, getCreativeInputAssetMap } from "@/lib/creative/remotion";
import type { CreativeDocument } from "@/lib/creative/schema";
import { RENDER_JOB_STALE_MESSAGE, isRenderJobStale } from "@/lib/creative/render-job";
import { creativeRenderCost } from "@/lib/credit-costs";
import { InsufficientCreditsError, chargeCreativeRenderCredits, refundCreativeRenderCredits } from "@/lib/creative/metering";
import { getCreativeDurationMs } from "@/lib/creative/evaluate";
import { extractSceneDocument, findSceneExportWindow } from "@/lib/creative/scene-export";
import { validateCreativeDocument } from "@/lib/creative/validate";
import { withOpenRouterKeyScope } from "@/lib/openrouter-key-route";

export const runtime = "nodejs";

/**
 * Only sandbox restoration and detached command launch happen after this
 * response; status polling owns progress and finalization. The export itself
 * runs detached inside the Sandbox and outlives this invocation, so this
 * budget covers the launch alone rather than the render.
 *
 * 300 is the Hobby ceiling, and a higher value is rejected at deploy time with
 * `invalid_max_duration` rather than being clamped. The launch path caps
 * itself well under this (see `timeoutInMilliseconds` in the render adapter).
 */
export const maxDuration = 300;

/** How many past exports a project's history shows. */
const HISTORY_LIMIT = 25;

/**
 * The project's export history, newest first.
 *
 * Lives on the same path as the render it lists rather than under a `/history`
 * segment, which would sit alongside the `[id]` route and be resolved ahead of
 * any job that happened to be called that.
 */
export async function GET(request: Request) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const projectId = new URL(request.url).searchParams.get("projectId")?.trim();
  if (!projectId) return NextResponse.json({ error: "projectId is required" }, { status: 400 });

  const { data, error } = await supabase
    .from("creative_render_jobs")
    .select("id, status, progress, output_url, content_type, size_bytes, error, metadata, created_at, finished_at, updated_at")
    .eq("user_id", user.id)
    .eq("project_id", projectId)
    .order("created_at", { ascending: false })
    .limit(HISTORY_LIMIT);

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  // A job whose worker was killed has nothing left to close it out, so the
  // history is where it finally reads as failed rather than forever rendering.
  const now = Date.now();
  const jobs = (data ?? []).map((job) =>
    isRenderJobStale(job, now)
      ? { ...job, status: "failed", error: RENDER_JOB_STALE_MESSAGE }
      : job,
  );

  return NextResponse.json({ jobs });
}

async function handlePOST(request: Request) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const renderSupabase = createServiceClient();

  const body = (await request.json().catch(() => null)) as { projectId?: string; sceneId?: string } | null;
  const projectId = body?.projectId?.trim();
  if (!projectId) return NextResponse.json({ error: "projectId is required" }, { status: 400 });
  const sceneId = body?.sceneId?.trim() || null;

  const { data: project, error: projectError } = await supabase
    .from("creative_projects")
    .select("id, document, current_revision_id")
    .eq("id", projectId)
    .eq("user_id", user.id)
    .single();
  if (projectError || !project) return NextResponse.json({ error: "Project not found" }, { status: 404 });

  const stored = project.document as CreativeDocument;
  const storedValidation = validateCreativeDocument(stored);
  if (!storedValidation.valid) {
    return NextResponse.json({ error: "Stored CreativeDocument is invalid", issues: storedValidation.issues }, { status: 422 });
  }

  // A clip export renders a one-scene document cut from the film, so the scene
  // has to be checked against the stored project rather than trusted from the
  // request body.
  if (sceneId && !findSceneExportWindow(stored, sceneId)) {
    return NextResponse.json({ error: "Scene not found in this project" }, { status: 404 });
  }
  const document = sceneId ? extractSceneDocument(stored, sceneId) : stored;
  const validation = validateCreativeDocument(document);
  if (!validation.valid) {
    return NextResponse.json({ error: "Clip could not be extracted cleanly", issues: validation.issues }, { status: 422 });
  }

  const requiredAssetIds = getCreativeDocumentAssetIds(document);
  let assetRows: Array<{ id: string; url: string; mime_type: string | null }> = [];
  if (requiredAssetIds.length > 0) {
    const { data } = await supabase
      .from("creative_assets")
      .select("id, url, mime_type")
      .eq("user_id", user.id)
      .in("id", requiredAssetIds);
    assetRows = (data ?? []) as typeof assetRows;
  }
  const assets = getCreativeInputAssetMap(
    assetRows.map((asset) => ({ id: asset.id, url: asset.url, mimeType: asset.mime_type })),
  );

  const renderDurationMs = getCreativeDurationMs(document);
  const renderCost = creativeRenderCost(renderDurationMs);
  const baseMetadata = {
    required_asset_ids: requiredAssetIds, scene_id: sceneId, duration_ms: renderDurationMs,
    output_width: document.canvas.width, output_height: document.canvas.height,
  };
  const { data: job, error: jobError } = await renderSupabase
    .from("creative_render_jobs")
    .insert({
      user_id: user.id,
      project_id: projectId,
      revision_id: project.current_revision_id,
      status: "rendering",
      renderer: "remotion-vercel",
      format: "mp4",
      progress: 0.02,
      started_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
      metadata: baseMetadata,
    })
    .select("id")
    .single();
  if (jobError || !job) return NextResponse.json({ error: jobError?.message ?? "Could not create render job" }, { status: 500 });

  // Charged before the response rather than inside the background work, so an
  // empty balance is an answer the caller actually receives.
  try {
    await chargeCreativeRenderCredits({ supabase, serviceSupabase: renderSupabase, user }, String(job.id), renderCost);
  } catch (chargeError) {
    const insufficient = chargeError instanceof InsufficientCreditsError;
    const message = insufficient ? chargeError.message : "Could not charge for this render.";
    await renderSupabase
      .from("creative_render_jobs")
      .update({ status: "failed", error: message, finished_at: new Date().toISOString() })
      .eq("id", job.id)
      .eq("user_id", user.id);
    // 402 rather than 400: nothing about the request was malformed.
    return NextResponse.json(
      insufficient
        ? { error: message, required: chargeError.required, balance: chargeError.balance }
        : { error: message },
      { status: insufficient ? 402 : 500 },
    );
  }

  await supabase
    .from("creative_projects")
    .update({ status: "rendering", updated_at: new Date().toISOString() })
    .eq("id", projectId)
    .eq("user_id", user.id);

  // The background task launches only. The sandbox command is detached and
  // every status poll reconnects to it, so an HTTP function timeout cannot
  // abandon an otherwise healthy render.
  runAfterResponse(async () => {
    try {
      const handle = await creativeRenderAdapter.startDetached({
        document,
        assets,
        outputKey: `creative-renders/${user.id}/${job.id}.mp4`,
      });
      const { error: handleError } = await renderSupabase
        .from("creative_render_jobs")
        .update({
          progress: 0.04,
          metadata: { ...baseMetadata, phase: "detached-rendering", detached_render: handle },
          updated_at: new Date().toISOString(),
        })
        .eq("id", job.id)
        .eq("user_id", user.id);
      if (handleError) {
        await creativeRenderAdapter.stopDetached(handle);
        throw new Error(`Could not persist detached render handle: ${handleError.message}`);
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      const finishedAt = new Date().toISOString();
      // Mark terminal first; the job-bound refund RPC only refunds terminal jobs.
      const { error: updateError } = await renderSupabase
        .from("creative_render_jobs")
        .update({ status: "failed", error: message.slice(0, 4000), finished_at: finishedAt, updated_at: finishedAt })
        .eq("id", job.id)
        .eq("user_id", user.id);
      if (!updateError) await refundCreativeRenderCredits({ supabase, serviceSupabase: renderSupabase, user }, String(job.id)).catch(() => undefined);
      await supabase
        .from("creative_projects")
        .update({ status: "ready", updated_at: finishedAt })
        .eq("id", projectId)
        .eq("user_id", user.id);
    }
  });

  return NextResponse.json(
    { job: { id: job.id, status: "rendering", progress: 0.02 } },
    { status: 202 },
  );
}

/* Generation on this route bills the signed-in account's own OpenRouter key. */
export const POST = withOpenRouterKeyScope(handlePOST);
