import type { SupabaseClient } from "@supabase/supabase-js";
import { presignGet, presignPut } from "../b2";
import { mediaUrl } from "../storage";
import { storagePathFromMediaUrl, userStoragePath } from "../storage-paths";
import type { PreviewCopyStore } from "./sandbox-media";

/** Where an asset's preview copy is stored: next to the user's other assets. */
export function previewCopyPath(userId: string, assetId: string): string {
  return userStoragePath(userId, "assets", `previews/${assetId}.mp4`);
}

/**
 * A URL the render sandbox can download from without credentials. Our own
 * /media URLs are signed directly, skipping the redirect; anything else (an
 * external URL) is used as it is.
 */
export async function sandboxDownloadUrl(url: string): Promise<string> {
  const path = storagePathFromMediaUrl(url);
  return path ? presignGet(path, 2 * 60 * 60) : url;
}

/** Stores preview copies for `userId`'s assets and records them on the asset rows. */
export function previewCopyStore(supabase: SupabaseClient, userId: string): PreviewCopyStore {
  return {
    async target(assetId) {
      const path = previewCopyPath(userId, assetId);
      return { putUrl: await presignPut(path, 60 * 60), url: await mediaUrl(path) };
    },
    async save(assetId, url, sizeBytes) {
      const { data } = await supabase
        .from("creative_assets")
        .select("metadata")
        .eq("id", assetId)
        .eq("user_id", userId)
        .maybeSingle();
      if (!data) return;
      const metadata = data.metadata && typeof data.metadata === "object" ? (data.metadata as Record<string, unknown>) : {};
      const { error } = await supabase
        .from("creative_assets")
        .update({ metadata: { ...metadata, preview_url: url, preview_size_bytes: sizeBytes } })
        .eq("id", assetId)
        .eq("user_id", userId);
      if (error) console.warn(`[preview-copies] could not record the copy for ${assetId}: ${error.message}`);
    },
  };
}
