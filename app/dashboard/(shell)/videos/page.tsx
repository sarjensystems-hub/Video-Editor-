import { createClient } from "@/lib/supabase/server";
import VideosWorkspace from "@/components/videos/VideosWorkspace";
import type { VideoGenerationRow } from "@/lib/video-gen";

export default async function VideosPage() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();

  const { data: jobs } = await supabase
    .from("video_generations")
    .select("*")
    .eq("user_id", user!.id)
    .order("created_at", { ascending: false })
    .limit(30);

  return <VideosWorkspace initialJobs={(jobs ?? []) as VideoGenerationRow[]} />;
}
