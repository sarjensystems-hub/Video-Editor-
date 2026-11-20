/**
 * The storage path inside a /media/... or /files/... address, or null when it
 * is not a well-formed `<userId>/<kind>/<name>` path. Stored names only ever
 * use [A-Za-z0-9._-], so decoding is a no-op for them; it is tolerant only so
 * a stray encoding cannot throw.
 */
export function storagePathFromSegments(path: string[] | undefined): string[] | null {
  const segments = (path ?? []).map((segment) => {
    try {
      return decodeURIComponent(segment);
    } catch {
      return segment;
    }
  });
  if (segments.length < 3 || segments.some((segment) => !segment || segment === "." || segment === "..")) {
    return null;
  }
  return segments;
}

/**
 * The address that serves a stored file's bytes directly (see
 * app/files/[...path]/route.ts), for a /media link. Anything else is returned
 * unchanged.
 */
export function directFileUrl(mediaUrl: string): string {
  return mediaUrl.replace(/\/media\//, "/files/");
}
