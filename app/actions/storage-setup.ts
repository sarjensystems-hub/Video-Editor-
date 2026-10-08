"use server";

import { createClient } from "@/lib/supabase/server";
import { appUrl, requestOrigin } from "@/lib/app-url";
import { applyUploadCors } from "@/lib/b2-cors";

/**
 * Lets the browser upload into the storage bucket, using the Backblaze
 * master key the owner pastes once. The key exists only for this call.
 */
export async function enableStorageUploads(
  keyId: string,
  applicationKey: string,
): Promise<{ ok: true; origins: string[] } | { ok: false; error: string }> {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return { ok: false, error: "Sign in first." };

  const bucketName = process.env.B2_BUCKET?.trim();
  if (!bucketName) return { ok: false, error: "B2_BUCKET is not set on this deployment." };
  if (!keyId.trim() || !applicationKey.trim()) return { ok: false, error: "Enter both the key ID and the key." };

  // Every address the app is opened on: this one, the configured one and
  // Vercel's production domain.
  const origins = [await requestOrigin(), appUrl()];
  const production = process.env.VERCEL_PROJECT_PRODUCTION_URL?.trim();
  if (production) origins.push(`https://${production.replace(/^https?:\/\//, "")}`);

  try {
    const result = await applyUploadCors({
      keyId: keyId.trim(),
      applicationKey: applicationKey.trim(),
      bucketName,
      origins: origins.filter((origin) => origin.startsWith("https://")),
    });
    return { ok: true, origins: result.origins };
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : String(error) };
  }
}
