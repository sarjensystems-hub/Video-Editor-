import { createClient } from "@/lib/supabase/server";
import { getActiveSiteId } from "@/lib/active-site";
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
    .eq("site_id", activeSiteId)
    .order("created_at", { ascending: false })
    .limit(30);

  return <VideosWorkspace initialJobs={(jobs ?? []) as VideoGenerationRow[]} />;
}
