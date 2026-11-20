import { presignGet } from "@/lib/b2";
import { storagePathFromSegments } from "@/lib/media-path";

export const runtime = "nodejs";
// A large render can take a while to hand over to a slow fetcher.
export const maxDuration = 300;

/** Upstream headers worth passing on: what a fetcher needs to read a file. */
const PASSED_HEADERS = ["content-type", "content-length", "content-range", "accept-ranges", "etag", "last-modified"];

/**
 * `/files/<userId>/<kind>/<name>`: the same file as `/media/...`, served
 * directly instead of by redirect.
 *
 * Publishing services (Buffer, Instagram, ...) fetch a video by URL, often
 * only when the post goes out, and expect the URL itself to answer with the
 * file: a video content type and a Content-Length, no redirect to follow and
 * no page. /media answers with a redirect to a signed storage URL that
 * expires, or with a player page in a browser tab, so they could not read it.
 *
 * The bytes pass through this function, so they count against Vercel's
 * bandwidth: keep /media for everything that can follow a redirect (the
 * editor, the renderer, people) and hand this address only to services that
 * cannot. Range requests are passed on, so seeking and resumed downloads work.
 */
async function serveFile(request: Request, params: Promise<{ path: string[] }>): Promise<Response> {
  const { path } = await params;
  const segments = storagePathFromSegments(path);
  if (!segments) return new Response("Not found", { status: 404 });

  const signed = await presignGet(segments.join("/"), 15 * 60);
  const headers: Record<string, string> = {};
  const range = request.headers.get("range");
  if (range) headers.Range = range;
  const upstream = await fetch(signed, { method: request.method === "HEAD" ? "HEAD" : "GET", headers });

  if (upstream.status === 404 || upstream.status === 403) {
    await upstream.body?.cancel();
    return new Response("Not found", { status: 404 });
  }
  if (!upstream.ok) {
    await upstream.body?.cancel();
    return new Response("Storage is unavailable", { status: 502 });
  }

  const out = new Headers();
  for (const name of PASSED_HEADERS) {
    const value = upstream.headers.get(name);
    if (value) out.set(name, value);
  }
  if (!out.has("accept-ranges")) out.set("accept-ranges", "bytes");
  out.set("content-disposition", `inline; filename="${segments[segments.length - 1]}"`);
  out.set("cache-control", "private, max-age=3600");
  out.set("x-robots-tag", "noindex, nofollow");

  return new Response(request.method === "HEAD" ? null : upstream.body, { status: upstream.status, headers: out });
}

export async function GET(request: Request, { params }: { params: Promise<{ path: string[] }> }) {
  return serveFile(request, params);
}

export async function HEAD(request: Request, { params }: { params: Promise<{ path: string[] }> }) {
  return serveFile(request, params);
}
