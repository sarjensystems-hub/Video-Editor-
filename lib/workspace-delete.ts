import type { SupabaseClient } from "@supabase/supabase-js";
import { urlsStillReferenced } from "./creative/project-delete";
import { deleteUserFiles } from "./storage";

/**
 * Deletes a workspace and the generated videos that belong to it, files
 * included.
 *
 * The schema cascades a workspace's video_generations rows away with it, but
 * nothing removed their files: every generated MP4 and every character
 * reference image uploaded for those generations stayed in storage. Projects,
 * folders and assets are not deleted — they only lose their workspace — so any
 * file one of them still uses is kept. A promoted video is the usual case: its
 * project asset plays from the same file the generation produced.
 *
 * Rows first, files second, for the same reason as project deletion: a failed
 * file delete orphans bytes, the reverse could break something still in use.
 */
export async function deleteWorkspaceWithFiles(
  supabase: SupabaseClient,
  userId: string,
  siteId: string,
): Promise<{ found: boolean; filesRemoved: number }> {
  const { data: generations, error: readError } = await supabase
    .from("video_generations")
    .select("video_url, characters")
    .eq("site_id", siteId)
    .eq("user_id", userId);
  if (readError) throw new Error(readError.message);

  const { error, count } = await supabase
    .from("sites")
    .delete({ count: "exact" })
    .eq("id", siteId)
    .eq("user_id", userId);
  if (error) throw new Error(error.message);
  if (!count) return { found: false, filesRemoved: 0 };

  const candidates = [
    ...new Set(
      (generations ?? []).flatMap((row) => [
        row.video_url,
        ...(Array.isArray(row.characters)
          ? (row.characters as Array<{ url?: unknown }>).map((character) => character?.url)
          : []),
      ]).filter((url): url is string => typeof url === "string" && url.length > 0),
    ),
  ];
  if (candidates.length === 0) return { found: true, filesRemoved: 0 };

  const stillUsed = await urlsStillReferenced(supabase, userId, candidates);
  const { removed } = await deleteUserFiles(userId, candidates.filter((url) => !stillUsed.has(url)));
  return { found: true, filesRemoved: removed };
}
