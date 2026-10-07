/**
 * Where every stored file lives: one folder per user, a subfolder per kind.
 *
 *   <userId>/videos/      generated videos
 *   <userId>/characters/  reference images uploaded for video generation
 *   <userId>/images/      generated and MCP-uploaded images
 *   <userId>/assets/      files uploaded into Creative Studio
 *   <userId>/audio/       voiceover, music and sound effects
 *   <userId>/renders/     finished MP4 exports
 *
 * The user id first is not decoration: the bucket's row-level security
 * allows a write only when the first folder is the writer's own id, and a
 * user's whole footprint can be found, measured or removed by one prefix.
 * Paths used to start with a kind and put the user id second, a layout from
 * Cloudflare R2 that has no row-level security, and the policy refused them.
 *
 * Preview frames are deliberately absent — they are never stored.
 */

export type StorageKind = "videos" | "characters" | "images" | "assets" | "audio" | "renders";

/** Builds a path inside the user's own folder. `name` may not climb out of it. */
export function userStoragePath(userId: string, kind: StorageKind, name: string): string {
  if (!userId || userId.includes("/")) throw new Error("A storage path needs a plain user id");
  const clean = name.replace(/^\/+/, "");
  if (!clean || clean.split("/").some((segment) => segment === ".." || segment === "")) {
    throw new Error(`Invalid storage file name: ${name}`);
  }
  return `${userId}/${kind}/${clean}`;
}

const PUBLIC_MARKER = "/storage/v1/object/public/";

/**
 * The bucket path behind one of our public URLs, or null for anything that
 * is not a file in `bucket` (an external URL, an R2 URL, a different bucket).
 * Deleting goes through this so it can only ever touch files we stored.
 */
export function storagePathFromPublicUrl(url: string | null | undefined, bucket: string): string | null {
  if (!url) return null;
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return null;
  }
  const prefix = `${PUBLIC_MARKER}${bucket}/`;
  const index = parsed.pathname.indexOf(prefix);
  if (index < 0) return null;
  const path = decodeURIComponent(parsed.pathname.slice(index + prefix.length));
  return path && !path.split("/").includes("..") ? path : null;
}
