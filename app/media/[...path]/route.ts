import { presignGet } from "@/lib/b2";
import { BRAND } from "@/lib/brand";

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
/**
 * `?download=<name>` saves the file under that name instead of opening it. The
 * name lands inside a signed header, so only plain filename characters survive.
 */
function downloadFileName(requested: string | null): string | undefined {
  const name = requested?.replace(/[^A-Za-z0-9 ._()-]/g, "").replace(/\s+/g, " ").trim().slice(0, 120);
  return name ? name : undefined;
}

const VIDEO_EXTENSION = /\.(mp4|webm|mov|m4v)$/i;

/**
 * A person opening a video link in a browser tab. Media elements, the
 * renderer and server-side fetches never send Sec-Fetch-Dest: document, so
 * they keep getting the redirect.
 */
function isBrowserPageVisit(request: Request): boolean {
  const dest = request.headers.get("sec-fetch-dest");
  if (dest) return dest === "document";
  return (request.headers.get("accept") ?? "").includes("text/html");
}

function escapeHtml(value: string): string {
  return value.replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);
}

/**
 * The page a shared video link opens: a player whose source is the same link
 * with ?raw=1. The address bar keeps the short, permanent /media link, so
 * whatever someone copies from it keeps working, rather than the signed
 * storage URL the redirect lands on, which expires after SIGNED_SECONDS and
 * then answers "Access Denied". The video still streams straight from
 * storage; nothing passes through this function but the page itself.
 */
function videoPage(segments: string[]): Response {
  const path = `/media/${segments.map(encodeURIComponent).join("/")}`;
  const fileName = segments[segments.length - 1];
  const title = escapeHtml(`${BRAND.name} video`);
  const src = escapeHtml(`${path}?raw=1`);
  const download = escapeHtml(`${path}?download=${encodeURIComponent(fileName)}`);
  const html = `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="robots" content="noindex, nofollow">
<title>${title}</title>
<meta property="og:title" content="${title}">
<meta property="og:type" content="video.other">
<style>
  html, body { margin: 0; height: 100%; background: #0b0b0c; color: #e7e7ea; font: 14px system-ui, sans-serif; }
  main { min-height: 100%; display: flex; flex-direction: column; align-items: center; justify-content: center; gap: 14px; padding: 16px; box-sizing: border-box; }
  video { max-width: 100%; max-height: calc(100vh - 80px); border-radius: 8px; background: #000; }
  a { color: #b9b9c2; text-decoration: none; border: 1px solid #333; padding: 6px 12px; border-radius: 6px; }
  a:hover { color: #fff; border-color: #666; }
</style>
</head>
<body>
<main>
  <video src="${src}" controls autoplay playsinline preload="metadata"></video>
  <a href="${download}">Download</a>
</main>
</body>
</html>`;
  return new Response(html, {
    status: 200,
    headers: {
      "Content-Type": "text/html; charset=utf-8",
      "Cache-Control": "public, max-age=300",
      "X-Robots-Tag": "noindex, nofollow",
    },
  });
}

async function redirectToFile(request: Request, params: Promise<{ path: string[] }>): Promise<Response> {
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
  const query = new URL(request.url).searchParams;
  if (
    request.method === "GET" &&
    !query.has("raw") &&
    !query.has("download") &&
    VIDEO_EXTENSION.test(segments[segments.length - 1]) &&
    isBrowserPageVisit(request)
  ) {
    return videoPage(segments);
  }
  const downloadName = downloadFileName(query.get("download"));
  const url = await presignGet(segments.join("/"), SIGNED_SECONDS, { downloadName });
  return new Response(null, {
    status: 307,
    headers: {
      Location: url,
      "Cache-Control": `public, max-age=${REDIRECT_CACHE_SECONDS}`,
      // The same link answers a page or a redirect depending on who asks.
      Vary: "Sec-Fetch-Dest, Accept",
    },
  });
}

export async function GET(request: Request, { params }: { params: Promise<{ path: string[] }> }) {
  return redirectToFile(request, params);
}

export async function HEAD(request: Request, { params }: { params: Promise<{ path: string[] }> }) {
  return redirectToFile(request, params);
}
