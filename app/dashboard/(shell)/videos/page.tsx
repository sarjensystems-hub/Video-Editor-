import { createClient } from "@/lib/supabase/server";
import { getActiveSiteId, workspaceScopeFilter } from "@/lib/active-site";
import NoSiteSelected from "@/components/NoSiteSelected";
import VideosWorkspace from "@/components/videos/VideosWorkspace";
import type { VideoGenerationRow } from "@/lib/video-gen";

export default async function VideosPage() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  const activeSiteId = await getActiveSiteId();

  if (!activeSiteId) return <NoSiteSelected />;

  const { data: jobs } = await supabase
    .from("video_generations")
    .select("*")
    .eq("user_id", user!.id)
    .or(workspaceScopeFilter(activeSiteId) ?? "site_id.is.null")
    .order("created_at", { ascending: false })
    .limit(30);

  return <VideosWorkspace initialJobs={(jobs ?? []) as VideoGenerationRow[]} />;
}
