import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { getActiveSiteId } from "@/lib/active-site";
import { importBasicSvg, importCreativeDocumentJson } from "@/lib/creative/import";
import { createRuntimeCreativeProject } from "@/lib/creative/project-runtime";
import { withOpenRouterKeyScope } from "@/lib/openrouter-key-route";

export const runtime = "nodejs";

async function handlePOST(request: Request) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const form = await request.formData().catch(() => null);
  const file = form?.get("file");
  if (!(file instanceof File)) return NextResponse.json({ error: "file is required" }, { status: 400 });
  if (file.size <= 0 || file.size > 5 * 1024 * 1024) return NextResponse.json({ error: "import file must be between 1 byte and 5 MB" }, { status: 400 });
  const raw = await file.text();
  const lower = file.name.toLowerCase();
  const title = String(form?.get("title") ?? file.name.replace(/\.[^.]+$/, "")).trim() || "Imported creative";
  const imported = lower.endsWith(".svg") || /svg/i.test(file.type)
    ? importBasicSvg(raw, title)
    : importCreativeDocumentJson(raw);
  if (!imported.ok) return NextResponse.json({ error: imported.error, warnings: imported.warnings }, { status: 422 });
  try {
    const project = await createRuntimeCreativeProject(
      { supabase, userId: user.id, siteId: await getActiveSiteId() },
      title,
      imported.document,
    );
    return NextResponse.json({ project_id: project.id, warnings: imported.warnings, document: project.document }, { status: 201 });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : String(error), warnings: imported.warnings }, { status: 400 });
  }
}

/* Generation on this route bills the signed-in account's own OpenRouter key. */
export const POST = withOpenRouterKeyScope(handlePOST);
