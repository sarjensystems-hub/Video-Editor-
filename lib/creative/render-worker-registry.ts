/**
 * Where the self-hosted render worker can be reached right now.
 *
 * A worker behind a free Cloudflare quick tunnel gets a new public address
 * every time the tunnel restarts. Rather than editing an environment variable
 * and redeploying each time, the worker reports its address to
 * /api/render-worker/register (signed with the shared secret), and the app
 * keeps it as one small JSON object outside every user's folder.
 *
 * CREATIVE_RENDER_WORKER_URL, when set, is only the fallback for a worker
 * that has never registered.
 */

import { getObjectText, putObject } from "../b2";

export const RENDER_WORKER_REGISTRATION_KEY = "_system/render-worker.json";

/** Renders and previews ask often; storage reads are capped, so one read serves this long. */
const CACHE_MS = 15_000;

let cached: { url: string | null; atMs: number } | null = null;

/** The origin of an https URL, or null for anything else (http, credentials, garbage). */
export function normalizeRenderWorkerUrl(value: unknown): string | null {
  if (typeof value !== "string") return null;
  let url: URL;
  try {
    url = new URL(value.trim());
  } catch {
    return null;
  }
  if (url.protocol !== "https:" || url.username || url.password) return null;
  return url.origin;
}

export async function registeredRenderWorkerUrl(nowMs = Date.now()): Promise<string | null> {
  if (cached && nowMs - cached.atMs < CACHE_MS) return cached.url;
  try {
    const text = await getObjectText(RENDER_WORKER_REGISTRATION_KEY);
    const url = text ? normalizeRenderWorkerUrl((JSON.parse(text) as { url?: unknown }).url) : null;
    cached = { url, atMs: nowMs };
    return url;
  } catch (error) {
    console.warn("[render-worker] could not read the worker registration", error);
    // Keep using the last known address rather than dropping to the fallback.
    return cached?.url ?? null;
  }
}

export async function saveRenderWorkerUrl(url: string, nowMs = Date.now()): Promise<void> {
  await putObject(
    RENDER_WORKER_REGISTRATION_KEY,
    JSON.stringify({ url, registeredAt: new Date(nowMs).toISOString() }),
    "application/json",
  );
  cached = { url, atMs: nowMs };
}

/** Test seam: forget the cached address. */
export function resetRenderWorkerRegistryCache(): void {
  cached = null;
}
