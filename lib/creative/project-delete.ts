import type { SupabaseClient } from "@supabase/supabase-js";
import { deleteUserFiles } from "../storage";
import { getCreativeDocumentAssetIds } from "./remotion";
import type { CreativeDocument } from "./schema";

/**
 * Deletes a project together with the files that belong only to it.
 *
 * Deleting a project used to remove its database rows and leave every file
 * behind: each render's MP4, and every asset generated or uploaded for it.
 * Those files stayed in storage for good, with nothing pointing at them.
 *
 * What goes:
 *   - every render MP4 the project produced;
 *   - every asset registered to the project, unless another of the user's
 *     projects still places it on its timeline.
 *
 * What stays, because something that survives still points at it:
 *   - a file another asset row, a generated video or another project's render
 *     uses. A promoted video is the common case — its asset shares the file
 *     shown on the Videos page, which must keep playing.
 *
 * Rows are deleted before files. If a file then fails to delete it is logged
 * and orphaned; the other order could leave a live row pointing at a file
 * that is already gone, which breaks the editor rather than wasting a byte.
 *
 * Known limit: only other projects' current documents are checked for
 * references, not their revision history, so restoring an old revision of a
 * different project could find one of these assets missing.
 */
export async function deleteCreativeProjectWithFiles(
  supabase: SupabaseClient,
  userId: string,
  projectId: string,
): Promise<{ found: boolean; filesRemoved: number }> {
  const { data: project } = await supabase
    .from("creative_projects")
    .select("id")
    .eq("id", projectId)
    .eq("user_id", userId)
    .maybeSingle();
  if (!project) return { found: false, filesRemoved: 0 };

  const [renders, assets, otherProjects] = await Promise.all([
    supabase.from("creative_render_jobs").select("output_url").eq("project_id", projectId).eq("user_id", userId),
    supabase.from("creative_assets").select("id, url").eq("project_id", projectId).eq("user_id", userId),
    supabase.from("creative_projects").select("document").eq("user_id", userId).neq("id", projectId),
  ]);
  for (const result of [renders, assets, otherProjects]) {
    if (result.error) throw new Error(result.error.message);
  }

  const usedElsewhere = new Set(
    (otherProjects.data ?? []).flatMap((row) => getCreativeDocumentAssetIds(row.document as CreativeDocument)),
  );
  const purged = (assets.data ?? []).filter((asset) => !usedElsewhere.has(String(asset.id)));

  if (purged.length > 0) {
    const { error } = await supabase
      .from("creative_assets")
      .delete()
      .in("id", purged.map((asset) => asset.id))
      .eq("user_id", userId);
    if (error) throw new Error(error.message);
  }

  // Revisions and render jobs cascade with the project.
  const { error: projectError } = await supabase
    .from("creative_projects")
    .delete()
    .eq("id", projectId)
    .eq("user_id", userId);
  if (projectError) throw new Error(projectError.message);

  const candidates = [
    ...new Set(
      [...(renders.data ?? []).map((row) => row.output_url), ...purged.map((asset) => asset.url)]
        .filter((url): url is string => typeof url === "string" && url.length > 0),
    ),
  ];
  if (candidates.length === 0) return { found: true, filesRemoved: 0 };

  const stillUsed = await urlsStillReferenced(supabase, userId, candidates);
  const { removed } = await deleteUserFiles(userId, candidates.filter((url) => !stillUsed.has(url)));
  return { found: true, filesRemoved: removed };
}

/** Which of `urls` a surviving row still points at. */
async function urlsStillReferenced(
  supabase: SupabaseClient,
  userId: string,
  urls: string[],
): Promise<Set<string>> {
  const [assets, videos, renders] = await Promise.all([
    supabase.from("creative_assets").select("url").eq("user_id", userId).in("url", urls),
    supabase.from("video_generations").select("video_url").eq("user_id", userId).in("video_url", urls),
    supabase.from("creative_render_jobs").select("output_url").eq("user_id", userId).in("output_url", urls),
  ]);
  for (const result of [assets, videos, renders]) {
    // If a check cannot be made, keep everything: an orphaned file is cheap,
    // a deleted file something still uses is not.
    if (result.error) return new Set(urls);
  }
  return new Set([
    ...(assets.data ?? []).map((row) => String(row.url)),
    ...(videos.data ?? []).map((row) => String(row.video_url)),
    ...(renders.data ?? []).map((row) => String(row.output_url)),
  ]);
}
