/**
 * Recognises a URL as one of our own storage objects.
 *
 * Two routes now fetch a URL that came out of the database and stream or read
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

  const r2 = process.env.R2_PUBLIC_BASE_URL;
  if (r2) {
    try {
      if (url.hostname === new URL(r2).hostname) return true;
    } catch {
      // A malformed env var must not make every URL trusted.
    }
  }

  const supabase = process.env.NEXT_PUBLIC_SUPABASE_URL;
  if (supabase) {
    try {
      if (url.hostname === new URL(supabase).hostname && url.pathname.includes("/storage/")) return true;
    } catch {
      // As above.
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
