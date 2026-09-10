import { notFound, redirect } from "next/navigation";
import {
  getCreativeProject,
  listCreativeAssets,
  listCreativeRevisions,
} from "@/app/actions/creative-studio";
import CreativeEditor from "@/components/creative/CreativeEditor";
import { createClient } from "@/lib/supabase/server";

/**
 * The editor deliberately sits outside the dashboard's `(shell)` route group:
 * a sidebar and a tab bar around a video editor turn the artwork into one more
 * card on a page. Here the whole viewport is the room, so this page owns its
 * own auth rather than inheriting the shell layout's.
 */
export default async function CreativeProjectPage({ params }: { params: Promise<{ id: string }> }) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const { id } = await params;
  const project = await getCreativeProject(id);
  if (!project.ok) notFound();

  const [revisions, assets] = await Promise.all([listCreativeRevisions(id), listCreativeAssets(id)]);

  const editorAssets = assets.map((asset) => ({
    id: String(asset.id),
    kind: String(asset.kind),
    url: String(asset.url),
    filename: asset.filename == null ? null : String(asset.filename),
    mimeType: asset.mime_type == null ? null : String(asset.mime_type),
  }));

  const editorRevisions = revisions.map((revision) => ({
    id: String(revision.id),
    sequence: Number(revision.sequence),
    summary: String(revision.change_summary ?? ""),
  }));

  return (
    <CreativeEditor
      projectId={id}
      title={project.data.title}
      documentVersion={project.data.document.version}
      initialDocument={project.data.document}
      initialAssets={editorAssets}
      revisions={editorRevisions}
    />
  );
}
