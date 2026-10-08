import { execFileSync } from "node:child_process";
import { rm } from "node:fs/promises";
import { resolve } from "node:path";
import { AwsClient } from "aws4fetch";
import { addBundleToSandbox, createSandbox, renderMediaOnVercel } from "@remotion/vercel";
import {
  CREATIVE_RENDERER_FINGERPRINT_KIND,
  fingerprintCreativeRendererSource,
} from "./creative-render-source-fingerprint.mjs";
import {
  CREATIVE_SNAPSHOT_EXPIRATION_MS,
  chooseReusableCreativeSnapshot,
} from "./creative-render-snapshot-policy.mjs";

const isVercel = Boolean(process.env.VERCEL);
if (!isVercel) {
  console.log("[creative-render] local build: skipping Vercel Sandbox snapshot");
  process.exit(0);
}

const deploymentId = process.env.VERCEL_DEPLOYMENT_ID;
if (!deploymentId) throw new Error("VERCEL_DEPLOYMENT_ID is required for creative render snapshots");

// Snapshot metadata lives in the same B2 bucket as every stored file, under
// a system prefix outside all user folders. lib/creative/render.ts reads it.
const keyId = process.env.B2_KEY_ID?.trim();
const applicationKey = process.env.B2_APPLICATION_KEY?.trim();
const bucket = process.env.B2_BUCKET?.trim();
const endpoint = process.env.B2_ENDPOINT?.trim().replace(/^https?:\/\//, "").replace(/\/+$/, "");
if (!keyId || !applicationKey || !bucket || !endpoint) {
  throw new Error("B2 credentials are required for creative render snapshot metadata");
}

const PREFIX = "_system/render-snapshots/";
const currentKey = `${PREFIX}${deploymentId}.json`;
const bundleDir = resolve(process.cwd(), ".remotion-creative");

const b2 = new AwsClient({
  accessKeyId: keyId,
  secretAccessKey: applicationKey,
  service: "s3",
  region: endpoint.match(/^s3\.([a-z0-9-]+)\.backblazeb2\.com$/i)?.[1] ?? "us-east-1",
});
const bucketUrl = `https://${endpoint}/${encodeURIComponent(bucket)}`;
const objectUrl = (key) => `${bucketUrl}/${key.split("/").map(encodeURIComponent).join("/")}`;

async function readMetadata(key, lastModifiedMs = 0) {
  const response = await b2.fetch(objectUrl(key));
  if (!response.ok) return null;
  const parsed = JSON.parse(await response.text());
  if (!parsed || typeof parsed !== "object") return null;

  return {
    ...parsed,
    key,
    lastModifiedMs,
  };
}

async function listSnapshotMetadata() {
  const records = [];
  const response = await b2.fetch(`${bucketUrl}?${new URLSearchParams({ "list-type": "2", prefix: PREFIX })}`);
  if (!response.ok) {
    throw new Error(`Could not list creative render snapshot metadata (${response.status}): ${(await response.text()).slice(0, 300)}`);
  }
  const xml = await response.text();

  for (const block of xml.match(/<Contents>[\s\S]*?<\/Contents>/g) ?? []) {
    const key = block.match(/<Key>([^<]*)<\/Key>/)?.[1];
    if (!key || key === currentKey || !key.endsWith(".json")) continue;
    const modified = Date.parse(block.match(/<LastModified>([^<]*)<\/LastModified>/)?.[1] ?? "");

    try {
      const record = await readMetadata(key, Number.isFinite(modified) ? modified : 0);
      if (record) records.push(record);
    } catch (error) {
      console.warn(`[creative-render] ignoring unreadable snapshot metadata ${key}`, error);
    }
  }

  return records;
}

async function writeDeploymentMetadata(metadata) {
  const response = await b2.fetch(objectUrl(currentKey), {
    method: "PUT",
    headers: { "Content-Type": "application/json", "Cache-Control": "no-store" },
    body: JSON.stringify(metadata),
  });
  if (!response.ok) {
    throw new Error(`Could not write creative render snapshot metadata (${response.status}): ${(await response.text()).slice(0, 300)}`);
  }
}

const fingerprint = await fingerprintCreativeRendererSource(process.cwd());
console.log(
  `[creative-render] renderer source fingerprint ${fingerprint.slice(0, 12)} (${CREATIVE_RENDERER_FINGERPRINT_KIND})`,
);

const existingMetadata = await listSnapshotMetadata();
const reusable = chooseReusableCreativeSnapshot(
  existingMetadata,
  fingerprint,
  Date.now(),
  CREATIVE_RENDERER_FINGERPRINT_KIND,
);

if (reusable) {
  const now = new Date().toISOString();
  await writeDeploymentMetadata({
    snapshotId: reusable.snapshotId,
    deploymentId,
    createdAt: now,
    bundleFingerprint: fingerprint,
    fingerprintKind: CREATIVE_RENDERER_FINGERPRINT_KIND,
    reusedFromDeploymentId: reusable.deploymentId ?? null,
    reusedFromKey: reusable.key ?? null,
    reuseReason: reusable.reuseReason,
    smokeMp4Bytes: reusable.smokeMp4Bytes ?? null,
  });

  console.log(
    `[creative-render] reusing snapshot ${reusable.snapshotId} (${reusable.reuseReason}); no Sandbox snapshot allocation`,
  );
  process.exit(0);
}

await rm(bundleDir, { recursive: true, force: true });

try {
  console.log("[creative-render] renderer source changed; bundling CreativeDocument composition");
  execFileSync(
    resolve(process.cwd(), "node_modules/.bin/remotion"),
    ["bundle", "remotion/index.ts", "--out-dir", bundleDir],
    { cwd: process.cwd(), stdio: "inherit" },
  );

  console.log("[creative-render] no compatible reusable snapshot; creating Vercel Sandbox");
  const sandbox = await createSandbox({
    onProgress: ({ progress, message }) => {
      console.log(`[creative-render] ${message} ${Math.round(progress * 100)}%`);
    },
  });

  // @remotion/vercel creates nested bundle directories with non-recursive mkdir.
  // Newer Vercel Sandbox SDKs require the bundle root to exist first.
  await sandbox.fs.mkdir("remotion-bundle", { recursive: true });
  await addBundleToSandbox({ sandbox, bundleDir });

  console.log("[creative-render] smoke rendering first two frames");
  const smoke = await renderMediaOnVercel({
    sandbox,
    compositionId: "StudioCreative",
    inputProps: {},
    codec: "h264",
    frameRange: [0, 1],
    outputFile: "/tmp/creative-smoke.mp4",
    timeoutInMilliseconds: 120_000,
  });
  const smokeStat = await sandbox.fs.stat(smoke.sandboxFilePath);
  if (!smokeStat || smokeStat.size <= 0) {
    throw new Error("Creative renderer smoke test produced an empty MP4");
  }
  console.log(`[creative-render] smoke MP4 OK (${smokeStat.size} bytes)`);

  console.log("[creative-render] snapshotting renderer");
  const snapshot = await sandbox.snapshot({
    expiration: CREATIVE_SNAPSHOT_EXPIRATION_MS,
  });
  const now = new Date().toISOString();

  await writeDeploymentMetadata({
    snapshotId: snapshot.snapshotId,
    deploymentId,
    createdAt: now,
    bundleFingerprint: fingerprint,
    fingerprintKind: CREATIVE_RENDERER_FINGERPRINT_KIND,
    smokeMp4Bytes: smokeStat.size,
    snapshotExpirationMs: CREATIVE_SNAPSHOT_EXPIRATION_MS,
  });

  console.log(`[creative-render] snapshot ready: ${snapshot.snapshotId}`);
} finally {
  await rm(bundleDir, { recursive: true, force: true });
}
