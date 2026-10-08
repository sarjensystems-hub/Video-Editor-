import { createClient } from "@/lib/supabase/server";
import { isB2Configured } from "@/lib/b2";
import { loadMediaLibrary, type MediaItem } from "@/lib/media-library";
import PageHeader from "@/components/ui/PageHeader";
import MediaGallery from "@/components/media/MediaGallery";

export const dynamic = "force-dynamic";

export default async function MediaPage() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();

  let items: MediaItem[] = [];
  let error: string | null = null;
  if (!isB2Configured()) {
    error = "File storage is not configured on this deployment.";
  } else {
    try {
      items = await loadMediaLibrary(supabase, user!.id);
    } catch (cause) {
      error = cause instanceof Error ? cause.message : "Could not read your storage.";
    }
  }

  return (
    <div className="mx-auto w-full max-w-6xl px-4 py-6 sm:px-8 sm:py-10">
      <PageHeader
        eyebrow="Storage"
        title="Media"
        description="Every file in your storage: uploads, generated images, audio and videos, and finished renders. Delete what you no longer need."
      />
      {error ? (
        <p className="rounded-xl bg-danger-wash px-4 py-3 text-sm text-danger">{error}</p>
      ) : (
        <MediaGallery items={items} />
      )}
    </div>
  );
}
