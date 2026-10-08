/**
 * Gets a render's media into the sandbox once, instead of once per frame.
 *
 * Every still is its own renderer process, and Remotion's video element
 * downloads the whole source file before it can extract a frame. A twelve-
 * frame contact sheet of a 159 MB phone recording therefore pulled 1.9 GB out
 * of storage - and the storage plan's free download allowance is 1 GB a day.
 *
 * Two things fix that:
 *   - every asset is downloaded into the bundle's static folder once per
 *     sandbox, and the composition reads that local copy (see
 *     SANDBOX_LOCAL_ASSET_PREFIX);
 *   - previews of a large video read a small stored copy of it (720p, about a
 *     tenth of the size). The first preview that needs one makes it in the
 *     sandbox with the renderer's own ffmpeg, uploads it - uploads are free -
 *     and records it on the asset, so every later preview and the editor's
 *     playback use it. The final MP4 always reads the original.
 */

import { SANDBOX_LOCAL_ASSET_PREFIX, type CreativeRemotionAssetMap } from "./remotion";

/** Videos at least this large get a preview copy. Smaller ones are cheap enough as they are. */
export const PREVIEW_COPY_MIN_BYTES = 25 * 1024 * 1024;

/** Longest edge of a preview copy: frames are shown to the assistant at 1568 px at most. */
export const PREVIEW_COPY_MAX_EDGE = 1280;

/** Where downloads land, relative to the sandbox working directory. Served as /public/_media/. */
const LOCAL_DIR = "remotion-bundle/public/_media";

export interface SandboxMediaJob {
  /** Every asset id this download serves (two rows can share one file). */
  assetIds: string[];
  /** What to download: the original, or its preview copy when there is one. */
  sourceUrl: string;
  /** File name inside LOCAL_DIR. */
  file: string;
  /** Set when this download should be turned into a preview copy for this asset. */
  makePreviewFor: string | null;
}

export interface SandboxMediaOptions {
  /** Read preview copies, and make missing ones. False for the final render. */
  usePreviews: boolean;
  /** Whether new preview copies can be stored (needs the owner). */
  canMakePreviews: boolean;
}

function extensionFor(url: string, mimeType: string | null | undefined): string {
  const fromPath = (() => {
    try {
      return new URL(url).pathname.match(/\.([a-z0-9]{1,5})$/i)?.[1];
    } catch {
      return undefined;
    }
  })();
  if (fromPath) return fromPath.toLowerCase();
  const fromMime = mimeType?.split("/")[1]?.replace(/[^a-z0-9]/gi, "").slice(0, 5);
  return fromMime || "bin";
}

function isVideo(asset: CreativeRemotionAssetMap[string]): boolean {
  return asset.kind === "video" || Boolean(asset.mimeType?.startsWith("video/"));
}

/** Decides what each asset downloads, deduplicated by source. Pure, so it is tested directly. */
export function planSandboxMedia(assets: CreativeRemotionAssetMap, options: SandboxMediaOptions): SandboxMediaJob[] {
  const jobs = new Map<string, SandboxMediaJob>();
  for (const [assetId, asset] of Object.entries(assets)) {
    if (!/^https?:\/\//i.test(asset.url)) continue;
    let sourceUrl = asset.url;
    let makePreviewFor: string | null = null;
    if (options.usePreviews && isVideo(asset)) {
      if (asset.previewUrl) {
        sourceUrl = asset.previewUrl;
      } else if (options.canMakePreviews && (asset.sizeBytes ?? Number.POSITIVE_INFINITY) >= PREVIEW_COPY_MIN_BYTES) {
        makePreviewFor = assetId;
      }
    }
    const existing = jobs.get(sourceUrl);
    if (existing) {
      existing.assetIds.push(assetId);
      continue;
    }
    const index = jobs.size;
    const ext = makePreviewFor || sourceUrl === asset.previewUrl ? "mp4" : extensionFor(sourceUrl, asset.mimeType);
    jobs.set(sourceUrl, { assetIds: [assetId], sourceUrl, file: `${index}.${ext}`, makePreviewFor });
  }
  return [...jobs.values()];
}

/** The asset map with every successfully copied asset pointed at its local file. */
export function localizeAssetMap(
  assets: CreativeRemotionAssetMap,
  jobs: SandboxMediaJob[],
  copied: Set<string>,
): CreativeRemotionAssetMap {
  const local = new Map<string, string>();
  for (const job of jobs) {
    if (!copied.has(job.file)) continue;
    for (const assetId of job.assetIds) local.set(assetId, `${SANDBOX_LOCAL_ASSET_PREFIX}_media/${job.file}`);
  }
  return Object.fromEntries(
    Object.entries(assets).map(([id, asset]) => [id, local.has(id) ? { ...asset, url: local.get(id)! } : asset]),
  );
}

/** The slice of a Vercel Sandbox this needs; keeps it testable. */
export interface SandboxRunner {
  runCommand(params: { cmd: string; args?: string[]; env?: Record<string, string> }): Promise<{
    exitCode: number;
    stdout(): Promise<string>;
    stderr(): Promise<string>;
  }>;
}

export interface PreviewCopyStore {
  /** A URL the sandbox can PUT the finished copy to, and where it will then be served from. */
  target(assetId: string): Promise<{ putUrl: string; url: string }>;
  /** Records the stored copy on the asset. */
  save(assetId: string, url: string, sizeBytes: number): Promise<void>;
}

export interface LocalizeMediaInput {
  sandbox: SandboxRunner;
  assets: CreativeRemotionAssetMap;
  options: SandboxMediaOptions;
  /** Turns a stored URL into one the sandbox can download without credentials. */
  downloadUrl(url: string): Promise<string>;
  previews?: PreviewCopyStore;
}

// Every value reaches the scripts through the environment, never the command
// line, so no URL or file name is ever parsed by the shell.
const DOWNLOAD_SCRIPT = `set -euo pipefail
mkdir -p "$(dirname "$DEST")"
curl -sS --fail -L --retry 2 -o "$DEST.part" "$SRC"
mv "$DEST.part" "$DEST"`;

const PREVIEW_SCRIPT = `set -uo pipefail
mkdir -p "$(dirname "$DEST")" /tmp/studio-media
SRC_FILE="/tmp/studio-media/$(basename "$DEST").src"
curl -sS --fail -L --retry 2 -o "$SRC_FILE" "$SRC" || exit 1
FFMPEG="$(readlink -f node_modules/@remotion/compositor-linux-x64-gnu)/ffmpeg"
if "$FFMPEG" -y -hide_banner -loglevel error -i "$SRC_FILE" \\
    -vf "scale='if(gt(iw,ih),min($EDGE,iw),-2)':'if(gt(iw,ih),-2,min($EDGE,ih))'" \\
    -c:v libx264 -preset veryfast -crf 28 -pix_fmt yuv420p \\
    -c:a aac -b:a 96k -movflags +faststart "$DEST.part.mp4" \\
  && mv "$DEST.part.mp4" "$DEST"; then
  rm -f "$SRC_FILE"
  if curl -sS --fail -o /dev/null -X PUT -H "Content-Type: video/mp4" --upload-file "$DEST" "$PUT"; then
    echo "PREVIEW_STORED $(stat -c %s "$DEST")"
  fi
else
  # No copy: render this batch from the original, downloaded once.
  rm -f "$DEST.part.mp4"
  mv "$SRC_FILE" "$DEST"
  echo "PREVIEW_FAILED"
fi`;

async function mapLimit<T>(items: T[], limit: number, worker: (item: T) => Promise<void>): Promise<void> {
  const queue = [...items];
  await Promise.all(
    Array.from({ length: Math.min(limit, queue.length) }, async () => {
      for (let item = queue.shift(); item; item = queue.shift()) await worker(item);
    }),
  );
}

/**
 * Copies every asset into the sandbox and returns the asset map to render
 * with. Best-effort per asset: one that cannot be copied keeps its remote URL
 * and renders exactly as it did before, so this can only ever save downloads.
 */
export async function localizeSandboxMedia(input: LocalizeMediaInput): Promise<CreativeRemotionAssetMap> {
  const jobs = planSandboxMedia(input.assets, {
    usePreviews: input.options.usePreviews,
    canMakePreviews: input.options.canMakePreviews && Boolean(input.previews),
  });
  const copied = new Set<string>();

  await mapLimit(jobs, 3, async (job) => {
    try {
      const dest = `${LOCAL_DIR}/${job.file}`;
      const src = await input.downloadUrl(job.sourceUrl);
      if (job.makePreviewFor && input.previews) {
        const target = await input.previews.target(job.makePreviewFor);
        const result = await input.sandbox.runCommand({
          cmd: "bash",
          args: ["-c", PREVIEW_SCRIPT],
          env: { SRC: src, DEST: dest, PUT: target.putUrl, EDGE: String(PREVIEW_COPY_MAX_EDGE) },
        });
        if (result.exitCode !== 0) {
          console.warn(`[sandbox-media] could not fetch ${job.assetIds[0]}: ${(await result.stderr()).slice(0, 300)}`);
          return;
        }
        copied.add(job.file);
        const stored = (await result.stdout()).match(/PREVIEW_STORED (\d+)/);
        if (stored) await input.previews.save(job.makePreviewFor, target.url, Number(stored[1]));
        return;
      }
      const result = await input.sandbox.runCommand({ cmd: "bash", args: ["-c", DOWNLOAD_SCRIPT], env: { SRC: src, DEST: dest } });
      if (result.exitCode === 0) copied.add(job.file);
      else console.warn(`[sandbox-media] could not fetch ${job.assetIds[0]}: ${(await result.stderr()).slice(0, 300)}`);
    } catch (error) {
      console.warn(`[sandbox-media] could not fetch ${job.assetIds[0]}: ${error instanceof Error ? error.message : error}`);
    }
  });

  return localizeAssetMap(input.assets, jobs, copied);
}
