import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { STORAGE_BUCKET } from "@/lib/storage";
import { userStoragePath } from "@/lib/storage-paths";
import { safeUploadFilename } from "@/lib/creative/asset-upload";

export const runtime = "nodejs";

/**
 * Step one of an upload: picks the path inside the user's own storage folder
 * that the browser then writes the file to directly.
 *
 * The file never passes through this server. Vercel refuses any function
 * request body over 4.5 MB, which rejected nearly every video and most
 * narration the old upload route was sent. Step two is
 * `/api/creative/assets/upload`, which records what was written.
 */
export async function POST(request: Request) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const body = (await request.json().catch(() => null)) as Record<string, unknown> | null;
  const projectId = typeof body?.projectId === "string" ? body.projectId.trim() : "";
  if (!projectId) return NextResponse.json({ error: "projectId is required" }, { status: 400 });
  const { data: project } = await supabase
    .from("creative_projects")
    .select("id")
    .eq("id", projectId)
    .eq("user_id", user.id)
    .maybeSingle();
  if (!project) return NextResponse.json({ error: "Project not found" }, { status: 404 });

  const filename = safeUploadFilename(typeof body?.filename === "string" ? body.filename : "");
  const path = userStoragePath(user.id, "assets", `uploads/${crypto.randomUUID()}-${filename}`);
  return NextResponse.json({ bucket: STORAGE_BUCKET, path });
}
