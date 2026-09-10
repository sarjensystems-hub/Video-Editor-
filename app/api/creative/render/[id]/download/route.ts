import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { downloadFilename, isTrustedMediaUrl } from "@/lib/creative/media-url";

export const runtime = "nodejs";

/**
 * Streams a finished render back as an attachment.
 *
 * This route exists because the `download` attribute on an anchor is ignored
 * cross-origin: the files live on the storage host, so a direct link opens the
 * video instead of saving it. Re-serving from our own origin is what makes the
 * browser save it, and it also means a render URL is not handed out to anyone
 * who is not its owner.
 *
 * The body is piped rather than buffered — a minute of 1080x1920 is tens of
 * megabytes, and holding that per concurrent download would be wasteful.
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
  // The URL comes from our own render pipeline, but this route turns a stored
  // string into a server-side fetch, so it is checked rather than trusted.
  if (!isTrustedMediaUrl(source)) {
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
