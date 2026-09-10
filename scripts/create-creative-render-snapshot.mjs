import { execFileSync } from "node:child_process";
import { rm } from "node:fs/promises";
import { resolve } from "node:path";
import { createClient } from "@supabase/supabase-js";
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

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!supabaseUrl || !serviceRoleKey) {
  throw new Error("Supabase credentials are required for creative render snapshot metadata");
}

const BUCKET = "creative-render-snapshots";
const currentKey = `${deploymentId}.json`;
const bundleDir = resolve(process.cwd(), ".remotion-creative");

const supabase = createClient(supabaseUrl, serviceRoleKey, {
  auth: { persistSession: false, autoRefreshToken: false },
});

async function readMetadata(key, lastModifiedMs = 0) {
  const { data, error } = await supabase.storage.from(BUCKET).download(key);
  if (error || !data) return null;

  const text = await data.text();
  const parsed = JSON.parse(text);
  if (!parsed || typeof parsed !== "object") return null;

  return {
    ...parsed,
    key,
    lastModifiedMs,
  };
}

async function listSnapshotMetadata() {
  const records = [];
  const { data: objects, error } = await supabase.storage.from(BUCKET).list();
  if (error) throw new Error(`Could not list creative render snapshot metadata: ${error.message}`);

  for (const object of objects ?? []) {
    const key = object.name;
    if (!key || key === currentKey || !key.endsWith(".json")) continue;

    try {
      const record = await readMetadata(
        key,
        object.updated_at ? new Date(object.updated_at).getTime() : 0,
      );
      if (record) records.push(record);
    } catch (error) {
      console.warn(`[creative-render] ignoring unreadable snapshot metadata ${key}`, error);
    }
  }

  return records;
}

async function writeDeploymentMetadata(metadata) {
  const { error } = await supabase.storage.from(BUCKET).upload(
    currentKey,
    JSON.stringify(metadata),
    { contentType: "application/json", cacheControl: "0", upsert: true },
  );
  if (error) throw new Error(`Could not write creative render snapshot metadata: ${error.message}`);
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
