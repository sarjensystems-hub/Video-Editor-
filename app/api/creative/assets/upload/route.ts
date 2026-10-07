import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { getActiveSiteId } from "@/lib/active-site";
import { STORAGE_BUCKET } from "@/lib/storage";
import { isUserStoragePath } from "@/lib/storage-paths";
import { resolveAssetClass } from "@/lib/creative/asset-class";
import { positiveInt, safeUploadFilename, uploadKindFor } from "@/lib/creative/asset-upload";

export const runtime = "nodejs";

const ASSET_COLUMNS =
  "id, project_id, kind, asset_class, source, url, mime_type, filename, width, height, duration_ms, size_bytes, metadata, created_at";

/**
 * Step two of an upload: records a file the browser has already written into
 * the user's storage folder (step one is `/api/creative/assets/upload-url`) as
 * a project asset, with the class and notes the person gave it.
 *
 * Nothing here is taken on trust: the path must sit inside the caller's own
 * assets folder and the file must actually be there.
 */
export async function POST(request: Request) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const body = (await request.json().catch(() => null)) as Record<string, unknown> | null;
  if (!body) return NextResponse.json({ error: "A JSON body is required" }, { status: 400 });

  const projectId = typeof body.projectId === "string" ? body.projectId.trim() : "";
  if (!projectId) return NextResponse.json({ error: "projectId is required" }, { status: 400 });
  const { data: project } = await supabase
    .from("creative_projects")
    .select("id")
    .eq("id", projectId)
    .eq("user_id", user.id)
    .maybeSingle();
  if (!project) return NextResponse.json({ error: "Project not found" }, { status: 404 });

  const path = body.path;
  if (!isUserStoragePath(user.id, "assets", path)) {
    return NextResponse.json({ error: "That upload path is not in your folder" }, { status: 403 });
  }
  const name = path.slice(path.lastIndexOf("/") + 1);
  // The bucket is public and grants no listing, so the file's own public URL
  // is how to confirm it landed — and how big it really is.
  const url = supabase.storage.from(STORAGE_BUCKET).getPublicUrl(path).data.publicUrl;
  const head = await fetch(url, { method: "HEAD", cache: "no-store" }).catch(() => null);
  if (!head?.ok) return NextResponse.json({ error: "The file did not finish uploading" }, { status: 409 });
  const storedSize = Number(head.headers.get("content-length"));

  const contentType =
    typeof body.contentType === "string" && body.contentType ? body.contentType : "application/octet-stream";
  const kind = uploadKindFor(contentType);
  let assetClass;
  try {
    assetClass = resolveAssetClass(body.assetClass, kind);
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : String(error) }, { status: 400 });
  }
  const description = typeof body.description === "string" ? body.description.trim().slice(0, 1000) : "";

  const { data: asset, error } = await supabase
    .from("creative_assets")
    .insert({
      user_id: user.id,
      site_id: await getActiveSiteId(),
      project_id: projectId,
      kind,
      asset_class: assetClass,
      source: "upload",
      url,
      storage_path: path,
      mime_type: contentType,
      filename: safeUploadFilename(typeof body.filename === "string" ? body.filename : name),
      width: positiveInt(body.width),
      height: positiveInt(body.height),
      duration_ms: positiveInt(body.durationMs),
      size_bytes: Number.isFinite(storedSize) && storedSize > 0 ? storedSize : positiveInt(body.size),
      metadata: description ? { description } : {},
    })
    .select(ASSET_COLUMNS)
    .single();

  if (error || !asset) {
    return NextResponse.json({ error: error?.message ?? "Could not register asset" }, { status: 500 });
  }
  return NextResponse.json({ asset }, { status: 201 });
}
