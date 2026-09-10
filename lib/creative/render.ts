import { Sandbox } from "@vercel/sandbox";
import { renderMediaOnVercel, renderStillOnVercel } from "@remotion/vercel";
import { uploadAnyBytes } from "../storage";
import { planContactSheetLayout, type ContactSheetLayout } from "./contact-sheet";
import { resolveCreativeFrameAtTime } from "./frame-time";
import { resolveCreativeRenderOptions, type CreativeRenderWindowOptions } from "./render-options";
import {
  CREATIVE_REMOTION_COMPOSITION_ID,
  type CreativeRemotionAssetMap,
} from "./remotion";
import { withFileBackedRemotionConfig } from "./remotion-sandbox-transport";
import type { CreativeDocument } from "./schema";
import { validateCreativeDocument } from "./validate";

export interface CreativeRenderRequest {
  document: CreativeDocument;
  assets: CreativeRemotionAssetMap;
  outputKey?: string;
  options?: CreativeRenderWindowOptions;
  onProgress?: (progress: number, phase: string) => Promise<void> | void;
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
  outputKey?: string;
}

export interface CreativeFrameRenderResult {
  url: string;
  contentType: string;
  sizeBytes: number;
  renderer: "remotion-vercel";
  frame: number;
  timeMs: number;
}

export interface CreativeFramesRenderRequest {
  document: CreativeDocument;
  assets: CreativeRemotionAssetMap;
  /** Exact millisecond offsets to capture, in the order the caller asked for them. */
  timesMs: number[];
  /** Optional R2 key per frame, index-aligned with `timesMs`. */
  outputKeys?: string[];
  /** When set, the frames are also composited into one deterministic sheet at this key. */
  contactSheetKey?: string;
}

export interface CreativeContactSheetResult {
  url: string;
  contentType: string;
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

const CREATIVE_RENDER_SNAPSHOTS_BUCKET = "creative-render-snapshots";

function snapshotMetadataUrl() {
  const deploymentId = process.env.VERCEL_DEPLOYMENT_ID;
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL?.replace(/\/$/, "");
  if (!deploymentId) throw new Error("VERCEL_DEPLOYMENT_ID is unavailable");
  if (!supabaseUrl) throw new Error("NEXT_PUBLIC_SUPABASE_URL is unavailable");
  return `${supabaseUrl}/storage/v1/object/public/${CREATIVE_RENDER_SNAPSHOTS_BUCKET}/${deploymentId}.json`;
}

function positiveIntFromEnv(name: string, fallback: number): number {
  const parsed = Number.parseInt(process.env[name] ?? "", 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

/**
 * A 60-second 1080x1920 reel is 1800 frames. On the sandbox default of two
 * vCPUs that render took roughly ten minutes and was killed by every function
 * budget it ran under. Frame rendering is embarrassingly parallel, so the fix
 * is cores rather than patience.
 */
const RENDER_SANDBOX_VCPUS = positiveIntFromEnv("CREATIVE_RENDER_VCPUS", 8);

/**
 * Concurrency follows the cores the sandbox was actually granted, not the ones
 * that were asked for: the request can be refused and fall back to the default
 * allocation, and six browser workers on two cores thrash rather than render.
 * Two cores are held back for the encoder, which Remotion runs alongside the
 * browser workers rather than after them.
 */
function renderConcurrencyFor(sandbox: { vcpus?: number }): number {
  if (process.env.CREATIVE_RENDER_CONCURRENCY) {
    return positiveIntFromEnv("CREATIVE_RENDER_CONCURRENCY", 1);
  }
  return Math.max(1, (sandbox.vcpus ?? RENDER_SANDBOX_VCPUS) - 2);
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
  const response = await fetch(snapshotMetadataUrl(), { cache: "no-store" });
  if (!response.ok) {
    throw new Error(`Creative renderer snapshot metadata unavailable (${response.status})`);
  }
  const payload = (await response.json()) as { snapshotId?: string };
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

async function compositeContactSheet(
  frames: Uint8Array[],
  layout: ContactSheetLayout,
): Promise<Uint8Array> {
  const sharpModule = await import("sharp");
  const sharp = sharpModule.default;
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

export class RemotionVercelCreativeRenderAdapter implements CreativeRenderAdapter {
  async startDetached(request: CreativeRenderRequest): Promise<CreativeDetachedRenderHandle> {
    assertValidDocument(request.document);
    const resolvedOptions = resolveCreativeRenderOptions(request.document, request.options);
    const sandbox = await restoreCreativeRendererSandbox();
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
        inputProps: { document: request.document, assets: request.assets },
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
      return {
        sandboxId: sandbox.name,
        cmdId: command.cmdId,
        outputFile,
        outputKey: request.outputKey ?? `creative-renders/${crypto.randomUUID()}.mp4`,
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

      const key = request.outputKey ?? `creative-renders/${crypto.randomUUID()}.mp4`;
      const url = await uploadAnyBytes(buffer, key, output.contentType || "video/mp4");
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
      outputKeys: request.outputKey ? [request.outputKey] : undefined,
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
              assets: request.assets,
            },
            frame,
            imageFormat: "png",
            outputFile: `/tmp/creative-frame-${index}.png`,
            timeoutInMilliseconds: 120_000,
          });

          const bytes = await sandbox.fs.readFile(output.sandboxFilePath);
          const buffer = toBuffer(bytes as Uint8Array | ArrayBuffer);
          if (buffer.byteLength <= 0) throw new Error("Renderer produced an empty frame");

          const key = request.outputKeys?.[index] ?? `creative-frames/${crypto.randomUUID()}.png`;
          const url = await uploadAnyBytes(buffer, key, output.contentType || "image/png");
          if (!url) throw new Error("Rendered frame could not be persisted");

          return {
            raw: buffer,
            frame: {
              url,
              contentType: output.contentType || "image/png",
              sizeBytes: buffer.byteLength,
              renderer: "remotion-vercel" as const,
              frame,
              timeMs,
            },
          };
        },
      );

      const frames = rendered.map((entry) => entry.frame);
      const rawFrames = rendered.map((entry) => entry.raw);

      if (!request.contactSheetKey) return { frames };

      const layout = planContactSheetLayout({
        frameCount: rawFrames.length,
        frameWidth: request.document.canvas.width,
        frameHeight: request.document.canvas.height,
      });
      const sheetBytes = await compositeContactSheet(rawFrames, layout);
      const sheetUrl = await uploadAnyBytes(sheetBytes, request.contactSheetKey, "image/png");
      if (!sheetUrl) throw new Error("Contact sheet could not be persisted");

      return {
        frames,
        contactSheet: {
          url: sheetUrl,
          contentType: "image/png",
          sizeBytes: sheetBytes.byteLength,
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
