/**
 * Shared rules for files people upload into Creative Studio, used by both
 * upload routes and by the editor's form.
 */

import type { CreativeAssetMediaKind } from "./asset-class";

/** A storage-safe version of the uploaded file's own name. */
export function safeUploadFilename(name: string): string {
  const clean = (name || "asset").replace(/[^a-zA-Z0-9._-]+/g, "-").replace(/^-+|-+$/g, "");
  return clean.slice(0, 120) || "asset";
}

/** The media kind a MIME type belongs to. */
export function uploadKindFor(contentType: string): CreativeAssetMediaKind {
  if (contentType.startsWith("image/")) return "image";
  if (contentType.startsWith("video/")) return "video";
  if (contentType.startsWith("audio/")) return "audio";
  if (/font|woff|ttf|otf/i.test(contentType)) return "font";
  return "other";
}

/** A finite, positive integer measurement, or null. */
export function positiveInt(value: unknown): number | null {
  const number = typeof value === "number" ? value : Number(value);
  return Number.isFinite(number) && number > 0 ? Math.round(number) : null;
}
