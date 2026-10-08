/**
 * Backblaze B2 through its S3-compatible API: the one place every stored
 * file lives. Supabase keeps the database and sign-in; files left it because
 * its free plan refuses anything over 50 MB, which is most video.
 *
 * The bucket is private. Nothing outside this module ever sees a B2 URL that
 * lasts: files are addressed as `/media/<path>` on the app's own domain
 * (lib/media-url.ts), and that route hands out a short-lived signed URL.
 *
 * Requests are signed with aws4fetch (SigV4) rather than the AWS SDK, which
 * would add megabytes to every function for six calls.
 */

import { AwsClient } from "aws4fetch";

interface B2Config {
  client: AwsClient;
  /** `https://s3.<region>.backblazeb2.com/<bucket>`, path-style. */
  bucketUrl: string;
}

let cached: B2Config | null = null;

function config(): B2Config {
  if (cached) return cached;
  const keyId = process.env.B2_KEY_ID?.trim();
  const applicationKey = process.env.B2_APPLICATION_KEY?.trim();
  const bucket = process.env.B2_BUCKET?.trim();
  const endpoint = process.env.B2_ENDPOINT?.trim().replace(/^https?:\/\//, "").replace(/\/+$/, "");
  if (!keyId || !applicationKey || !bucket || !endpoint) {
    throw new Error("File storage is not configured: set B2_KEY_ID, B2_APPLICATION_KEY, B2_BUCKET and B2_ENDPOINT");
  }
  // s3.us-east-005.backblazeb2.com -> us-east-005
  const region = endpoint.match(/^s3\.([a-z0-9-]+)\.backblazeb2\.com$/i)?.[1] ?? "us-east-1";
  cached = {
    client: new AwsClient({ accessKeyId: keyId, secretAccessKey: applicationKey, service: "s3", region }),
    bucketUrl: `https://${endpoint}/${encodeURIComponent(bucket)}`,
  };
  return cached;
}

/** Whether storage is configured at all; lets tests and local builds say so plainly. */
export function isB2Configured(): boolean {
  return Boolean(process.env.B2_KEY_ID && process.env.B2_APPLICATION_KEY && process.env.B2_BUCKET && process.env.B2_ENDPOINT);
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
  return new Error(`B2 ${action} failed (${response.status}): ${message}`);
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
  if (!response.ok) throw new Error(`B2 head of ${path} failed (${response.status})`);
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
  if (!uploadId) throw new Error("B2 did not return an upload id");
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
    throw new Error(`B2 could not finish the upload: ${text.match(/<Message>([^<]*)<\/Message>/)?.[1] ?? response.status}`);
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
