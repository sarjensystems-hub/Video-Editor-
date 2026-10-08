import { presignGet } from "@/lib/b2";

export const runtime = "nodejs";

/** How long the signed storage URL behind a redirect stays valid. */
const SIGNED_SECONDS = 2 * 60 * 60;
/** How long a browser or the renderer may reuse a redirect before asking again. */
const REDIRECT_CACHE_SECONDS = 60 * 60;

/**
 * Every stored file's permanent address: `/media/<userId>/<kind>/<name>`.
 *
 * The bucket is private, so this answers with a redirect to a signed URL
 * that expires, while the link stored in the database - and handed to the
 * renderer, the editor and the assistant - never does. Anyone holding the
 * link can read the file, as with the public bucket before it: the names are
 * random UUIDs, and nothing here lists or reveals one.
 *
 * The signed URL outlives the cached redirect by an hour, so a video that
 * keeps seeking within one viewing never meets an expired link.
 */
async function redirectToFile(params: Promise<{ path: string[] }>): Promise<Response> {
  const { path } = await params;
  // Stored names only ever use [A-Za-z0-9._-], so decoding is a no-op for
  // them; it is tolerant only so a stray encoding cannot throw.
  const segments = (path ?? []).map((segment) => {
    try {
      return decodeURIComponent(segment);
    } catch {
      return segment;
    }
  });
  if (segments.length < 3 || segments.some((segment) => !segment || segment === "." || segment === "..")) {
    return new Response("Not found", { status: 404 });
  }
  const url = await presignGet(segments.join("/"), SIGNED_SECONDS);
  return new Response(null, {
    status: 307,
    headers: {
      Location: url,
      "Cache-Control": `public, max-age=${REDIRECT_CACHE_SECONDS}`,
    },
  });
}

export async function GET(_request: Request, { params }: { params: Promise<{ path: string[] }> }) {
  return redirectToFile(params);
}

export async function HEAD(_request: Request, { params }: { params: Promise<{ path: string[] }> }) {
  return redirectToFile(params);
}
