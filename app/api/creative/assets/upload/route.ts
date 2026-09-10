import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { getActiveSiteId } from "@/lib/active-site";
import { uploadAnyBytes } from "@/lib/storage";
import { normalizeCreativeAssetKind } from "@/lib/creative/persistence";

export const runtime = "nodejs";

function safeFilename(name: string) {
  const clean = (name || "asset").replace(/[^a-zA-Z0-9._-]+/g, "-").replace(/^-+|-+$/g, "");
  return clean.slice(0, 120) || "asset";
}

function inferKind(contentType: string) {
  if (contentType.startsWith("image/")) return "image";
  if (contentType.startsWith("video/")) return "video";
  if (contentType.startsWith("audio/")) return "audio";
  if (/font|woff|ttf|otf/i.test(contentType)) return "font";
  return "other";
}

export async function POST(request: Request) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const form = await request.formData();
  const file = form.get("file");
  if (!(file instanceof File)) {
    return NextResponse.json({ error: "file is required" }, { status: 400 });
  }
  if (file.size <= 0) return NextResponse.json({ error: "file is empty" }, { status: 400 });
  if (file.size > 250 * 1024 * 1024) {
    return NextResponse.json({ error: "file exceeds 250 MB" }, { status: 413 });
  }

  const projectId = String(form.get("projectId") ?? "").trim() || null;
  if (projectId) {
    const { data: project } = await supabase
      .from("creative_projects")
      .select("id")
      .eq("id", projectId)
      .eq("user_id", user.id)
      .single();
    if (!project) return NextResponse.json({ error: "Project not found" }, { status: 404 });
  }

  const contentType = file.type || "application/octet-stream";
  const requestedKind = String(form.get("kind") ?? "").trim();
  const kind = normalizeCreativeAssetKind(requestedKind || inferKind(contentType));
  const filename = safeFilename(file.name);
  const storagePath = `creative-assets/${user.id}/${crypto.randomUUID()}-${filename}`;
  const bytes = new Uint8Array(await file.arrayBuffer());
  const url = await uploadAnyBytes(bytes, storagePath, contentType);
  if (!url) return NextResponse.json({ error: "Asset upload failed" }, { status: 502 });

  const siteId = await getActiveSiteId();
  const { data: asset, error } = await supabase
    .from("creative_assets")
    .insert({
      user_id: user.id,
      site_id: siteId,
      project_id: projectId,
      kind,
      source: "upload",
      url,
      storage_path: storagePath,
      mime_type: contentType,
      filename,
      size_bytes: file.size,
      metadata: {},
    })
    .select("id, project_id, kind, source, url, mime_type, filename, size_bytes, created_at")
    .single();

  if (error || !asset) {
    return NextResponse.json({ error: error?.message ?? "Could not register asset" }, { status: 500 });
  }

  return NextResponse.json({ asset }, { status: 201 });
}
