import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { getActiveSiteId } from "@/lib/active-site";
import { planCreativeTransaction } from "@/lib/creative/director";
import { applyRuntimeCreativeTransaction, getRuntimeCreativeProject } from "@/lib/creative/project-runtime";
import { InsufficientCreditsError, withCredits } from "@/lib/creative/metering";
import { CREDIT_COSTS } from "@/lib/credit-costs";
import { withOpenRouterKeyScope } from "@/lib/openrouter-key-route";

export const runtime = "nodejs";
export const maxDuration = 120;

async function handlePOST(request: Request) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const body = await request.json().catch(() => null) as Record<string, unknown> | null;
  const projectId = typeof body?.project_id === "string" ? body.project_id.trim() : "";
  const intent = typeof body?.intent === "string" ? body.intent.trim() : "";
  if (!projectId || !intent) return NextResponse.json({ error: "project_id and intent are required" }, { status: 400 });
  const context = { supabase, userId: user.id, siteId: await getActiveSiteId() };
  try {
    const project = await getRuntimeCreativeProject(context, projectId);
    if (!project) return NextResponse.json({ error: "Project not found" }, { status: 404 });
    // Planning is a model call — up to three of them once repairs are counted —
    // so it costs money whether or not the resulting transaction is any good.
    const transaction = await withCredits(
      { supabase, user },
      "creative_direct",
      CREDIT_COSTS.creative_direct,
      () => planCreativeTransaction(project.document, intent),
    );
    const result = await applyRuntimeCreativeTransaction(context, projectId, transaction);
    return NextResponse.json({
      project_id: projectId,
      revision_id: result.revisionId,
      revision: result.sequence,
      transaction,
      document: result.project.document,
    });
  } catch (error) {
    // 402 rather than 422: nothing about the request was malformed.
    if (error instanceof InsufficientCreditsError) {
      return NextResponse.json(
        { error: error.message, required: error.required, balance: error.balance },
        { status: 402 },
      );
    }
    return NextResponse.json({ error: error instanceof Error ? error.message : String(error) }, { status: 422 });
  }
}

/* Generation on this route bills the signed-in account's own OpenRouter key. */
export const POST = withOpenRouterKeyScope(handlePOST);
