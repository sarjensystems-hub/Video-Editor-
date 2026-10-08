/**
 * Object storage: one private Backblaze B2 bucket, one folder per user.
 *
 * Every path is built by `lib/storage-paths.ts`, so every file sits under
 * `<userId>/…`. Uploads return the file's permanent `/media/<path>` URL on
 * the app's own domain, which redirects to a short-lived signed B2 URL
 * (app/media/[...path]/route.ts); deletes take the URLs the database recorded
 * and remove only files inside the caller's own folder.
 *
 * Files used to live in Supabase Storage, whose free plan refuses any single
 * file over 50 MB. Supabase still holds the database and sign-in.
 */

import { AsyncLocalStorage } from "node:async_hooks";
import type { AIImageResult } from "@/lib/image-gen";
import { appUrl, requestOrigin } from "@/lib/app-url";
import { deleteObject, putObject } from "@/lib/b2";
import { mediaUrlFor, storagePathFromMediaUrl, userStoragePath } from "@/lib/storage-paths";

/**
 * The origin a stored file's URL is written with.
 *
 * Work that finishes after its response - a render, a generated video - has
 * no request left to ask, so the route that started it opens this scope with
 * its own origin and everything stored underneath uses it.
 */
const mediaOriginScope = new AsyncLocalStorage<string>();

export function runWithMediaOrigin<T>(origin: string, fn: () => Promise<T>): Promise<T> {
  return mediaOriginScope.run(origin, fn);
}

async function mediaOrigin(): Promise<string> {
  const scoped = mediaOriginScope.getStore();
  if (scoped) return scoped;
  try {
    return await requestOrigin();
  } catch {
    return appUrl();
  }
}

/** The permanent URL of an already-stored file. */
export async function mediaUrl(path: string): Promise<string> {
  return mediaUrlFor(await mediaOrigin(), path);
}

/** Uploads bytes to `path` and returns the file's permanent URL, or null on failure. */
export async function uploadAnyBytes(
  bytes: Uint8Array,
  path: string,
  contentType: string,
): Promise<string | null> {
  try {
    await putObject(path, bytes, contentType);
    return await mediaUrl(path);
  } catch (cause) {
    const message = cause instanceof Error ? cause.message : String(cause);
    console.error(`[storage] upload of ${path} failed: ${message}`);
    return null;
  }
}

/** Persists an image from `lib/image-gen.ts` into the user's images folder. */
export async function uploadAIImage(
  result: AIImageResult,
  userId: string,
  label: string,
): Promise<string | null> {
  if (!result) return null;
  try {
    let bytes: Uint8Array;
    let contentType = "image/png";
    if ("url" in result) {
      const response = await fetch(result.url);
      if (!response.ok) throw new Error(`source image returned ${response.status}`);
      contentType = response.headers.get("content-type") ?? "image/jpeg";
      bytes = new Uint8Array(await response.arrayBuffer());
    } else {
      bytes = new Uint8Array(Buffer.from(result.b64, "base64"));
    }
    const extension = contentType.includes("jpeg") ? "jpg" : contentType.split("/")[1] ?? "png";
    const name = `${label}-${Date.now()}-${crypto.randomUUID().slice(0, 8)}.${extension}`;
    return await uploadAnyBytes(bytes, userStoragePath(userId, "images", name), contentType);
  } catch (cause) {
    console.error(`[storage] could not persist generated image: ${cause instanceof Error ? cause.message : cause}`);
    return null;
  }
}

/**
 * Removes the stored files behind `urls`, which are URLs this app recorded in
 * the database (asset URLs, render outputs, video URLs).
 *
 * Only `/media/` URLs naming a path inside `userId`'s folder are touched. That
 * boundary matters because a URL column is data: without the check, a
 * crafted URL could name someone else's file. URLs from the old Supabase
 * storage are skipped - that storage was discarded, not migrated.
 *
 * Best-effort by design: a file that cannot be removed is logged and
 * reported, never allowed to block the database delete the user asked for.
 */
export async function deleteUserFiles(
  userId: string,
  urls: Array<string | null | undefined>,
): Promise<{ removed: number; skipped: number; notRemoved: number }> {
  const paths = new Set<string>();
  let skipped = 0;
  for (const url of urls) {
    if (!url) continue;
    const path = storagePathFromMediaUrl(url);
    if (!path || !path.startsWith(`${userId}/`)) {
      skipped += 1;
      continue;
    }
    paths.add(path);
  }
  if (paths.size === 0) return { removed: 0, skipped, notRemoved: 0 };

  let removed = 0;
  // A handful of files at a time: a workspace can hold hundreds.
  const queue = [...paths];
  await Promise.all(
    Array.from({ length: Math.min(6, queue.length) }, async () => {
      for (let path = queue.shift(); path; path = queue.shift()) {
        const ok = await deleteObject(path).catch((cause) => {
          console.error(`[storage] could not delete ${path}: ${cause instanceof Error ? cause.message : cause}`);
          return false;
        });
        if (ok) removed += 1;
      }
    }),
  );
  return { removed, skipped, notRemoved: paths.size - removed };
}
