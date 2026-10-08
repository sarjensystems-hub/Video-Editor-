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
 * The user id first is not decoration: deletes refuse any path outside the
 * caller's own folder, and a user's whole footprint can be found, measured
 * or removed by one prefix.
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

/**
 * Whether `path` is a file inside this user's `kind` folder. A browser upload
 * reports back the path it wrote to; this is how the server checks the path
 * is one it could have issued, before recording it as the user's asset.
 */
export function isUserStoragePath(userId: string, kind: StorageKind, path: unknown): path is string {
  if (typeof path !== "string" || !userId) return false;
  const prefix = `${userId}/${kind}/`;
  if (!path.startsWith(prefix) || path.length === prefix.length) return false;
  return !path.slice(prefix.length).split("/").some((segment) => segment === ".." || segment === "");
}

/** Where stored files are served from on the app's own domain. */
export const MEDIA_ROUTE_PREFIX = "/media/";

/** The app URL that serves the stored file at `path`. */
export function mediaUrlFor(origin: string, path: string): string {
  return `${origin.replace(/\/+$/, "")}${MEDIA_ROUTE_PREFIX}${path.split("/").map(encodeURIComponent).join("/")}`;
}

/**
 * The storage path behind one of our `/media/` URLs, on whichever domain the
 * app answered on, or null for anything else (an external URL, a file from
 * the old Supabase storage). Deleting goes through this, so it can only ever
 * touch files we stored.
 */
export function storagePathFromMediaUrl(url: string | null | undefined): string | null {
  if (!url) return null;
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return null;
  }
  if (!parsed.pathname.startsWith(MEDIA_ROUTE_PREFIX)) return null;
  let path: string;
  try {
    path = decodeURIComponent(parsed.pathname.slice(MEDIA_ROUTE_PREFIX.length));
  } catch {
    return null;
  }
  return path && !path.split("/").some((segment) => segment === ".." || segment === "") ? path : null;
}
