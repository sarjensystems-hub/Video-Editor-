import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createServiceClient } from "@/lib/supabase/service";
import { RENDER_JOB_STALE_MESSAGE, canClaimRenderJobPoll, claimRenderJobPoll, isRenderJobStale, shouldRetryDetachedRender, updateClaimedRenderJob } from "@/lib/creative/render-job";
import { creativeRenderAdapter, type CreativeDetachedRenderHandle } from "@/lib/creative/render";
import { refundCreativeRenderCredits } from "@/lib/creative/metering";
import { getCreativeInputAssetMap, getCreativeDocumentAssetIds } from "@/lib/creative/remotion";
import { extractSceneDocument } from "@/lib/creative/scene-export";
import type { CreativeDocument } from "@/lib/creative/schema";

export const runtime = "nodejs";

const JOB_COLUMNS =
  "id, project_id, revision_id, status, renderer, format, progress, output_url, content_type, size_bytes, error, metadata, credits_charged, credits_refunded_at, started_at, finished_at, created_at, updated_at";

export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const renderSupabase = createServiceClient();
  const { id } = await params;

  const { data, error } = await supabase
    .from("creative_render_jobs")
    .select(JOB_COLUMNS)
    .eq("id", id)
    .eq("user_id", user.id)
    .single();

  if (error || !data) return NextResponse.json({ error: "Render job not found" }, { status: 404 });

  const metadata = (data.metadata ?? {}) as Record<string, unknown>;
  const detached = metadata.detached_render as CreativeDetachedRenderHandle | undefined;
  if (canClaimRenderJobPoll(data, Date.now()) && detached?.sandboxId && detached?.cmdId && typeof data.updated_at === "string") {
    const claim = await claimRenderJobPoll(renderSupabase, {
      jobId: id, userId: user.id, status: data.status, updatedAt: data.updated_at, metadata,
    });
    if (!claim) return NextResponse.json({ job: { ...data, poll_in_progress: true } });
    let advanced;
    try {
      advanced = await creativeRenderAdapter.pollDetached(detached);
    } catch (pollError) {
      const message = pollError instanceof Error ? pollError.message : String(pollError);
      const now = new Date().toISOString();
      await updateClaimedRenderJob(renderSupabase, {
        jobId: id, userId: user.id, claimedAt: claim.claimedAt,
        patch: { status: "rendering", metadata: { ...metadata, phase: "poll-error" }, error: message.slice(0, 4000), updated_at: now },
      });
      return NextResponse.json({ error: "Could not poll render job" }, { status: 503 });
    }
    const now = new Date().toISOString();
    if (advanced.status === "rendering") {
      const nextMetadata = { ...metadata, phase: advanced.phase, estimated_completion_ms: advanced.estimatedCompletionMs };
      await updateClaimedRenderJob(renderSupabase, { jobId: id, userId: user.id, claimedAt: claim.claimedAt, patch: { status: "rendering", progress: advanced.progress, metadata: nextMetadata, error: null, updated_at: now } });
      return NextResponse.json({ job: { ...data, status: "rendering", progress: advanced.progress, metadata: nextMetadata, updated_at: now, estimated_completion_ms: advanced.estimatedCompletionMs } });
    }
    if (advanced.status === "failed") {
      const retryCount = typeof metadata.retry_count === "number" ? metadata.retry_count : 0;
      if (shouldRetryDetachedRender(advanced.error, retryCount) && data.revision_id) {
        const { data: revision } = await supabase.from("creative_project_revisions").select("document").eq("id", data.revision_id).eq("user_id", user.id).maybeSingle();
        if (revision?.document) {
          const stored = revision.document as CreativeDocument;
          const retryDocument = metadata.scene_id ? extractSceneDocument(stored, String(metadata.scene_id)) : stored;
          const requiredAssetIds = getCreativeDocumentAssetIds(retryDocument);
          let rows: Array<{ id: string; url: string; mime_type: string | null }> = [];
          if (requiredAssetIds.length) {
            const { data: assets } = await supabase.from("creative_assets").select("id, url, mime_type").eq("user_id", user.id).in("id", requiredAssetIds);
            rows = (assets ?? []) as typeof rows;
          }
          try {
            const handle = await creativeRenderAdapter.startDetached({
              document: retryDocument,
              assets: getCreativeInputAssetMap(rows.map((asset) => ({ id: asset.id, url: asset.url, mimeType: asset.mime_type }))),
              outputKey: detached.outputKey,
            });
            const nextMetadata = { ...metadata, phase: "retrying-detached-render", retry_count: retryCount + 1, detached_render: handle, estimated_completion_ms: null };
            try {
              await updateClaimedRenderJob(renderSupabase, { jobId: id, userId: user.id, claimedAt: claim.claimedAt, patch: { status: "rendering", progress: 0.04, metadata: nextMetadata, error: null, updated_at: now } });
            } catch (persistError) {
              await creativeRenderAdapter.stopDetached(handle);
              throw persistError;
            }
            return NextResponse.json({ job: { ...data, status: "rendering", progress: 0.04, metadata: nextMetadata, updated_at: now, estimated_completion_ms: null, retry_count: retryCount + 1 } });
          } catch (retryError) {
            advanced = { status: "failed", progress: advanced.progress, error: retryError instanceof Error ? retryError.message : String(retryError) };
          }
        }
      }
      await updateClaimedRenderJob(renderSupabase, { jobId: id, userId: user.id, claimedAt: claim.claimedAt, patch: { status: "failed", progress: advanced.progress, error: advanced.error.slice(0, 4000), finished_at: now, updated_at: now } });
      const refundPending = await refundCreativeRenderCredits({ supabase, serviceSupabase: renderSupabase, user }, id).then(() => false).catch(() => true);
      await supabase.from("creative_projects").update({ status: "ready", updated_at: now }).eq("id", data.project_id).eq("user_id", user.id);
      return NextResponse.json({ job: { ...data, status: "failed", progress: advanced.progress, error: advanced.error, finished_at: now, updated_at: now, estimated_completion_ms: null, refund_pending: refundPending } });
    }
    const nextMetadata = { ...metadata, phase: "completed", estimated_completion_ms: Date.now() };
    await updateClaimedRenderJob(renderSupabase, { jobId: id, userId: user.id, claimedAt: claim.claimedAt, patch: { status: "completed", progress: 1, output_url: advanced.url, content_type: advanced.contentType, size_bytes: advanced.sizeBytes, metadata: nextMetadata, finished_at: now, updated_at: now } });
    await creativeRenderAdapter.stopDetached(detached);
    await supabase.from("creative_projects").update({ status: "ready", updated_at: now }).eq("id", data.project_id).eq("user_id", user.id);
    return NextResponse.json({ job: { ...data, status: "completed", progress: 1, output_url: advanced.url, content_type: advanced.contentType, size_bytes: advanced.sizeBytes, metadata: nextMetadata, finished_at: now, updated_at: now, estimated_completion_ms: Date.now() } });
  }

  if (data.status === "queued" && metadata.phase === "polling-detached") {
    return NextResponse.json({ job: { ...data, poll_in_progress: true } });
  }

  // Nothing else can close out a job whose worker was killed mid-render, so
  // the reader that notices the heartbeat stopped is the one that records it.
  // Without this a dead job polls as `rendering` forever.
  if (isRenderJobStale(data, Date.now())) {
    const finishedAt = new Date().toISOString();
    const { data: claimed, error: staleError } = await renderSupabase
      .from("creative_render_jobs")
      .update({ status: "failed", error: RENDER_JOB_STALE_MESSAGE, finished_at: finishedAt, updated_at: finishedAt })
      .eq("id", id)
      .eq("user_id", user.id)
      .eq("status", data.status)
      .eq("updated_at", data.updated_at)
      .select("id")
      .maybeSingle();
    if (staleError) return NextResponse.json({ error: "Could not close stale render job" }, { status: 500 });
    if (!claimed) return NextResponse.json({ job: { ...data, poll_in_progress: true } });
    const refundPending = await refundCreativeRenderCredits({ supabase, serviceSupabase: renderSupabase, user }, id).then(() => false).catch(() => true);
    await supabase.from("creative_projects").update({ status: "ready", updated_at: finishedAt }).eq("id", data.project_id).eq("user_id", user.id);
    return NextResponse.json({
      job: { ...data, status: "failed", error: RENDER_JOB_STALE_MESSAGE, finished_at: finishedAt, updated_at: finishedAt, refund_pending: refundPending },
    });
  }

  if (data.status === "failed" && Number(data.credits_charged) > 0 && !data.credits_refunded_at) {
    const refundPending = await refundCreativeRenderCredits({ supabase, serviceSupabase: renderSupabase, user }, id).then(() => false).catch(() => true);
    return NextResponse.json({ job: { ...data, refund_pending: refundPending } });
  }

  return NextResponse.json({ job: { ...data, estimated_completion_ms: typeof metadata.estimated_completion_ms === "number" ? metadata.estimated_completion_ms : null } });
}
