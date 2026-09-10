/**
 * Cloudflare R2 client + uploader.
 *
 * R2 is S3-compatible, so we use the AWS S3 SDK with R2's endpoint and a
 * forced "auto" region. Public URLs are served either from R2's r2.dev
 * subdomain or a custom domain you've bound to the bucket; the code only
 * needs `R2_PUBLIC_BASE_URL` to know where to point readers.
 *
 * Required env vars (all five must be set for R2 to be active — otherwise
 * the storage layer falls back to Supabase Storage):
 *   R2_ACCOUNT_ID          — your Cloudflare account ID
 *   R2_ACCESS_KEY_ID       — R2 access key, "Object Read & Write" scope
 *   R2_SECRET_ACCESS_KEY   — paired secret
 *   R2_BUCKET              — bucket name, e.g. "studio-images"
 *   R2_PUBLIC_BASE_URL     — public URL prefix, e.g. "https://pub-XXX.r2.dev"
 *                            or "https://images.studio.example.com"  (no trailing slash)
 */

import { S3Client, PutObjectCommand } from "@aws-sdk/client-s3";

let cached: { client: S3Client; bucket: string; publicBase: string } | null = null;

function buildClient(): { client: S3Client; bucket: string; publicBase: string } | null {
  if (cached) return cached;

  const accountId  = process.env.R2_ACCOUNT_ID;
  const accessKey  = process.env.R2_ACCESS_KEY_ID;
  const secretKey  = process.env.R2_SECRET_ACCESS_KEY;
  const bucket     = process.env.R2_BUCKET;
  const publicBase = process.env.R2_PUBLIC_BASE_URL;
  if (!accountId || !accessKey || !secretKey || !bucket || !publicBase) return null;

  const client = new S3Client({
    region:  "auto",
    endpoint: `https://${accountId}.r2.cloudflarestorage.com`,
    credentials: { accessKeyId: accessKey, secretAccessKey: secretKey },
  });

  cached = { client, bucket, publicBase: publicBase.replace(/\/$/, "") };
  return cached;
}

export function isR2Configured(): boolean {
  return buildClient() !== null;
}

/**
 * Upload bytes to R2 and return the public URL.
 * Throws on failure — caller should catch.
 */
export async function r2Upload(
  key: string,
  bytes: Uint8Array | Buffer,
  contentType: string,
): Promise<string> {
  const cfg = buildClient();
  if (!cfg) throw new Error("R2 is not configured");

  await cfg.client.send(new PutObjectCommand({
    Bucket:      cfg.bucket,
    Key:         key,
    Body:        bytes,
    ContentType: contentType,
    /* Cache the object aggressively — these are content-hashed paths that
       never change once written. */
    CacheControl: "public, max-age=31536000, immutable",
  }));

  return `${cfg.publicBase}/${key}`;
}
