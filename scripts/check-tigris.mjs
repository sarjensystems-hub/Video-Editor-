// Build-time check that the Tigris bucket supports everything the app does
// with storage, run before the app is switched over to it. It prints one line
// per check to the build log and never fails the build; secrets are never
// printed. Remove once the switch is done.

import { AwsClient } from "aws4fetch";

const accessKeyId = process.env.TIGRIS_ACCESS_KEY_ID?.trim();
const secretAccessKey = process.env.TIGRIS_SECRET_ACCESS_KEY?.trim();
const bucket = process.env.TIGRIS_BUCKET?.trim();
const endpointHost = (process.env.TIGRIS_ENDPOINT?.trim() || "https://t3.storage.dev").replace(/^https?:\/\//, "").replace(/\/+$/, "");

const log = (name, ok, detail = "") => console.log(`[tigris-check] ${ok ? "PASS" : "FAIL"} ${name}${detail ? ` - ${detail}` : ""}`);

if (!process.env.VERCEL) {
  console.log("[tigris-check] local build: skipped");
  process.exit(0);
}
if (!accessKeyId || !secretAccessKey || !bucket) {
  console.log(`[tigris-check] not configured: key=${Boolean(accessKeyId)} secret=${Boolean(secretAccessKey)} bucket=${Boolean(bucket)}`);
  process.exit(0);
}
console.log(`[tigris-check] bucket name length ${bucket.length}, endpoint ${endpointHost}`);

const client = new AwsClient({ accessKeyId, secretAccessKey, service: "s3", region: "auto" });
const ORIGINS = [
  "https://video-editor-sarjen1.vercel.app",
  "https://video-editor-three-beige.vercel.app",
  "https://video-editor-git-main-sarjen1.vercel.app",
];

async function put(url, body, headers = {}) {
  const bytes = typeof body === "string" ? new TextEncoder().encode(body) : body;
  const signed = await client.sign(url, { method: "PUT", headers: { ...headers, "Content-Length": String(bytes.byteLength) } });
  return fetch(signed.url, { method: "PUT", headers: signed.headers, body: bytes });
}

async function messageOf(response) {
  const text = await response.text().catch(() => "");
  return `${response.status} ${(text.match(/<Code>([^<]*)<\/Code>/)?.[1] ?? "")} ${(text.match(/<Message>([^<]*)<\/Message>/)?.[1] ?? text.slice(0, 160)).trim()}`;
}

async function runStyle(style, base) {
  console.log(`[tigris-check] --- ${style} addressing ---`);
  const key = `_system/tigris-check/${Date.now()}-${style}.txt`;
  const objectUrl = `${base}/${key}`;
  let working = true;

  try {
    const r = await put(objectUrl, "hello from the studio", { "Content-Type": "text/plain" });
    log(`${style}: server upload (PUT)`, r.ok, r.ok ? "" : await messageOf(r));
    if (!r.ok) return false;

    const head = await client.fetch(objectUrl, { method: "HEAD" });
    log(`${style}: HEAD`, head.ok, `${head.status} length=${head.headers.get("content-length")}`);
    working &&= head.ok;

    const get = await client.fetch(objectUrl, { method: "GET" });
    const getText = get.ok ? await get.text() : await messageOf(get);
    log(`${style}: GET`, get.ok && getText === "hello from the studio", get.ok ? "" : getText);
    working &&= get.ok;

    const range = await client.fetch(objectUrl, { method: "GET", headers: { Range: "bytes=0-4" } });
    const rangeText = await range.text();
    log(`${style}: ranged GET (video seeking)`, range.status === 206 && rangeText === "hello", `${range.status} "${rangeText}"`);

    const presignedGet = new URL(objectUrl);
    presignedGet.searchParams.set("X-Amz-Expires", "600");
    const signedGet = await client.sign(presignedGet.toString(), { method: "GET", aws: { signQuery: true } });
    const pg = await fetch(signedGet.url);
    log(`${style}: signed download link`, pg.ok, pg.ok ? "" : await messageOf(pg));
    working &&= pg.ok;

    const presignedPut = new URL(`${base}/${key}.put`);
    presignedPut.searchParams.set("X-Amz-Expires", "600");
    const signedPut = await client.sign(presignedPut.toString(), { method: "PUT", aws: { signQuery: true } });
    const pp = await fetch(signedPut.url, { method: "PUT", body: new TextEncoder().encode("signed put"), headers: { "Content-Type": "text/plain" } });
    log(`${style}: signed upload link (browser-style PUT)`, pp.ok, pp.ok ? "" : await messageOf(pp));
    working &&= pp.ok;

    // Multipart, exactly as the browser uploader drives it.
    const mpKey = `${key}.multipart`;
    const createSigned = await client.sign(`${base}/${mpKey}?uploads`, { method: "POST", headers: { "Content-Type": "text/plain", "Content-Length": "0" } });
    const create = await fetch(createSigned.url, { method: "POST", headers: createSigned.headers, body: new Uint8Array(0) });
    const createText = await create.text();
    const uploadId = createText.match(/<UploadId>([^<]*)<\/UploadId>/)?.[1];
    log(`${style}: start multipart upload`, Boolean(uploadId), uploadId ? "" : `${create.status} ${createText.slice(0, 160)}`);
    if (uploadId) {
      const partUrl = new URL(`${base}/${mpKey}`);
      partUrl.searchParams.set("partNumber", "1");
      partUrl.searchParams.set("uploadId", uploadId);
      partUrl.searchParams.set("X-Amz-Expires", "600");
      const signedPart = await client.sign(partUrl.toString(), { method: "PUT", aws: { signQuery: true } });
      const part = await fetch(signedPart.url, { method: "PUT", body: new TextEncoder().encode("part one") });
      log(`${style}: upload part via signed link`, part.ok, part.ok ? "" : await messageOf(part));

      const list = await client.fetch(`${base}/${mpKey}?uploadId=${encodeURIComponent(uploadId)}`, { method: "GET" });
      const listText = await list.text();
      const etag = listText.match(/<ETag>([^<]*)<\/ETag>/)?.[1];
      log(`${style}: list uploaded parts`, list.ok && Boolean(etag), list.ok ? "" : listText.slice(0, 160));

      if (etag) {
        const body = `<CompleteMultipartUpload><Part><PartNumber>1</PartNumber><ETag>${etag}</ETag></Part></CompleteMultipartUpload>`;
        const bytes = new TextEncoder().encode(body);
        const signedDone = await client.sign(`${base}/${mpKey}?uploadId=${encodeURIComponent(uploadId)}`, {
          method: "POST",
          headers: { "Content-Type": "application/xml", "Content-Length": String(bytes.byteLength) },
        });
        const done = await fetch(signedDone.url, { method: "POST", headers: signedDone.headers, body: bytes });
        const doneText = await done.text();
        log(`${style}: finish multipart upload`, done.ok && !/<Error>/.test(doneText), done.ok ? "" : doneText.slice(0, 160));
      }
    }

    const listing = await client.fetch(`${base}?${new URLSearchParams({ "list-type": "2", prefix: "_system/tigris-check/" })}`, { method: "GET" });
    const listingText = await listing.text();
    const keys = listingText.match(/<Key>[^<]*<\/Key>/g)?.length ?? 0;
    log(`${style}: list folder`, listing.ok && keys > 0, `${listing.status} ${keys} object(s)`);
    working &&= listing.ok;

    // CORS as the browser sees it: a preflight for a PUT from each app address.
    for (const origin of ORIGINS) {
      const preflight = await fetch(signedPut.url, {
        method: "OPTIONS",
        headers: { Origin: origin, "Access-Control-Request-Method": "PUT", "Access-Control-Request-Headers": "content-type" },
      });
      const allowOrigin = preflight.headers.get("access-control-allow-origin");
      const allowMethods = preflight.headers.get("access-control-allow-methods") ?? "";
      log(
        `${style}: browser upload allowed from ${origin.replace("https://", "")}`,
        preflight.ok && (allowOrigin === origin || allowOrigin === "*") && /PUT/i.test(allowMethods),
        `${preflight.status} allow-origin=${allowOrigin ?? "none"} methods=${allowMethods || "none"}`,
      );
    }

    const cors = await client.fetch(`${base}?cors`, { method: "GET" });
    const corsText = await cors.text();
    log(`${style}: read bucket CORS rules`, cors.ok, cors.ok ? `${(corsText.match(/<CORSRule>/g) ?? []).length} rule(s)` : corsText.slice(0, 200));

    for (const k of [key, `${key}.put`, `${key}.multipart`]) {
      const del = await client.fetch(`${base}/${k}`, { method: "DELETE" });
      if (!del.ok) log(`${style}: delete ${k}`, false, String(del.status));
    }
    log(`${style}: clean up`, true);
    return working;
  } catch (error) {
    log(`${style}: unexpected error`, false, error instanceof Error ? error.message : String(error));
    return false;
  }
}

const pathOk = await runStyle("path-style", `https://${endpointHost}/${encodeURIComponent(bucket)}`);
const hostOk = await runStyle("virtual-host", `https://${bucket}.${endpointHost}`);
console.log(`[tigris-check] RESULT path-style=${pathOk ? "works" : "fails"} virtual-host=${hostOk ? "works" : "fails"}`);
process.exit(0);
