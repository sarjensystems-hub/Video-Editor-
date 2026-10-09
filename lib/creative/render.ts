import { Sandbox } from "@vercel/sandbox";
import { renderMediaOnVercel, renderStillOnVercel } from "@remotion/vercel";
import { uploadAnyBytes } from "../storage";
import { getObjectText, headObject, presignPut } from "../b2";
import { planContactSheetLayout, type ContactSheetLayout } from "./contact-sheet";
import { resolveCreativeFrameAtTime } from "./frame-time";
import { resolveCreativeRenderOptions, type CreativeRenderWindowOptions } from "./render-options";
import {
  CREATIVE_REMOTION_COMPOSITION_ID,
  type CreativeRemotionAssetMap,
} from "./remotion";
import { withFileBackedRemotionConfig } from "./remotion-sandbox-transport";
import { localizeSandboxMedia, type PreviewCopyStore } from "./sandbox-media";
import { sandboxDownloadUrl } from "./preview-copies";
import type { CreativeDocument } from "./schema";
import { validateCreativeDocument } from "./validate";

export interface CreativeRenderRequest {
  document: CreativeDocument;
  assets: CreativeRemotionAssetMap;
  /** Where the MP4 goes: always inside the owner's folder (see storage-paths). */
  outputKey: string;
  options?: CreativeRenderWindowOptions;
  onProgress?: (progress: number, phase: string) => Promise<void> | void;
  /** Lets a draft render make and record preview copies of large videos. */
  previews?: PreviewCopyStore;
}

export interface CreativeRenderResult {
  url: string;
  contentType: string;
  sizeBytes: number;
  renderer: "remotion-vercel";
}

export interface CreativeDetachedRenderHandle {
  sandboxId: string;
  cmdId: string;
  outputFile: string;
  outputKey: string;
  startedAtMs: number;
}

export type CreativeDetachedRenderStatus =
  | { status: "rendering"; progress: number; phase: string; estimatedCompletionMs: number | null }
  | { status: "completed"; progress: 1; url: string; contentType: string; sizeBytes: number; renderer: "remotion-vercel" }
  | { status: "failed"; progress: number; error: string };

export function estimateRenderCompletionMs(startedAtMs: number, progress: number, nowMs = Date.now()): number | null {
  if (!Number.isFinite(progress) || progress <= 0) return null;
  if (progress >= 1) return nowMs;
  const elapsed = Math.max(0, nowMs - startedAtMs);
  return Math.round(startedAtMs + elapsed / progress);
}

export interface CreativeFrameRenderRequest {
  document: CreativeDocument;
  assets: CreativeRemotionAssetMap;
  timeMs: number;
  previews?: PreviewCopyStore;
}

/**
 * A rendered still, held in memory and never written to storage.
 *
 * Previews are looked at once and thrown away, so storing them only left a
 * multi-megabyte PNG behind for every frame an assistant ever inspected. Now
 * the frame travels to the assistant inside the tool response and nowhere
 * else.
 */
export interface CreativeFrameRenderResult {
  /** The preview to show: WebP, longest edge capped at PREVIEW_MAX_EDGE. */
  bytes: Uint8Array;
  contentType: "image/webp";
  sizeBytes: number;
  /**
   * The renderer's lossless full-resolution PNG, for the callers that measure
   * pixels (frame comparison, reference analysis). Never sent anywhere.
   */
  png: Uint8Array;
  renderer: "remotion-vercel";
  frame: number;
  timeMs: number;
}

export interface CreativeFramesRenderRequest {
  document: CreativeDocument;
  assets: CreativeRemotionAssetMap;
  /** Exact millisecond offsets to capture, in the order the caller asked for them. */
  timesMs: number[];
  /** Also composite the frames into one deterministic sheet. */
  contactSheet?: boolean;
  /** Makes and records preview copies of large videos the frames need. */
  previews?: PreviewCopyStore;
}

export interface CreativeContactSheetResult {
  bytes: Uint8Array;
  contentType: "image/webp";
  sizeBytes: number;
  columns: number;
  rows: number;
  width: number;
  height: number;
}

export interface CreativeFramesRenderResult {
  frames: CreativeFrameRenderResult[];
  contactSheet?: CreativeContactSheetResult;
}

export interface CreativeRenderAdapter {
  render(request: CreativeRenderRequest): Promise<CreativeRenderResult>;
  renderFrame(request: CreativeFrameRenderRequest): Promise<CreativeFrameRenderResult>;
  renderFrames(request: CreativeFramesRenderRequest): Promise<CreativeFramesRenderResult>;
  startDetached(request: CreativeRenderRequest): Promise<CreativeDetachedRenderHandle>;
  pollDetached(handle: CreativeDetachedRenderHandle): Promise<CreativeDetachedRenderStatus>;
  stopDetached(handle: CreativeDetachedRenderHandle): Promise<void>;
}

/**
 * Where the build records which Vercel Sandbox snapshot this deployment
 * renders with: one small JSON file per deployment, outside every user's
 * folder. Written by scripts/create-creative-render-snapshot.mjs.
 */
export const CREATIVE_RENDER_SNAPSHOT_PREFIX = "_system/render-snapshots/";

function snapshotMetadataKey() {
  const deploymentId = process.env.VERCEL_DEPLOYMENT_ID;
  if (!deploymentId) throw new Error("VERCEL_DEPLOYMENT_ID is unavailable");
  return `${CREATIVE_RENDER_SNAPSHOT_PREFIX}${deploymentId}.json`;
}

function positiveIntFromEnv(name: string, fallback: number): number {
  const parsed = Number.parseInt(process.env[name] ?? "", 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

/**
 * A 60-second 1080x1920 reel is 1800 frames. On the sandbox default of two
 * vCPUs that render took roughly ten minutes and was killed by every function
 * budget it ran under. Frame rendering is embarrassingly parallel, so the fix
 * is cores rather than patience. Four is the most this team's plan grants;
 * asking for more was refused on every render and fell back anyway.
 */
const RENDER_SANDBOX_VCPUS = positiveIntFromEnv("CREATIVE_RENDER_VCPUS", 4);

/**
 * Concurrency follows the cores the sandbox was actually granted, not the ones
 * that were asked for: the request can be refused and fall back to the default
 * allocation, and six browser workers on two cores thrash rather than render.
 * One core is held back for the encoder, which Remotion runs alongside the
 * browser workers rather than after them. Two were, but a 76-second render's
 * log showed the encoder idling behind the frame workers at about one frame a
 * second: drawing frames is the bottleneck, and the sandbox's 45-minute limit
 * is the ceiling it has to fit under.
 */
function renderConcurrencyFor(sandbox: { vcpus?: number }): number {
  if (process.env.CREATIVE_RENDER_CONCURRENCY) {
    return positiveIntFromEnv("CREATIVE_RENDER_CONCURRENCY", 1);
  }
  return Math.max(1, (sandbox.vcpus ?? RENDER_SANDBOX_VCPUS) - 1);
}

/**
 * A still batch runs no encoder alongside the browser workers, so — unlike
 * `renderConcurrencyFor` — nothing needs to be held back for one: every core
 * the sandbox was granted can drive a `renderStillOnVercel` call.
 */
function stillRenderConcurrencyFor(sandbox: { vcpus?: number }): number {
  if (process.env.CREATIVE_RENDER_CONCURRENCY) {
    return positiveIntFromEnv("CREATIVE_RENDER_CONCURRENCY", 1);
  }
  return Math.max(1, sandbox.vcpus ?? RENDER_SANDBOX_VCPUS);
}

/**
 * Runs `worker` over `items` with at most `concurrency` in flight at once,
 * writing each result to its input's index so callers get input order back
 * regardless of completion order.
 */
async function mapWithConcurrency<T, R>(
  items: T[],
  concurrency: number,
  worker: (item: T, index: number) => Promise<R>,
): Promise<R[]> {
  const results: R[] = new Array(items.length);
  let next = 0;
  async function runNext(): Promise<void> {
    while (next < items.length) {
      const index = next++;
      results[index] = await worker(items[index], index);
    }
  }
  await Promise.all(Array.from({ length: Math.min(concurrency, items.length) }, runNext));
  return results;
}

/**
 * The sandbox must outlive the function driving it, never the reverse: a
 * sandbox that self-terminates mid-render fails the job with a confusing
 * transport error instead of a timeout anyone can read.
 */
const RENDER_SANDBOX_TIMEOUT_MS = 45 * 60 * 1000;

async function restoreCreativeRendererSandbox() {
  const text = await getObjectText(snapshotMetadataKey());
  if (!text) throw new Error("Creative renderer snapshot metadata unavailable for this deployment");
  const payload = JSON.parse(text) as { snapshotId?: string };
  if (!payload.snapshotId) throw new Error("Creative renderer snapshot metadata is invalid");
  const source = { type: "snapshot", snapshotId: payload.snapshotId } as const;
  try {
    return withFileBackedRemotionConfig(
      await Sandbox.create({
        source,
        persistent: false,
        resources: { vcpus: RENDER_SANDBOX_VCPUS },
        timeout: RENDER_SANDBOX_TIMEOUT_MS,
      }),
    );
  } catch (error) {
    // A plan that will not grant this many vCPUs should cost the render its
    // speed, not the render itself. Set CREATIVE_RENDER_VCPUS to whatever the
    // account does allow to get the parallelism back.
    console.warn(
      `Creative renderer could not reserve ${RENDER_SANDBOX_VCPUS} vCPUs; falling back to the default allocation.`,
      error,
    );
    return withFileBackedRemotionConfig(
      await Sandbox.create({ source, persistent: false, timeout: RENDER_SANDBOX_TIMEOUT_MS }),
    );
  }
}

function assertValidDocument(document: CreativeDocument) {
  const validation = validateCreativeDocument(document);
  if (!validation.valid) {
    throw new Error(validation.issues[0]?.message ?? "Invalid CreativeDocument");
  }
}

function toBuffer(bytes: Uint8Array | ArrayBuffer): Uint8Array {
  return bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
}

/**
 * Longest edge a preview is sent at. Claude scales any image larger than this
 * down before reading it, so sending more pixels only costs bytes and upload
 * time, never detail the model can see.
 */
export const PREVIEW_MAX_EDGE = 1568;
export const PREVIEW_WEBP_QUALITY = 80;

/** One import of sharp shared by every frame in a batch, however many run at once. */
type Sharp = typeof import("sharp");
let sharpLoader: Promise<Sharp> | null = null;
function loadSharp(): Promise<Sharp> {
  sharpLoader ??= import("sharp").then((module) => module.default);
  return sharpLoader;
}

/** Re-encodes a lossless PNG as a small WebP for an assistant to look at. */
export async function encodePreviewWebp(png: Uint8Array): Promise<Uint8Array> {
  const sharp = await loadSharp();
  const webp = await sharp(Buffer.from(png))
    .resize(PREVIEW_MAX_EDGE, PREVIEW_MAX_EDGE, { fit: "inside", withoutEnlargement: true })
    .webp({ quality: PREVIEW_WEBP_QUALITY })
    .toBuffer();
  return new Uint8Array(webp);
}

async function compositeContactSheet(
  frames: Uint8Array[],
  layout: ContactSheetLayout,
): Promise<Uint8Array> {
  const sharp = await loadSharp();
  const tiles = await Promise.all(
    layout.tiles.map(async (tile, index) => ({
      input: await sharp(Buffer.from(frames[index]))
        .resize(tile.width, tile.height, { fit: "fill" })
        .png()
        .toBuffer(),
      left: tile.x,
      top: tile.y,
    })),
  );
  const sheet = await sharp({
    create: {
      width: layout.sheetWidth,
      height: layout.sheetHeight,
      channels: 4,
      background: { r: 9, g: 9, b: 11, alpha: 1 },
    },
  })
    .composite(tiles)
    .png()
    .toBuffer();
  return new Uint8Array(sheet);
}

/**
 * Runs alongside a detached render: waits for the renderer to report "done",
 * then PUTs the MP4 to storage through a signed URL and leaves a marker the
 * next poll reads. Nothing from the URL reaches the shell's parser; it is
 * passed in the environment.
 */
async function startOutputUploader(sandbox: Sandbox, outputFile: string, outputKey: string): Promise<void> {
  const putUrl = await presignPut(outputKey, 3 * 60 * 60);
  const script = `
for i in $(seq 1 1800); do
  if grep -q '"stage":"done"' /vercel/sandbox/progress.json 2>/dev/null && [ -s "$OUT" ]; then
    if curl -sS --fail -o /dev/null --retry 3 -X PUT -H "Content-Type: video/mp4" --upload-file "$OUT" "$PUT"; then
      echo uploaded > /tmp/studio-output-uploaded
    else
      echo failed > /tmp/studio-output-uploaded
    fi
    exit 0
  fi
  grep -q '"stage":"error"' /vercel/sandbox/progress.json 2>/dev/null && exit 0
  sleep 2
done`;
  await sandbox.runCommand({ cmd: "bash", args: ["-c", script], env: { OUT: outputFile, PUT: putUrl }, detached: true });
}

/** The render's output as stored, when the sandbox stored it itself. */
async function storedOutput(outputKey: string): Promise<CreativeDetachedRenderStatus | null> {
  const head = await headObject(outputKey).catch(() => null);
  if (!head || head.size <= 0) return null;
  const { mediaUrl } = await import("../storage");
  return {
    status: "completed",
    progress: 1,
    url: await mediaUrl(outputKey),
    contentType: head.contentType || "video/mp4",
    sizeBytes: head.size,
    renderer: "remotion-vercel",
  };
}

export class RemotionVercelCreativeRenderAdapter implements CreativeRenderAdapter {
  async startDetached(request: CreativeRenderRequest): Promise<CreativeDetachedRenderHandle> {
    assertValidDocument(request.document);
    const resolvedOptions = resolveCreativeRenderOptions(request.document, request.options);
    const sandbox = await restoreCreativeRendererSandbox();
    // A draft is for judging timing, so it reads the same small preview
    // copies as frame previews; the final render always reads originals.
    const assets =
      request.options?.quality === "draft"
        ? await localizeSandboxMedia({
            sandbox,
            assets: request.assets,
            options: { usePreviews: true, canMakePreviews: true },
            downloadUrl: sandboxDownloadUrl,
            previews: request.previews,
          }).catch(() => request.assets)
        : request.assets;
    let captured: { cmdId: string } | null = null;
    const detachedSandbox = new Proxy(sandbox as unknown as object, {
      get(target, property, receiver) {
        if (property === "runCommand") {
          const runCommand = sandbox.runCommand.bind(sandbox);
          return async (command: unknown) => {
            const actual = await runCommand(command as never) as unknown as { cmdId: string };
            captured = actual;
            return {
              logs: async function* () { /* return immediately while the real command continues */ },
              wait: async () => ({ exitCode: 0 }),
              stderr: async () => "",
              stdout: async () => "",
              exitCode: 0,
            };
          };
        }
        const value = Reflect.get(target, property, receiver);
        return typeof value === "function" ? value.bind(target) : value;
      },
    }) as unknown as Sandbox;
    const outputFile = "/tmp/creative-output.mp4";
    try {
      await renderMediaOnVercel({
        sandbox: detachedSandbox,
        compositionId: CREATIVE_REMOTION_COMPOSITION_ID,
        inputProps: { document: request.document, assets },
        codec: "h264",
        outputFile,
        ...(resolvedOptions.frameRange ? { frameRange: resolvedOptions.frameRange } : {}),
        scale: resolvedOptions.scale,
        ...(resolvedOptions.crf === undefined ? {} : { crf: resolvedOptions.crf }),
        jpegQuality: resolvedOptions.jpegQuality,
        concurrency: renderConcurrencyFor(sandbox),
        timeoutInMilliseconds: 120_000,
      });
      const command = captured as { cmdId: string } | null;
      if (!command?.cmdId) throw new Error("Renderer did not return a detached command id");
      // The render stores its own output the moment it finishes. Otherwise
      // the MP4 only left the sandbox when someone polled, and a render
      // nobody polled before the sandbox timed out was lost whole.
      await startOutputUploader(sandbox, outputFile, request.outputKey).catch((error) => {
        console.warn("[creative-render] could not start the output uploader; a poll will upload instead", error);
      });
      return {
        sandboxId: sandbox.name,
        cmdId: command.cmdId,
        outputFile,
        outputKey: request.outputKey,
        startedAtMs: Date.now(),
      };
    } catch (error) {
      await Promise.resolve(sandbox.stop()).catch(() => undefined);
      throw error;
    }
  }

  async pollDetached(handle: CreativeDetachedRenderHandle): Promise<CreativeDetachedRenderStatus> {
    let sandbox: Sandbox;
    try {
      sandbox = await Sandbox.get({ name: handle.sandboxId, resume: true });
    } catch {
      // The sandbox is gone, but the render may have stored its output first.
      const stored = await storedOutput(handle.outputKey);
      if (stored) return stored;
      return { status: "failed", progress: 0, error: "Render sandbox expired before producing output." };
    }
    let command: Awaited<ReturnType<Sandbox["getCommand"]>>;
    try {
      command = await sandbox.getCommand(handle.cmdId);
    } catch (error) {
      await Promise.resolve(sandbox.stop()).catch(() => undefined);
      return { status: "failed", progress: 0, error: error instanceof Error ? error.message : "Render command is unavailable." };
    }
    let progress: Record<string, unknown> = { stage: "starting", overallProgress: 0 };
    try {
      const value = await sandbox.fs.readFile("/vercel/sandbox/progress.json", "utf8");
      progress = JSON.parse(String(value)) as Record<string, unknown>;
    } catch {
      if (command.exitCode !== null) {
        const error = (await command.stderr().catch(() => "")) || "Render command exited before reporting progress.";
        await Promise.resolve(sandbox.stop()).catch(() => undefined);
        return { status: "failed", progress: 0, error };
      }
    }
    const stage = typeof progress.stage === "string" ? progress.stage : "starting";
    const overallProgress = typeof progress.overallProgress === "number" ? progress.overallProgress : 0;
    if (command.exitCode !== null && command.exitCode !== 0) {
      const error = (await command.stderr().catch(() => "")) || `Render command exited with code ${command.exitCode}.`;
      await Promise.resolve(sandbox.stop()).catch(() => undefined);
      return { status: "failed", progress: overallProgress, error };
    }
    if (stage === "error") {
      const error = typeof progress.message === "string" ? progress.message : "Render failed.";
      await Promise.resolve(sandbox.stop()).catch(() => undefined);
      return { status: "failed", progress: overallProgress, error };
    }
    if (stage !== "done") {
      return {
        status: "rendering",
        progress: Math.min(0.99, overallProgress),
        phase: stage,
        estimatedCompletionMs: estimateRenderCompletionMs(handle.startedAtMs, overallProgress),
      };
    }
    // Usually the sandbox has already stored the MP4 itself.
    const uploaded = await sandbox.fs.readFile("/tmp/studio-output-uploaded", "utf8").catch(() => null);
    if (uploaded && String(uploaded).trim() === "uploaded") {
      const stored = await storedOutput(handle.outputKey);
      if (stored) return stored;
    }
    const bytes = await sandbox.fs.readFile(handle.outputFile);
    const buffer = toBuffer(bytes as Uint8Array | ArrayBuffer);
    if (buffer.byteLength <= 0) throw new Error("Renderer produced an empty file");
    const contentType = typeof progress.contentType === "string" ? progress.contentType : "video/mp4";
    const url = await uploadAnyBytes(buffer, handle.outputKey, contentType);
    if (!url) throw new Error("Rendered video could not be persisted");
    return { status: "completed", progress: 1, url, contentType, sizeBytes: buffer.byteLength, renderer: "remotion-vercel" };
  }

  async stopDetached(handle: CreativeDetachedRenderHandle): Promise<void> {
    const sandbox = await Sandbox.get({ name: handle.sandboxId, resume: true }).catch(() => null);
    if (sandbox) await Promise.resolve(sandbox.stop()).catch(() => undefined);
  }

  async render(request: CreativeRenderRequest): Promise<CreativeRenderResult> {
    assertValidDocument(request.document);
    const resolvedOptions = resolveCreativeRenderOptions(request.document, request.options);

    await request.onProgress?.(0.05, "restoring-renderer");
    const sandbox = await restoreCreativeRendererSandbox();

    try {
      await request.onProgress?.(0.1, "rendering");
      const output = await renderMediaOnVercel({
        sandbox,
        compositionId: CREATIVE_REMOTION_COMPOSITION_ID,
        inputProps: {
          document: request.document,
          assets: request.assets,
        },
        codec: "h264",
        outputFile: "/tmp/creative-output.mp4",
        ...(resolvedOptions.frameRange ? { frameRange: resolvedOptions.frameRange } : {}),
        scale: resolvedOptions.scale,
        ...(resolvedOptions.crf === undefined ? {} : { crf: resolvedOptions.crf }),
        jpegQuality: resolvedOptions.jpegQuality,
        concurrency: renderConcurrencyFor(sandbox),
        timeoutInMilliseconds: 120_000,
        onProgress: async (event) => {
          if (event.stage === "render-progress") {
            await request.onProgress?.(0.1 + event.overallProgress * 0.8, "rendering");
          } else if (event.stage === "opening-browser") {
            await request.onProgress?.(0.12, "opening-browser");
          } else if (event.stage === "selecting-composition") {
            await request.onProgress?.(0.16, "selecting-composition");
          }
        },
      });

      await request.onProgress?.(0.92, "uploading");
      const bytes = await sandbox.fs.readFile(output.sandboxFilePath);
      const buffer = toBuffer(bytes as Uint8Array | ArrayBuffer);
      if (buffer.byteLength <= 0) throw new Error("Renderer produced an empty file");

      const url = await uploadAnyBytes(buffer, request.outputKey, output.contentType || "video/mp4");
      if (!url) throw new Error("Rendered video could not be persisted");

      await request.onProgress?.(1, "completed");
      return {
        url,
        contentType: output.contentType || "video/mp4",
        sizeBytes: buffer.byteLength,
        renderer: "remotion-vercel",
      };
    } finally {
      try {
        await sandbox.stop();
      } catch {
        // Sandbox also has a hard timeout; cleanup failure must not hide render result.
      }
    }
  }

  async renderFrame(request: CreativeFrameRenderRequest): Promise<CreativeFrameRenderResult> {
    const result = await this.renderFrames({
      document: request.document,
      assets: request.assets,
      timesMs: [request.timeMs],
      previews: request.previews,
    });
    return result.frames[0];
  }

  /**
   * Renders every requested millisecond as an exact PNG still from the same
   * restored snapshot, the same composition ID and the same `{ document,
   * assets }` input props the final MP4 uses — so a previewed frame is the
   * frame the final render will contain, not an approximation of it.
   *
   * One sandbox serves the whole batch; it is stopped in `finally` exactly
   * like the MP4 path.
   */
  async renderFrames(request: CreativeFramesRenderRequest): Promise<CreativeFramesRenderResult> {
    assertValidDocument(request.document);
    if (request.timesMs.length === 0) throw new Error("At least one time_ms is required");

    // Resolve every frame before touching the renderer so an invalid
    // timestamp fails fast instead of after a sandbox restore.
    const resolved = request.timesMs.map((timeMs) => resolveCreativeFrameAtTime(request.document, timeMs));

    const sandbox = await restoreCreativeRendererSandbox();
    try {
      // Each still below is a separate renderer process, and each would
      // download every video it shows in full. Copy them in once instead.
      const assets = await localizeSandboxMedia({
        sandbox,
        assets: request.assets,
        options: { usePreviews: true, canMakePreviews: true },
        downloadUrl: sandboxDownloadUrl,
        previews: request.previews,
      }).catch(() => request.assets);

      // Each still is its own detached process in the sandbox (a fresh
      // headless Chromium per call, exactly like the MP4 path's parallel
      // frame workers), so a batch of stills is embarrassingly parallel too.
      // Running them one at a time left the sandbox's other cores idle for
      // the whole batch; this drives up to `vcpus` of them at once instead.
      const rendered = await mapWithConcurrency(
        resolved,
        stillRenderConcurrencyFor(sandbox),
        async ({ frame, timeMs }, index) => {
          const output = await renderStillOnVercel({
            sandbox,
            compositionId: CREATIVE_REMOTION_COMPOSITION_ID,
            inputProps: {
              document: request.document,
              assets,
            },
            frame,
            imageFormat: "png",
            outputFile: `/tmp/creative-frame-${index}.png`,
            timeoutInMilliseconds: 120_000,
          });

          const bytes = await sandbox.fs.readFile(output.sandboxFilePath);
          const png = toBuffer(bytes as Uint8Array | ArrayBuffer);
          if (png.byteLength <= 0) throw new Error("Renderer produced an empty frame");

          const preview = await encodePreviewWebp(png);
          return {
            bytes: preview,
            contentType: "image/webp" as const,
            sizeBytes: preview.byteLength,
            png,
            renderer: "remotion-vercel" as const,
            frame,
            timeMs,
          };
        },
      );

      const frames = rendered;
      if (!request.contactSheet) return { frames };

      const layout = planContactSheetLayout({
        frameCount: frames.length,
        frameWidth: request.document.canvas.width,
        frameHeight: request.document.canvas.height,
      });
      const sheet = await encodePreviewWebp(
        await compositeContactSheet(frames.map((entry) => entry.png), layout),
      );

      return {
        frames,
        contactSheet: {
          bytes: sheet,
          contentType: "image/webp",
          sizeBytes: sheet.byteLength,
          columns: layout.columns,
          rows: layout.rows,
          width: layout.sheetWidth,
          height: layout.sheetHeight,
        },
      };
    } finally {
      try {
        await sandbox.stop();
      } catch {
        // Sandbox also has a hard timeout; cleanup failure must not hide render result.
      }
    }
  }
}

export const creativeRenderAdapter: CreativeRenderAdapter = new RemotionVercelCreativeRenderAdapter();
