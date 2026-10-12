import { timingSafeEqual } from "node:crypto";
import { NextResponse } from "next/server";
import { createServiceClient } from "@/lib/supabase/service";
import { withUserOpenRouterKey } from "@/lib/openrouter-key";
import { createVideoJobAdvancer } from "@/lib/mcp-server/user-runtime";
import { RENDER_SETTLE_COLUMNS, settleRenderJob, type SettleableRenderJob } from "@/lib/creative/render-settle";

export const runtime = "nodejs";
export const maxDuration = 300;

/** Jobs touched more recently than this are left to their callbacks and polls. */
const QUIET_FOR_MS = 10 * 60 * 1000;
/** Rows per kind per run, oldest first; the next run picks up the rest. */
const BATCH = 25;
/** Stop starting new work with this much of maxDuration left. */
const BUDGET_MS = 240 * 1000;

function authorized(request: Request): boolean {
  const secret = process.env.CRON_SECRET;
  if (!secret) return false;
  const given = Buffer.from(request.headers.get("authorization") ?? "");
  const expected = Buffer.from(`Bearer ${secret}`);
  return given.length === expected.length && timingSafeEqual(given, expected);
}

/**
 * GET /api/cron/sweep-jobs — the safety net behind the job callbacks
 * (vercel.json runs it daily, the most a Hobby plan allows).
 *
 * Renders report back from their own sandbox and videos from OpenRouter, so
 * this normally finds nothing. It exists for what a callback cannot cover: a
 * delivery that never arrived, a launch that died before its render started,
 * a job whose owner never came back. It closes those rows, stops any sandbox
 * still attached, and downloads any finished video still waiting on
 * OpenRouter — on its owner's key, never anyone else's.
 *
 * Vercel sends `Authorization: Bearer $CRON_SECRET`. With no CRON_SECRET set
 * the route refuses everything, so it can never be triggered anonymously.
 */
export async function GET(request: Request) {
  if (!authorized(request)) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const startedAt = Date.now();
  const outOfTime = () => Date.now() - startedAt > BUDGET_MS;
  const quietBefore = new Date(startedAt - QUIET_FOR_MS).toISOString();
  const supabase = createServiceClient();
  const summary = { renders: {} as Record<string, number>, videos: {} as Record<string, number>, errors: 0 };
  const count = (bucket: Record<string, number>, key: string) => { bucket[key] = (bucket[key] ?? 0) + 1; };

  const { data: renders } = await supabase
    .from("creative_render_jobs")
    .select(RENDER_SETTLE_COLUMNS)
    .in("status", ["rendering", "queued"])
    .lt("updated_at", quietBefore)
    .order("updated_at", { ascending: true })
    .limit(BATCH);
  for (const job of (renders ?? []) as SettleableRenderJob[]) {
    if (outOfTime()) break;
    try {
      count(summary.renders, await settleRenderJob(supabase, job));
    } catch (error) {
      summary.errors += 1;
      console.error("[sweep-jobs] render", job.id, error);
    }
  }

  const { data: videos } = await supabase
    .from("video_generations")
    .select("id, user_id")
    .in("status", ["pending", "in_progress"])
    .lt("updated_at", quietBefore)
    .order("updated_at", { ascending: true })
    .limit(BATCH);
  const advancer = createVideoJobAdvancer(supabase);
  for (const row of videos ?? []) {
    if (outOfTime()) break;
    const userId = String(row.user_id);
    try {
      const job = await withUserOpenRouterKey(supabase, userId, () => advancer.get(userId, String(row.id)));
      count(summary.videos, job?.status ?? "missing");
    } catch (error) {
      summary.errors += 1;
      console.error("[sweep-jobs] video", row.id, error);
    }
  }

  return NextResponse.json(summary);
}
