// Copies every stored file from Backblaze B2 to Tigris, at build time.
//
// Stored URLs are /media/<path> on the app's own domain, so a file copied to
// the same key in Tigris needs no database change. Safe to run on every
// deploy: a file already in Tigris at the same size is skipped. Never fails
// the build. Remove once a run reports nothing left to copy.

import { AwsClient } from "aws4fetch";

const log = (message) => console.log(`[migrate-b2] ${message}`);
const env = (name) => process.env[name]?.trim() || "";

if (!process.env.VERCEL) {
  log("local build: skipped");
  process.exit(0);
}
if (!env("B2_KEY_ID") || !env("B2_APPLICATION_KEY") || !env("B2_BUCKET") || !env("B2_ENDPOINT")) {
  log("no Backblaze settings: nothing to copy from");
  process.exit(0);
}
if (!env("TIGRIS_ACCESS_KEY_ID") || !env("TIGRIS_SECRET_ACCESS_KEY") || !env("TIGRIS_BUCKET")) {
  log("no Tigris settings: nothing to copy to");
  process.exit(0);
}

const stripHost = (value) => value.replace(/^https?:\/\//, "").replace(/\/+$/, "");
const b2Endpoint = stripHost(env("B2_ENDPOINT"));
const b2 = new AwsClient({
  accessKeyId: env("B2_KEY_ID"),
  secretAccessKey: env("B2_APPLICATION_KEY"),
  service: "s3",
  region: b2Endpoint.match(/^s3\.([a-z0-9-]+)\.backblazeb2\.com$/i)?.[1] ?? "us-east-1",
});
const b2Bucket = `https://${b2Endpoint}/${encodeURIComponent(env("B2_BUCKET"))}`;
const tigris = new AwsClient({
  accessKeyId: env("TIGRIS_ACCESS_KEY_ID"),
  secretAccessKey: env("TIGRIS_SECRET_ACCESS_KEY"),
  service: "s3",
  region: "auto",
});
const tigrisBucket = `https://${env("TIGRIS_BUCKET")}.${stripHost(env("TIGRIS_ENDPOINT") || "https://t3.storage.dev")}`;
const keyUrl = (base, key) => `${base}/${key.split("/").map(encodeURIComponent).join("/")}`;

const decode = (value) =>
  value.replace(/&quot;/g, '"').replace(/&apos;/g, "'").replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&amp;/g, "&");

async function listB2() {
  const objects = [];
  let token = null;
  do {
    const query = new URLSearchParams({ "list-type": "2" });
    if (token) query.set("continuation-token", token);
    const response = await b2.fetch(`${b2Bucket}?${query}`, { method: "GET" });
    const xml = await response.text();
    if (!response.ok) throw new Error(`listing Backblaze failed (${response.status}): ${xml.slice(0, 200)}`);
    for (const block of xml.match(/<Contents>[\s\S]*?<\/Contents>/g) ?? []) {
      const key = decode(block.match(/<Key>([^<]*)<\/Key>/)?.[1] ?? "");
      const size = Number(block.match(/<Size>(\d+)<\/Size>/)?.[1] ?? 0);
      if (key) objects.push({ key, size });
    }
    token = /<IsTruncated>true<\/IsTruncated>/.test(xml)
      ? decode(xml.match(/<NextContinuationToken>([^<]*)<\/NextContinuationToken>/)?.[1] ?? "") || null
      : null;
  } while (token);
  return objects;
}

try {
  // Render-snapshot metadata is per deployment and rebuilt on every deploy.
  const objects = (await listB2()).filter((object) => !object.key.startsWith("_system/"));
  const total = objects.reduce((sum, object) => sum + object.size, 0);
  log(`${objects.length} file(s) in Backblaze, ${(total / 1048576).toFixed(1)} MB`);

  let copied = 0;
  let skipped = 0;
  let failed = 0;
  for (const object of objects) {
    const head = await tigris.fetch(keyUrl(tigrisBucket, object.key), { method: "HEAD" });
    if (head.ok && Number(head.headers.get("content-length")) === object.size) {
      skipped += 1;
      continue;
    }
    const source = await b2.fetch(keyUrl(b2Bucket, object.key), { method: "GET" });
    if (!source.ok) {
      const text = await source.text().catch(() => "");
      failed += 1;
      log(`could not read ${object.key} from Backblaze (${source.status}): ${(text.match(/<Message>([^<]*)<\/Message>/)?.[1] ?? text.slice(0, 160)).trim()}`);
      // A spent download allowance refuses everything after it; stop here and
      // let the next deploy carry on.
      if (source.status === 403) break;
      continue;
    }
    const bytes = new Uint8Array(await source.arrayBuffer());
    const contentType = source.headers.get("content-type") || "application/octet-stream";
    const signed = await tigris.sign(keyUrl(tigrisBucket, object.key), {
      method: "PUT",
      headers: { "Content-Type": contentType, "Content-Length": String(bytes.byteLength) },
    });
    const put = await fetch(signed.url, { method: "PUT", headers: signed.headers, body: bytes });
    if (put.ok) {
      copied += 1;
    } else {
      failed += 1;
      log(`could not write ${object.key} to Tigris (${put.status})`);
    }
  }
  log(`done: ${copied} copied, ${skipped} already there, ${failed} failed, ${objects.length - copied - skipped - failed} not attempted`);
} catch (error) {
  log(`stopped: ${error instanceof Error ? error.message : String(error)}`);
}
process.exit(0);
