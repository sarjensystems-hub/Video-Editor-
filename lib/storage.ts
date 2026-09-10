/**
 * Object storage adapter.
 *
 * Writes go to **Cloudflare R2** when configured (the production setup);
 * otherwise they fall back to **Supabase Storage** so local dev without R2
 * keeps working. Reads continue to work for any URL ever returned — old
 * Supabase URLs in the DB stay valid, new uploads point at R2.
 *
 * Each helper returns the public URL on success, or `null` on failure.
 * Failures are logged loudly so storage outages or quota issues surface
 * in the function logs instead of silently producing image-less posts.
 */

import { createClient } from "@/lib/supabase/server";
import { isR2Configured, r2Upload } from "@/lib/r2";
import type { AIImageResult } from "@/lib/image-gen";

const BUCKET = "article-images";

function logFailure(prefix: string, err: unknown) {
  const msg = err instanceof Error ? err.message : String(err);
  console.error(`[storage] ${prefix} — upload FAILED: ${msg}. Image will be missing from the post. If you've hit Supabase Storage quota, set the R2_* env vars to route uploads to Cloudflare R2.`);
}

/**
 * Persist an `AIImageResult` (URL or base64) returned from any of the
 * `lib/image-gen.ts` helpers. Returns the public URL, or null on failure.
 *
 * Routes that need custom JPEG re-encoding (social posts, where text edges
 * matter) still decode/sharp the result themselves — see
 * `app/api/ai/social/generate/route.ts:resolveImageUrl`.
 */
export async function uploadAIImage(
  result: AIImageResult,
  userId: string,
  label:  string,
): Promise<string | null> {
  if (!result) return null;
  const path = imageStoragePath(userId, label);
  if ("url" in result) return uploadImageFromUrl(result.url, path);
  return uploadBase64Image(result.b64, path);
}

/**
 * Download an image from a hosted URL and upload it to persistent storage.
 * Returns the public URL, or null on failure.
 */
export async function uploadImageFromUrl(
  imageUrl: string,
  filename: string,
): Promise<string | null> {
  try {
    const res = await fetch(imageUrl);
    if (!res.ok) {
      console.error(`[storage] Failed to fetch source image from ${imageUrl}: ${res.status}`);
      return null;
    }
    const contentType = res.headers.get("content-type") ?? "image/jpeg";
    const buffer = Buffer.from(await res.arrayBuffer());
    return await putBytes(filename, buffer, contentType);
  } catch (e) {
    logFailure("uploadImageFromUrl", e);
    return null;
  }
}

/** Generate a unique storage path scoped to a user. */
export function imageStoragePath(userId: string, label: string): string {
  const ts = Date.now();
  const rand = Math.random().toString(36).slice(2, 7);
  return `${userId}/${label}-${ts}-${rand}.jpg`;
}

/** Upload raw bytes (PNG/JPEG) directly. */
export async function uploadImageBytes(
  bytes: Uint8Array,
  filename: string,
  contentType = "image/png",
): Promise<string | null> {
  try {
    return await putBytes(filename, bytes, contentType);
  } catch (e) {
    logFailure("uploadImageBytes", e);
    return null;
  }
}

/** Upload a base64-encoded image (e.g. from OpenRouter / gpt-image). */
export async function uploadBase64Image(
  base64: string,
  filename: string,
): Promise<string | null> {
  try {
    const buffer = Buffer.from(base64, "base64");
    return await putBytes(filename, buffer, "image/png");
  } catch (e) {
    logFailure("uploadBase64Image", e);
    return null;
  }
}

/**
 * One-shot byte uploader used as a convenience for routes that handle their
 * own file objects (e.g. the product-image upload endpoint). Returns the
 * public URL or null.
 */
export async function uploadAnyBytes(
  bytes: Uint8Array,
  filename: string,
  contentType: string,
): Promise<string | null> {
  try {
    return await putBytes(filename, bytes, contentType);
  } catch (e) {
    logFailure("uploadAnyBytes", e);
    return null;
  }
}

/* ── internal ────────────────────────────────────────────────────────────
   The single write path. Tries R2 first, Supabase second. Throws on the
   chosen backend's error so the caller's catch block surfaces a single
   failure source instead of swallowing two layers. */
async function putBytes(
  filename: string,
  bytes: Uint8Array | Buffer,
  contentType: string,
): Promise<string> {
  if (isR2Configured()) {
    return r2Upload(filename, bytes, contentType);
  }

  const supabase = await createClient();
  const { data, error } = await supabase.storage
    .from(BUCKET)
    .upload(filename, bytes, { contentType, upsert: true });
  if (error) {
    /* Decorate the error so quota issues are obvious. */
    const msg = /exceed|quota|limit|payload too large/i.test(error.message)
      ? `Supabase Storage quota exceeded (${error.message}). Configure R2_* env vars to switch to Cloudflare R2.`
      : error.message;
    throw new Error(msg);
  }
  const { data: { publicUrl } } = supabase.storage.from(BUCKET).getPublicUrl(data.path);
  return publicUrl;
}
