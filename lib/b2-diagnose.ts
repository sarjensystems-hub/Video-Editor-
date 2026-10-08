/**
 * Answers "why does the browser's upload fail?" from the server, where the
 * answer is visible. A browser reports any refused cross-origin request as a
 * bare network error; here the same requests show their real status, CORS
 * headers and Backblaze's own message.
 */

import { abortMultipartUpload, createMultipartUpload, presignUploadPart } from "./b2";
import { userStoragePath } from "./storage-paths";

export interface StorageCorsRule {
  name: string;
  origins: string[];
  operations: string[];
}

/** The bucket's CORS rules, read with the app's own key. */
export async function readBucketCorsRules(): Promise<StorageCorsRule[]> {
  const keyId = process.env.B2_KEY_ID?.trim();
  const applicationKey = process.env.B2_APPLICATION_KEY?.trim();
  const bucketName = process.env.B2_BUCKET?.trim();
  if (!keyId || !applicationKey || !bucketName) throw new Error("Storage is not configured");
  const authorize = await fetch("https://api.backblazeb2.com/b2api/v3/b2_authorize_account", {
    headers: { Authorization: `Basic ${Buffer.from(`${keyId}:${applicationKey}`).toString("base64")}` },
  });
  const account = await authorize.json().catch(() => ({}));
  if (!authorize.ok) throw new Error(account?.message ?? `Backblaze sign-in failed (${authorize.status})`);
  const listed = await fetch(`${account.apiInfo.storageApi.apiUrl}/b2api/v3/b2_list_buckets`, {
    method: "POST",
    headers: { Authorization: account.authorizationToken, "Content-Type": "application/json" },
    body: JSON.stringify({ accountId: account.accountId, bucketName }),
  });
  const payload = await listed.json().catch(() => ({}));
  if (!listed.ok) throw new Error(payload?.message ?? `Could not read the bucket (${listed.status})`);
  const bucket = (payload.buckets ?? []).find((item: { bucketName: string }) => item.bucketName === bucketName);
  return (bucket?.corsRules ?? []).map((rule: { corsRuleName: string; allowedOrigins: string[]; allowedOperations: string[] }) => ({
    name: rule.corsRuleName,
    origins: rule.allowedOrigins,
    operations: rule.allowedOperations,
  }));
}

export interface UploadProbe {
  origin: string;
  preflight: { status: number; allowOrigin: string | null; allowMethods: string | null; allowHeaders: string | null };
  put: { status: number; allowOrigin: string | null; message: string | null };
}

/**
 * Sends one part to storage exactly as the browser would - a preflight, then
 * a PUT to a freshly signed part URL, both carrying the page's Origin - and
 * reports what came back. The trial upload is aborted, so nothing is kept.
 */
export async function probeBrowserUpload(userId: string, origin: string): Promise<UploadProbe> {
  const path = userStoragePath(userId, "assets", `uploads/_upload-check-${crypto.randomUUID()}.bin`);
  const uploadId = await createMultipartUpload(path, "application/octet-stream");
  try {
    const url = await presignUploadPart(path, uploadId, 1, 600);
    const preflight = await fetch(url, {
      method: "OPTIONS",
      headers: { Origin: origin, "Access-Control-Request-Method": "PUT" },
    });
    const put = await fetch(url, { method: "PUT", headers: { Origin: origin }, body: new Uint8Array(16) });
    const putText = put.ok ? "" : await put.text().catch(() => "");
    return {
      origin,
      preflight: {
        status: preflight.status,
        allowOrigin: preflight.headers.get("access-control-allow-origin"),
        allowMethods: preflight.headers.get("access-control-allow-methods"),
        allowHeaders: preflight.headers.get("access-control-allow-headers"),
      },
      put: {
        status: put.status,
        allowOrigin: put.headers.get("access-control-allow-origin"),
        message: putText.match(/<Message>([^<]*)<\/Message>/)?.[1] ?? (putText.slice(0, 200) || null),
      },
    };
  } finally {
    await abortMultipartUpload(path, uploadId);
  }
}
