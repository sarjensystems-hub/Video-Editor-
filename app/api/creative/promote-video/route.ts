import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { getActiveSiteId } from "@/lib/active-site";
import { promoteCreativeVideoAsset } from "@/lib/creative/workers";

export const runtime = "nodejs";

export async function POST(request: Request) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const body = await request.json().catch(() => null) as Record<string, unknown> | null;
  const projectId = typeof body?.project_id === "string" ? body.project_id.trim() : "";
  const generationId = typeof body?.generation_id === "string" ? body.generation_id.trim() : "";
  if (!projectId || !generationId) return NextResponse.json({ error: "project_id and generation_id are required" }, { status: 400 });
  try {
    const asset = await promoteCreativeVideoAsset(
      { supabase, userId: user.id, siteId: await getActiveSiteId() },
      { projectId, generationId, label: typeof body?.label === "string" ? body.label : undefined },
    );
    return NextResponse.json({ asset }, { status: 201 });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : String(error) }, { status: 400 });
  }
}