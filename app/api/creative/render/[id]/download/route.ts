import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { downloadFilename, isTrustedMediaUrl, ownedMediaPath } from "@/lib/creative/media-url";
import { presignGet } from "@/lib/b2";

export const runtime = "nodejs";

/** How long the signed link behind a download redirect stays valid. */
const DOWNLOAD_LINK_SECONDS = 10 * 60;

/**
 * Saves a finished render as a file.
 *
 * The `download` attribute on an anchor is ignored cross-origin, so a direct
 * link to storage would open the video instead of saving it. A render stored
 * at `/media/<path>` (every render since files left Supabase Storage) gets a
 * short-lived signed storage URL that itself answers "save as", so the bytes
 * go straight from storage to the browser: no function time, no size limit,
 * and storage downloads are free.
 *
 * Renders from before that move still sit in Supabase Storage and are piped
 * through as before. The body is piped rather than buffered — a minute of
 * 1080x1920 is tens of megabytes.
 */
export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const { id } = await params;

  const { data: job } = await supabase
    .from("creative_render_jobs")
    .select("id, project_id, status, output_url, content_type, metadata, finished_at")
    .eq("id", id)
    .eq("user_id", user.id)
    .maybeSingle();

  if (!job) return NextResponse.json({ error: "Render job not found" }, { status: 404 });
  if (job.status !== "completed" || !job.output_url) {
    return NextResponse.json({ error: "That render has not finished." }, { status: 409 });
  }

  const source = String(job.output_url);
  // The URL comes from our own render pipeline, but it is a stored string, so
  // it is checked rather than trusted: either a file in this user's renders
  // folder, or one in the old Supabase Storage.
  const storagePath = ownedMediaPath(source, user.id, "renders");
  if (!storagePath && !isTrustedMediaUrl(source)) {
    return NextResponse.json({ error: "That render is not in Studio storage." }, { status: 400 });
  }

  const { data: project } = await supabase
    .from("creative_projects")
    .select("title")
    .eq("id", job.project_id)
    .eq("user_id", user.id)
    .maybeSingle();

  const sceneId = (job.metadata as { scene_id?: string } | null)?.scene_id;
  const filename = downloadFilename(
    String(project?.title ?? "creative"),
    sceneId ? String(sceneId) : "film",
    job.finished_at ? String(job.finished_at) : null,
  );

  if (storagePath) {
    const signed = await presignGet(storagePath, DOWNLOAD_LINK_SECONDS, { downloadName: filename }).catch(() => null);
    if (!signed) {
      return NextResponse.json({ error: "The rendered file could not be read from storage." }, { status: 502 });
    }
    return new Response(null, { status: 307, headers: { Location: signed, "Cache-Control": "private, no-store" } });
  }

  const upstream = await fetch(source).catch(() => null);
  if (!upstream?.ok || !upstream.body) {
    return NextResponse.json({ error: "The rendered file could not be read from storage." }, { status: 502 });
  }

  const headers = new Headers({
    "Content-Type": String(job.content_type ?? upstream.headers.get("content-type") ?? "video/mp4"),
    // The quoted name is what makes the browser save rather than navigate.
    "Content-Disposition": `attachment; filename="${filename}"`,
    "Cache-Control": "private, no-store",
  });
  const length = upstream.headers.get("content-length");
  // Lets the browser show real progress instead of an unknown-size spinner.
  if (length) headers.set("Content-Length", length);

  return new Response(upstream.body, { status: 200, headers });
}
