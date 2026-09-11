import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { getActiveSiteId } from "@/lib/active-site";
import { generateCreativeImageAsset, normalizeCreativeImageFormat } from "@/lib/creative/workers";
import { InsufficientCreditsError, withCredits } from "@/lib/creative/metering";
import { CREDIT_COSTS } from "@/lib/credit-costs";
import { withOpenRouterKeyScope } from "@/lib/openrouter-key-route";

export const runtime = "nodejs";
export const maxDuration = 180;

async function handlePOST(request: Request) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const body = await request.json().catch(() => null) as Record<string, unknown> | null;
  const projectId = typeof body?.project_id === "string" ? body.project_id.trim() : "";
  const prompt = typeof body?.prompt === "string" ? body.prompt.trim() : "";
  if (!projectId || !prompt) return NextResponse.json({ error: "project_id and prompt are required" }, { status: 400 });
  const siteId = await getActiveSiteId();
  try {
    const asset = await withCredits({ supabase, user }, "creative_image", CREDIT_COSTS.creative_image, () =>
      generateCreativeImageAsset(
        { supabase, userId: user.id, siteId },
        {
          projectId,
          prompt,
          format: normalizeCreativeImageFormat(body?.format),
          label: typeof body?.label === "string" ? body.label : undefined,
          referenceImages: Array.isArray(body?.reference_images) ? body.reference_images.filter((value): value is string => typeof value === "string" && /^https:\/\//i.test(value)) : [],
        },
      ),
    );
    return NextResponse.json({ asset }, { status: 201 });
  } catch (error) {
    // 402 rather than 400: nothing about the request was malformed.
    if (error instanceof InsufficientCreditsError) {
      return NextResponse.json(
        { error: error.message, required: error.required, balance: error.balance },
        { status: 402 },
      );
    }
    return NextResponse.json({ error: error instanceof Error ? error.message : String(error) }, { status: 400 });
  }
}

/* Generation on this route bills the signed-in account's own OpenRouter key. */
export const POST = withOpenRouterKeyScope(handlePOST);
