/**
 * GET /api/videos/status/[id]
 *
 * Polls (and advances) a video_generations row through the same advancer the
 * MCP tool, the OpenRouter callback and the daily sweep use
 * (lib/mcp-server/user-orchestrator.ts):
 *  - pending/in_progress → re-checks the OpenRouter job, updates status
 *  - completed on OpenRouter but not yet persisted → downloads the raw
 *    video bytes (no re-encoding) and stores them, then marks the row done.
 *    A download or storage failure is retried on the next check for a day
 *    rather than failing a video that was already paid for.
 *  - failed/cancelled/expired → records the error
 *
 * Settled rows are returned as-is without an upstream call.
 */
import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { withOpenRouterKeyScope } from "@/lib/openrouter-key-route";
import { createVideoJobAdvancer } from "@/lib/mcp-server/user-runtime";

export const maxDuration = 60;

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

async function handleGET(
  _req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { id } = await params;
  if (!UUID_RE.test(id)) return NextResponse.json({ error: "Not found" }, { status: 404 });

  try {
    const advanced = await createVideoJobAdvancer(supabase).get(user.id, id);
    if (!advanced) return NextResponse.json({ error: "Not found" }, { status: 404 });
  } catch (e) {
    const message = e instanceof Error ? e.message : "Failed to check generation status.";
    return NextResponse.json({ error: message }, { status: 502 });
  }

  const { data: row } = await supabase
    .from("video_generations")
    .select("*")
    .eq("id", id)
    .eq("user_id", user.id)
    .single();

  if (!row) return NextResponse.json({ error: "Not found" }, { status: 404 });
  return NextResponse.json({ job: row });
}

/* Generation on this route bills the signed-in account's own OpenRouter key. */
export const GET = withOpenRouterKeyScope(handleGET);
