import type { SupabaseClient } from "@supabase/supabase-js";
import {
  RENDER_JOB_STALE_MESSAGE,
  canClaimRenderJobPoll,
  claimRenderJobPoll,
  isRenderJobRunning,
  isRenderJobStale,
  updateClaimedRenderJob,
} from "./render-job";
import type { CreativeDetachedRenderHandle } from "./render";

/**
 * Closes out a render job without a user in the loop: the sandbox's own
 * "I'm done" callback and the daily sweep both land here.
 *
 * It does what a status poll does, minus the retry: it asks the sandbox (or
 * the stored output) for the truth, records it, and stops the sandbox. The
 * retry stays with the user-facing polls, which can rebuild the document
 * with the user's own client; a background caller that finds a failure just
 * records it.
 */
export const RENDER_SETTLE_COLUMNS = "id, user_id, project_id, status, updated_at, started_at, metadata";

export interface SettleableRenderJob {
  id: string;
  user_id: string;
  project_id: string | null;
  status: string | null;
  updated_at: string | null;
  started_at?: string | null;
  metadata: Record<string, unknown> | null;
}

export type RenderSettleOutcome = "not-running" | "busy" | "rendering" | "completed" | "failed";

export interface RenderSettleDeps {
  pollDetached: (handle: CreativeDetachedRenderHandle) => Promise<
    | { status: "rendering"; progress: number; phase: string; estimatedCompletionMs: number | null }
    | { status: "completed"; url: string; contentType: string; sizeBytes: number }
    | { status: "failed"; progress: number; error: string }
  >;
  stopDetached: (handle: CreativeDetachedRenderHandle) => Promise<void>;
  stopSandboxByName: (name: string) => Promise<void>;
  nowMs?: () => number;
}

async function defaultDeps(): Promise<RenderSettleDeps> {
  const { creativeRenderAdapter, stopSandboxByName } = await import("./render");
  return {
    pollDetached: (handle) => creativeRenderAdapter.pollDetached(handle),
    stopDetached: (handle) => creativeRenderAdapter.stopDetached(handle),
    stopSandboxByName,
  };
}

/** A sandbox recorded before its render launched; see `onSandboxCreated`. */
export function launchSandboxName(metadata: Record<string, unknown> | null | undefined): string | null {
  const name = metadata?.sandbox_name;
  return typeof name === "string" && name ? name : null;
}

async function markProjectReady(supabase: SupabaseClient, job: SettleableRenderJob, at: string) {
  if (!job.project_id) return;
  await supabase
    .from("creative_projects")
    .update({ status: "ready", updated_at: at })
    .eq("id", job.project_id)
    .eq("user_id", job.user_id)
    .eq("status", "rendering");
}

export async function settleRenderJob(
  supabase: SupabaseClient,
  job: SettleableRenderJob,
  deps?: RenderSettleDeps,
): Promise<RenderSettleOutcome> {
  if (!isRenderJobRunning(job.status)) return "not-running";
  const d = deps ?? (await defaultDeps());
  const nowMs = d.nowMs?.() ?? Date.now();
  const metadata = job.metadata ?? {};
  const detached = metadata.detached_render as CreativeDetachedRenderHandle | undefined;

  if (!detached?.sandboxId || !detached?.cmdId) {
    // The launch never recorded a handle. Once it is provably dead, close the
    // row and stop any sandbox it had already created.
    if (!isRenderJobStale(job, nowMs)) return "rendering";
    const finishedAt = new Date(nowMs).toISOString();
    let query = supabase
      .from("creative_render_jobs")
      .update({ status: "failed", error: RENDER_JOB_STALE_MESSAGE, finished_at: finishedAt, updated_at: finishedAt })
      .eq("id", job.id)
      .eq("user_id", job.user_id)
      .eq("status", job.status as string);
    query = job.updated_at ? query.eq("updated_at", job.updated_at) : query;
    const { data: claimed } = await query.select("id").maybeSingle();
    if (!claimed) return "busy";
    const orphan = launchSandboxName(metadata);
    if (orphan) await d.stopSandboxByName(orphan);
    await markProjectReady(supabase, job, finishedAt);
    return "failed";
  }

  if (!job.updated_at || !canClaimRenderJobPoll(job, nowMs)) return "busy";
  const claim = await claimRenderJobPoll(supabase, {
    jobId: job.id, userId: job.user_id, status: job.status as string, updatedAt: job.updated_at, metadata, nowMs,
  });
  if (!claim) return "busy";

  let advanced: Awaited<ReturnType<RenderSettleDeps["pollDetached"]>>;
  try {
    advanced = await d.pollDetached(detached);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    await updateClaimedRenderJob(supabase, {
      jobId: job.id, userId: job.user_id, claimedAt: claim.claimedAt,
      patch: { status: "rendering", metadata: { ...metadata, phase: "poll-error" }, error: message.slice(0, 4000), updated_at: new Date().toISOString() },
    });
    return "rendering";
  }

  const now = new Date().toISOString();
  if (advanced.status === "rendering") {
    await updateClaimedRenderJob(supabase, {
      jobId: job.id, userId: job.user_id, claimedAt: claim.claimedAt,
      patch: {
        status: "rendering", progress: advanced.progress, error: null, updated_at: now,
        metadata: { ...metadata, phase: advanced.phase, estimated_completion_ms: advanced.estimatedCompletionMs },
      },
    });
    return "rendering";
  }

  if (advanced.status === "failed") {
    await updateClaimedRenderJob(supabase, {
      jobId: job.id, userId: job.user_id, claimedAt: claim.claimedAt,
      patch: { status: "failed", progress: advanced.progress, error: advanced.error.slice(0, 4000), finished_at: now, updated_at: now },
    });
    await d.stopDetached(detached);
    await markProjectReady(supabase, job, now);
    return "failed";
  }

  await updateClaimedRenderJob(supabase, {
    jobId: job.id, userId: job.user_id, claimedAt: claim.claimedAt,
    patch: {
      status: "completed", progress: 1, output_url: advanced.url, content_type: advanced.contentType,
      size_bytes: advanced.sizeBytes, finished_at: now, updated_at: now,
      metadata: { ...metadata, phase: "completed", estimated_completion_ms: Date.now() },
    },
  });
  await d.stopDetached(detached);
  await markProjectReady(supabase, job, now);
  return "completed";
}
