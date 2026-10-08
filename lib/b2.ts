/**
 * Object storage through the S3 API: the one place every stored file lives.
 * Supabase keeps the database and sign-in; files left it because its free
 * plan refuses anything over 50 MB, which is most video.
 *
 * Two providers speak the same API here:
 *   - Tigris (TIGRIS_*), preferred whenever it is configured. Downloads are
 *     free; its free plan caps storage at 5 GB and requests per month, and
 *     interrupts service past them rather than billing, since no card is on
 *     file.
 *   - Backblaze B2 (B2_*), the earlier provider, kept as the fallback. Its
 *     free plan caps downloads at 1 GB a day, which a video editor exhausts.
 *
 * The bucket is private. Nothing outside this module ever sees a storage URL
 * that lasts: files are addressed as `/media/<path>` on the app's own domain,
 * and that route hands out a short-lived signed URL.
 *
 * Requests are signed with aws4fetch (SigV4) rather than the AWS SDK, which
 * would add megabytes to every function for a handful of calls.
 */

import { AwsClient } from "aws4fetch";

export interface StorageTarget {
  provider: "tigris" | "b2";
  accessKeyId: string;
  secretAccessKey: string;
  region: string;
  /** Bucket root URL; object keys are appended to it. */
  bucketUrl: string;
}

function clean(value: string | undefined): string | undefined {
  const trimmed = value?.trim();
  return trimmed ? trimmed : undefined;
}

function host(value: string): string {
  return value.replace(/^https?:\/\//, "").replace(/\/+$/, "");
}

/** Which bucket the app stores in, from the environment. Tigris wins when both are set. */
export function resolveStorageTarget(env: NodeJS.ProcessEnv = process.env): StorageTarget | null {
  const tigrisKey = clean(env.TIGRIS_ACCESS_KEY_ID);
  const tigrisSecret = clean(env.TIGRIS_SECRET_ACCESS_KEY);
  const tigrisBucket = clean(env.TIGRIS_BUCKET);
  if (tigrisKey && tigrisSecret && tigrisBucket) {
    // Virtual-hosted addressing, which Tigris recommends; verified at build
    // time alongside path-style before the switch.
    const endpoint = host(clean(env.TIGRIS_ENDPOINT) ?? "https://t3.storage.dev");
    return {
      provider: "tigris",
      accessKeyId: tigrisKey,
      secretAccessKey: tigrisSecret,
      region: "auto",
      bucketUrl: `https://${tigrisBucket}.${endpoint}`,
    };
  }
  const keyId = clean(env.B2_KEY_ID);
  const applicationKey = clean(env.B2_APPLICATION_KEY);
  const bucket = clean(env.B2_BUCKET);
  const b2Endpoint = clean(env.B2_ENDPOINT);
  if (keyId && applicationKey && bucket && b2Endpoint) {
    const endpoint = host(b2Endpoint);
    return {
      provider: "b2",
      accessKeyId: keyId,
      secretAccessKey: applicationKey,
      // s3.us-east-005.backblazeb2.com -> us-east-005
      region: endpoint.match(/^s3\.([a-z0-9-]+)\.backblazeb2\.com$/i)?.[1] ?? "us-east-1",
      bucketUrl: `https://${endpoint}/${encodeURIComponent(bucket)}`,
    };
  }
  return null;
}

interface B2Config {
  client: AwsClient;
  bucketUrl: string;
}

let cached: B2Config | null = null;

function config(): B2Config {
  if (cached) return cached;
  const target = resolveStorageTarget();
  if (!target) {
    throw new Error("File storage is not configured: set TIGRIS_ACCESS_KEY_ID, TIGRIS_SECRET_ACCESS_KEY and TIGRIS_BUCKET");
  }
  cached = {
    client: new AwsClient({
      accessKeyId: target.accessKeyId,
      secretAccessKey: target.secretAccessKey,
      service: "s3",
      region: target.region,
    }),
    bucketUrl: target.bucketUrl,
  };
  return cached;
}

/** Whether storage is configured at all; lets tests and local builds say so plainly. */
export function isB2Configured(): boolean {
  return resolveStorageTarget() !== null;
}

/** Encodes each path segment, keeping the slashes that make the folders. */
export function encodeObjectKey(path: string): string {
  return path.split("/").map(encodeURIComponent).join("/");
}

function objectUrl(path: string, query = ""): string {
  return `${config().bucketUrl}/${encodeObjectKey(path)}${query}`;
}

async function failure(response: Response, action: string): Promise<Error> {
  const text = await response.text().catch(() => "");
  const message = text.match(/<Message>([^<]*)<\/Message>/)?.[1] ?? text.slice(0, 300);
  return new Error(`Storage ${action} failed (${response.status}): ${message}`);
}

/**
 * Signs a request that carries a body, then sends the original bytes with an
 * explicit length.
 *
 * aws4fetch's own fetch re-wraps the body in a Request, which Node then
 * streams with chunked encoding - and B2 refuses any upload that does not
 * declare Content-Length (411). Signing and sending separately keeps the
 * length known. The payload is signed as UNSIGNED-PAYLOAD, so the bytes are
 * never hashed in memory.
 */
async function sendWithBody(url: string, method: string, body: Uint8Array | string, headers: Record<string, string>): Promise<Response> {
  const bytes = typeof body === "string" ? new TextEncoder().encode(body) : body;
  const signed = await config().client.sign(url, {
    method,
    headers: { ...headers, "Content-Length": String(bytes.byteLength) },
  });
  return fetch(signed.url, { method, headers: signed.headers, body: bytes as BodyInit });
}

export async function putObject(path: string, body: Uint8Array | ArrayBuffer | string, contentType: string): Promise<void> {
  const bytes = body instanceof ArrayBuffer ? new Uint8Array(body) : body;
  const response = await sendWithBody(objectUrl(path), "PUT", bytes, { "Content-Type": contentType });
  if (!response.ok) throw await failure(response, `upload of ${path}`);
}

export async function getObjectText(path: string): Promise<string | null> {
  const response = await config().client.fetch(objectUrl(path), { method: "GET" });
  if (response.status === 404) return null;
  if (!response.ok) throw await failure(response, `read of ${path}`);
  return response.text();
}

export async function headObject(path: string): Promise<{ size: number; contentType: string | null } | null> {
  const response = await config().client.fetch(objectUrl(path), { method: "HEAD" });
  if (response.status === 404) return null;
  if (!response.ok) throw new Error(`Storage head of ${path} failed (${response.status})`);
  return {
    size: Number(response.headers.get("content-length") ?? 0),
    contentType: response.headers.get("content-type"),
  };
}

export async function deleteObject(path: string): Promise<boolean> {
  const response = await config().client.fetch(objectUrl(path), { method: "DELETE" });
  // S3 answers 204 whether or not the file existed.
  return response.ok;
}

/** Object keys under a prefix, with their sizes and last-modified times. */
export async function listObjects(prefix: string): Promise<Array<{ key: string; size: number; lastModifiedMs: number }>> {
  const out: Array<{ key: string; size: number; lastModifiedMs: number }> = [];
  let token: string | null = null;
  do {
    const query = new URLSearchParams({ "list-type": "2", prefix });
    if (token) query.set("continuation-token", token);
    const response = await config().client.fetch(`${config().bucketUrl}?${query}`, { method: "GET" });
    if (!response.ok) throw await failure(response, `listing of ${prefix}`);
    const xml = await response.text();
    for (const block of xml.match(/<Contents>[\s\S]*?<\/Contents>/g) ?? []) {
      const key = decodeXml(block.match(/<Key>([^<]*)<\/Key>/)?.[1] ?? "");
      const modified = Date.parse(block.match(/<LastModified>([^<]*)<\/LastModified>/)?.[1] ?? "");
      const size = Number(block.match(/<Size>(\d+)<\/Size>/)?.[1] ?? 0);
      if (key) out.push({ key, size, lastModifiedMs: Number.isFinite(modified) ? modified : 0 });
    }
    token = /<IsTruncated>true<\/IsTruncated>/.test(xml)
      ? decodeXml(xml.match(/<NextContinuationToken>([^<]*)<\/NextContinuationToken>/)?.[1] ?? "") || null
      : null;
  } while (token);
  return out;
}

/** A time-limited URL that reads `path` with no other credential. */
export async function presignGet(path: string, expiresSeconds: number): Promise<string> {
  const url = new URL(objectUrl(path));
  url.searchParams.set("X-Amz-Expires", String(Math.round(expiresSeconds)));
  const signed = await config().client.sign(url.toString(), { method: "GET", aws: { signQuery: true } });
  return signed.url;
}

/**
 * A time-limited URL that writes one whole file to `path`. The render sandbox
 * uses it to store a preview copy it made, without holding any credential.
 */
export async function presignPut(path: string, expiresSeconds: number): Promise<string> {
  const url = new URL(objectUrl(path));
  url.searchParams.set("X-Amz-Expires", String(Math.round(expiresSeconds)));
  const signed = await config().client.sign(url.toString(), { method: "PUT", aws: { signQuery: true } });
  return signed.url;
}

// ── Multipart: how a browser sends a file of any size straight to B2 ──

export async function createMultipartUpload(path: string, contentType: string): Promise<string> {
  const response = await sendWithBody(objectUrl(path, "?uploads"), "POST", "", { "Content-Type": contentType });
  if (!response.ok) throw await failure(response, "starting the upload");
  const uploadId = (await response.text()).match(/<UploadId>([^<]*)<\/UploadId>/)?.[1];
  if (!uploadId) throw new Error("Storage did not return an upload id");
  return decodeXml(uploadId);
}

/** A URL the browser can PUT one part to, with no credential of its own. */
export async function presignUploadPart(path: string, uploadId: string, partNumber: number, expiresSeconds: number): Promise<string> {
  const url = new URL(objectUrl(path));
  url.searchParams.set("partNumber", String(partNumber));
  url.searchParams.set("uploadId", uploadId);
  url.searchParams.set("X-Amz-Expires", String(Math.round(expiresSeconds)));
  const signed = await config().client.sign(url.toString(), { method: "PUT", aws: { signQuery: true } });
  return signed.url;
}

/**
 * The parts B2 actually holds. Completing from this list, rather than from
 * ETags the browser reports, means the bucket's CORS rule never has to expose
 * response headers - the one thing B2's dashboard presets do not set.
 */
async function listParts(path: string, uploadId: string): Promise<Array<{ partNumber: number; etag: string }>> {
  const parts: Array<{ partNumber: number; etag: string }> = [];
  let marker = 0;
  for (;;) {
    const query = new URLSearchParams({ uploadId, "max-parts": "1000" });
    if (marker) query.set("part-number-marker", String(marker));
    const response = await config().client.fetch(objectUrl(path, `?${query}`), { method: "GET" });
    if (!response.ok) throw await failure(response, "checking the uploaded parts");
    const xml = await response.text();
    for (const block of xml.match(/<Part>[\s\S]*?<\/Part>/g) ?? []) {
      const partNumber = Number(block.match(/<PartNumber>(\d+)<\/PartNumber>/)?.[1]);
      const etag = decodeXml(block.match(/<ETag>([^<]*)<\/ETag>/)?.[1] ?? "");
      if (partNumber && etag) parts.push({ partNumber, etag });
    }
    if (!/<IsTruncated>true<\/IsTruncated>/.test(xml)) break;
    marker = Number(xml.match(/<NextPartNumberMarker>(\d+)<\/NextPartNumberMarker>/)?.[1]) || 0;
    if (!marker) break;
  }
  return parts.sort((a, b) => a.partNumber - b.partNumber);
}

/** Joins the uploaded parts into one file; refuses if any expected part is missing. */
export async function completeMultipartUpload(path: string, uploadId: string, expectedParts: number): Promise<void> {
  const parts = await listParts(path, uploadId);
  if (parts.length !== expectedParts || parts.some((part, index) => part.partNumber !== index + 1)) {
    throw new Error(`The upload is incomplete: ${parts.length} of ${expectedParts} parts arrived`);
  }
  const body =
    "<CompleteMultipartUpload>" +
    parts.map((part) => `<Part><PartNumber>${part.partNumber}</PartNumber><ETag>${escapeXml(part.etag)}</ETag></Part>`).join("") +
    "</CompleteMultipartUpload>";
  const response = await sendWithBody(objectUrl(path, `?uploadId=${encodeURIComponent(uploadId)}`), "POST", body, {
    "Content-Type": "application/xml",
  });
  const text = await response.text();
  // S3 can answer 200 with an <Error> body when completion fails late.
  if (!response.ok || /<Error>/.test(text)) {
    throw new Error(`Storage could not finish the upload: ${text.match(/<Message>([^<]*)<\/Message>/)?.[1] ?? response.status}`);
  }
}

export async function abortMultipartUpload(path: string, uploadId: string): Promise<void> {
  await config().client.fetch(objectUrl(path, `?uploadId=${encodeURIComponent(uploadId)}`), { method: "DELETE" }).catch(() => undefined);
}

function decodeXml(value: string): string {
  return value
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&amp;/g, "&");
}

function escapeXml(value: string): string {
  return value.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}
