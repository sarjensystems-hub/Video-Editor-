import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { abortMultipartUpload, createMultipartUpload, presignUploadPart } from "@/lib/b2";
import { userStoragePath, isUserStoragePath } from "@/lib/storage-paths";
import { safeUploadFilename } from "@/lib/creative/asset-upload";
import { planUploadParts } from "@/lib/creative/asset-upload-plan";

export const runtime = "nodejs";

/** A part URL stays valid this long, so even a slow upload of a huge file can finish. */
const PART_URL_SECONDS = 24 * 60 * 60;

/**
 * Step one of an upload: opens a multipart upload in the user's own storage
 * folder and hands the browser one signed URL per part.
 *
 * The file never passes through this server - Vercel refuses any function
 * request body over 4.5 MB - and there is no size cap of our own. Step two is
 * `/api/creative/assets/upload`, which joins the parts and records the asset.
 */
export async function POST(request: Request) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const body = (await request.json().catch(() => null)) as Record<string, unknown> | null;
  const projectId = typeof body?.projectId === "string" ? body.projectId.trim() : "";
  if (!projectId) return NextResponse.json({ error: "projectId is required" }, { status: 400 });
  const size = Number(body?.size);
  if (!Number.isFinite(size) || size <= 0) return NextResponse.json({ error: "size is required" }, { status: 400 });
  const { data: project } = await supabase
    .from("creative_projects")
    .select("id")
    .eq("id", projectId)
    .eq("user_id", user.id)
    .maybeSingle();
  if (!project) return NextResponse.json({ error: "Project not found" }, { status: 404 });

  const filename = safeUploadFilename(typeof body?.filename === "string" ? body.filename : "");
  const contentType = typeof body?.contentType === "string" && body.contentType ? body.contentType : "application/octet-stream";
  const path = userStoragePath(user.id, "assets", `uploads/${crypto.randomUUID()}-${filename}`);
  const { partSize, partCount } = planUploadParts(size);

  try {
    const uploadId = await createMultipartUpload(path, contentType);
    const partUrls = await Promise.all(
      Array.from({ length: partCount }, (_, index) => presignUploadPart(path, uploadId, index + 1, PART_URL_SECONDS)),
    );
    return NextResponse.json({ path, uploadId, partSize, partUrls });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "Could not start the upload" }, { status: 502 });
  }
}

/** Abandons an upload the person stopped, so its parts do not linger in storage. */
export async function DELETE(request: Request) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const body = (await request.json().catch(() => null)) as Record<string, unknown> | null;
  const uploadId = typeof body?.uploadId === "string" ? body.uploadId : "";
  if (!uploadId || !isUserStoragePath(user.id, "assets", body?.path)) {
    return NextResponse.json({ error: "Unknown upload" }, { status: 400 });
  }
  await abortMultipartUpload(body.path as string, uploadId);
  return NextResponse.json({ ok: true });
}
