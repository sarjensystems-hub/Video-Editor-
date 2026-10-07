/**
 * Object storage: one Supabase Storage bucket, one folder per user.
 *
 * Every path is built by `lib/storage-paths.ts`, so every file sits under
 * `<userId>/…`. Uploads return the public URL or `null` on failure, logged
 * loudly; deletes take the URLs the database recorded and remove only files
 * inside the caller's own folder.
 */

import { AsyncLocalStorage } from "node:async_hooks";
import type { SupabaseClient } from "@supabase/supabase-js";
import { createClient } from "@/lib/supabase/server";
import type { AIImageResult } from "@/lib/image-gen";
import { storagePathFromPublicUrl, userStoragePath } from "@/lib/storage-paths";

export const STORAGE_BUCKET = "article-images";

/**
 * The Supabase client uploads are made with, for requests that do not
 * authenticate through browser cookies.
 *
 * Writes used to go through `createClient()` from `@/lib/supabase/server`,
 * which reads the session cookie. An MCP request has no cookie — it carries a
 * Bearer token — so every upload it made went out as the anonymous role, was
 * refused by the bucket policy, and came back as `null`. The worst case was a
 * finished video: generated and billed by OpenRouter, then lost at the last
 * step because there was nowhere to put it.
 *
 * The MCP route already holds a client authorised for the caller, so it opens
 * this scope with that client and every storage call underneath uses it —
 * including work that finishes after the response, since the scope survives
 * `after()`. Browser routes open no scope and keep using their cookie session.
 */
const storageClientScope = new AsyncLocalStorage<SupabaseClient>();

export function runWithStorageClient<T>(client: SupabaseClient, fn: () => Promise<T>): Promise<T> {
  return storageClientScope.run(client, fn);
}

async function storageClient(): Promise<SupabaseClient> {
  return storageClientScope.getStore() ?? (await createClient());
}

/** Uploads bytes to `path` and returns the public URL, or null on failure. */
export async function uploadAnyBytes(
  bytes: Uint8Array,
  path: string,
  contentType: string,
): Promise<string | null> {
  try {
    const supabase = await storageClient();
    const { data, error } = await supabase.storage
      .from(STORAGE_BUCKET)
      .upload(path, bytes, { contentType, upsert: true });
    if (error) throw new Error(error.message);
    return supabase.storage.from(STORAGE_BUCKET).getPublicUrl(data.path).data.publicUrl;
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
 * Only files in our own bucket, on our own Supabase project and inside
 * `userId`'s folder are touched. That boundary matters because a
 * connector request's client bypasses row-level security, and a URL column
 * is data: without the check, a crafted URL could name someone else's file.
 *
 * Best-effort by design: a file that cannot be removed is logged and
 * reported, never allowed to block the database delete the user asked for.
 */
export async function deleteUserFiles(
  userId: string,
  urls: Array<string | null | undefined>,
): Promise<{ removed: number; skipped: number; notRemoved: number }> {
  const ownHost = (() => {
    try {
      return new URL(process.env.NEXT_PUBLIC_SUPABASE_URL ?? "").host;
    } catch {
      return null;
    }
  })();

  const paths = new Set<string>();
  let skipped = 0;
  for (const url of urls) {
    if (!url) continue;
    let host: string | null = null;
    try {
      host = new URL(url).host;
    } catch {
      host = null;
    }
    const path = storagePathFromPublicUrl(url, STORAGE_BUCKET);
    if (!path || !ownHost || host !== ownHost || !path.startsWith(`${userId}/`)) {
      skipped += 1;
      continue;
    }
    paths.add(path);
  }
  if (paths.size === 0) return { removed: 0, skipped, notRemoved: 0 };

  try {
    const supabase = await storageClient();
    const { data, error } = await supabase.storage.from(STORAGE_BUCKET).remove([...paths]);
    if (error) throw new Error(error.message);
    const removed = data?.length ?? 0;
    // remove() leaves already-missing files out of `data` rather than erroring.
    return { removed, skipped, notRemoved: paths.size - removed };
  } catch (cause) {
    console.error(`[storage] could not delete ${paths.size} file(s): ${cause instanceof Error ? cause.message : cause}`);
    return { removed: 0, skipped, notRemoved: paths.size };
  }
}
