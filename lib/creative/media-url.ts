import { storagePathFromMediaUrl, type StorageKind } from "@/lib/storage-paths";

/**
 * The storage path behind one of the caller's own `/media/<path>` URLs, or
 * null for anything else.
 *
 * This is how every file has been stored since files left Supabase Storage.
 * Only the path is used, never the URL's host, so a crafted row cannot point
 * the server anywhere: the caller signs a storage URL for that path itself,
 * and only inside the user's own folder (and kind, when one is given).
 */
export function ownedMediaPath(raw: string | null | undefined, userId: string, kind?: StorageKind): string | null {
  const path = storagePathFromMediaUrl(raw);
  if (!path || !userId) return null;
  const prefix = kind ? `${userId}/${kind}/` : `${userId}/`;
  return path.startsWith(prefix) && path.length > prefix.length ? path : null;
}

/**
 * Recognises a URL as a file in the old Supabase Storage, for rows written
 * before files moved to `/media/` URLs (see `ownedMediaPath` for those).
 *
 * Two routes fetch a URL that came out of the database and stream or read
 * its bytes. Both need the same guarantee — that the URL points at storage we
 * wrote, not somewhere a crafted row could send the server — so the rule lives
 * in one place rather than being written twice and drifting.
 */
export function isTrustedMediaUrl(raw: string): boolean {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    return false;
  }
  if (url.protocol !== "https:") return false;

  const supabase = process.env.NEXT_PUBLIC_SUPABASE_URL;
  if (supabase) {
    try {
      if (url.hostname === new URL(supabase).hostname && url.pathname.includes("/storage/")) return true;
    } catch {
      // A malformed env var must not make every URL trusted.
    }
  }

  return false;
}

/** A filesystem-safe name for a downloaded render. */
export function downloadFilename(title: string, scope: string, when: string | null): string {
  const slug = (title || "creative")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 60) || "creative";
  const date = when && !Number.isNaN(Date.parse(when))
    ? new Date(when).toISOString().slice(0, 10)
    : new Date().toISOString().slice(0, 10);
  const suffix = scope && scope !== "film" ? `-${scope.toLowerCase().replace(/[^a-z0-9]+/g, "-")}` : "";
  return `${slug}${suffix}-${date}.mp4`;
}
