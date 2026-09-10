/**
 * Render jobs outlive the HTTP request that starts them, so "is this job still
 * alive?" cannot be answered by the caller holding a connection open. It is
 * answered by the heartbeat the renderer writes into `updated_at` on every
 * progress callback: a job that stopped writing has lost the function driving
 * it and is never coming back.
 *
 * Pure on purpose — the same predicate decides what the status endpoint
 * reports and what the browser stops polling for.
 */

export type RenderJobStatus = "queued" | "rendering" | "completed" | "failed";

export interface RenderJobHeartbeat {
  status: string | null;
  updated_at?: string | null;
  started_at?: string | null;
  metadata?: Record<string, unknown> | null;
}

/**
 * Two phases legitimately go quiet: restoring the renderer snapshot before the
 * first frame, and uploading the finished MP4 after the last one. Both are
 * well under a minute in practice, so four minutes of silence is dead, not slow.
 */
export const RENDER_JOB_STALE_MS = 4 * 60 * 1000;

/** A status poll owns the queued CAS state only briefly before another poll may recover it. */
export const RENDER_POLL_LEASE_MS = 30 * 1000;

export const RENDER_JOB_STALE_MESSAGE =
  "Render stopped reporting progress and was abandoned by its worker.";

export function isRenderJobRunning(status: string | null | undefined): boolean {
  return status === "queued" || status === "rendering";
}

export function shouldRetryDetachedRender(error: string, retryCount: number): boolean {
  return retryCount < 1 && /(sandbox expired|sandbox_stopped|sandbox has stopped execution|sandbox is no longer available)/i.test(error);
}

/**
 * A render normally polls from `rendering`. A poll first CASes the row to
 * `queued`, though, and a dropped database response can strand it there after
 * the sandbox was successfully inspected. Once that short lease expires, a
 * later request may claim the same detached handle and finish the job.
 */
export function canClaimRenderJobPoll(job: RenderJobHeartbeat, nowMs: number): boolean {
  if (job.status === "rendering") return true;
  if (job.status !== "queued" || job.metadata?.phase !== "polling-detached") return false;
  const updatedAt = job.updated_at ? Date.parse(job.updated_at) : Number.NaN;
  return !Number.isNaN(updatedAt) && nowMs - updatedAt > RENDER_POLL_LEASE_MS;
}

export async function claimRenderJobPoll(
  supabase: SupabaseClient,
  input: { jobId: string; userId: string; status: string; updatedAt: string; metadata: Record<string, unknown>; nowMs?: number },
): Promise<{ claimedAt: string; metadata: Record<string, unknown> } | null> {
  const claimedAt = new Date(input.nowMs ?? Date.now()).toISOString();
  const metadata = { ...input.metadata, phase: "polling-detached" };
  const { data, error } = await supabase
    .from("creative_render_jobs")
    .update({ status: "queued", metadata, updated_at: claimedAt })
    .eq("id", input.jobId)
    .eq("user_id", input.userId)
    .eq("status", input.status)
    .eq("updated_at", input.updatedAt)
    .select("id")
    .maybeSingle();
  if (error) throw new Error(`Could not claim render status poll: ${error.message}`);
  return data ? { claimedAt, metadata } : null;
}

export async function updateClaimedRenderJob(
  supabase: SupabaseClient,
  input: { jobId: string; userId: string; claimedAt: string; patch: Record<string, unknown> },
): Promise<void> {
  const { data, error } = await supabase
    .from("creative_render_jobs")
    .update(input.patch)
    .eq("id", input.jobId)
    .eq("user_id", input.userId)
    .eq("status", "queued")
    .eq("updated_at", input.claimedAt)
    .select("id")
    .maybeSingle();
  if (error) throw new Error(`Could not persist render status: ${error.message}`);
  if (!data) throw new Error("Render job state changed while its status was being finalized.");
}

/**
 * @returns true when a running job has gone silent long enough that the worker
 * is provably gone. Completed and failed jobs are never stale — they are done.
 */
export function isRenderJobStale(job: RenderJobHeartbeat, nowMs: number): boolean {
  if (!isRenderJobRunning(job.status)) return false;
  const beat = job.updated_at ?? job.started_at;
  if (!beat) return false;
  const beatMs = Date.parse(beat);
  if (Number.isNaN(beatMs)) return false;
  return nowMs - beatMs > RENDER_JOB_STALE_MS;
}
import type { SupabaseClient } from "@supabase/supabase-js";
