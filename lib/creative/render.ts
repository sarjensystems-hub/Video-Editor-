import { Sandbox } from "@vercel/sandbox";
import { renderMediaOnVercel, renderStillOnVercel } from "@remotion/vercel";
import { uploadAnyBytes } from "../storage";
import { getObjectText, presignPut } from "../b2";
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
import {
  assertValidDocument,
  buildContactSheet,
  encodePreviewWebp,
  estimateRenderCompletionMs,
  storedRenderOutput,
  toBuffer,
  type CreativeRendererName,
} from "./render-shared";
import { RemoteWorkerCreativeRenderAdapter, isRenderWorkerHandle, renderWorkerConfigured, stopRenderWorkerJob } from "./render-worker";

export { PREVIEW_MAX_EDGE, PREVIEW_WEBP_QUALITY, encodePreviewWebp, estimateRenderCompletionMs } from "./render-shared";

export interface CreativeRenderRequest {
  document: CreativeDocument;
  assets: CreativeRemotionAssetMap;
  /** Where the MP4 goes: always inside the owner's folder (see storage-paths). */
  outputKey: string;
  options?: CreativeRenderWindowOptions;
  onProgress?: (progress: number, phase: string) => Promise<void> | void;
  /** Lets a draft render make and record preview copies of large videos. */
  previews?: PreviewCopyStore;
  /**
   * Detached renders only: a signed URL the sandbox POSTs to once the render
   * has finished, failed or stalled, so the job is closed out and the
   * sandbox stopped without waiting for anyone to poll.
   */
  callbackUrl?: string;
  /**
   * Detached renders only: called with the sandbox's name the moment it
   * exists, before the render is launched, so a launch that dies half-way
   * still leaves a record of a sandbox someone has to stop.
   */
  onSandboxCreated?: (sandboxName: string) => Promise<void>;
}

export interface CreativeRenderResult {
  url: string;
  contentType: string;
  sizeBytes: number;
  renderer: CreativeRendererName;
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
  | { status: "completed"; progress: 1; url: string; contentType: string; sizeBytes: number; renderer: CreativeRendererName }
  | { status: "failed"; progress: number; error: string };


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
  renderer: CreativeRendererName;
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

/**
 * Previews and contact sheets run inside one request and stop their sandbox
 * in a `finally`. A request killed at its 300-second limit never reaches that
 * `finally`, so the timeout is the only thing that stops the sandbox: keep it
 * just past the longest a request can live, not at the 45 minutes an MP4
 * export needs.
 */
const IN_REQUEST_SANDBOX_TIMEOUT_MS = 10 * 60 * 1000;

async function restoreCreativeRendererSandbox(timeout = RENDER_SANDBOX_TIMEOUT_MS) {
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
        timeout,
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
      await Sandbox.create({ source, persistent: false, timeout }),
    );
  }
}

/**
 * How long a render may go without its progress file changing before the
 * watchdog gives up on it. Rendering rewrites the file many times a second,
 * so this much silence means a hung renderer, and without the watchdog it
 * would hold its sandbox for the full 45-minute timeout.
 */
export const RENDER_STALL_SECONDS = 15 * 60;
const STALL_MARKER = "/tmp/studio-render-stalled";
const UPLOAD_MARKER = "/tmp/studio-output-uploaded";

/**
 * Runs alongside a detached render: waits for the renderer to report "done",
 * then PUTs the MP4 to storage through a signed URL and leaves a marker the
 * next poll reads. When the render finishes, fails or stalls it POSTs to the
 * job's callback URL, so the job is closed and the sandbox stopped right
 * away rather than when someone next polls. Nothing from either URL reaches
 * the shell's parser; both are passed in the environment.
 */
async function startOutputUploader(sandbox: Sandbox, outputFile: string, outputKey: string, callbackUrl?: string): Promise<void> {
  const putUrl = await presignPut(outputKey, 3 * 60 * 60);
  const script = `
notify() {
  [ -n "$CB" ] && curl -sS -o /dev/null --max-time 30 --retry 3 -X POST "$CB" || true
}
last=""
quiet=0
for i in $(seq 1 1800); do
  if grep -q '"stage":"done"' /vercel/sandbox/progress.json 2>/dev/null && [ -s "$OUT" ]; then
    if curl -sS --fail -o /dev/null --retry 3 -X PUT -H "Content-Type: video/mp4" --upload-file "$OUT" "$PUT"; then
      echo uploaded > ${UPLOAD_MARKER}
    else
      echo failed > ${UPLOAD_MARKER}
    fi
    notify
    exit 0
  fi
  if grep -q '"stage":"error"' /vercel/sandbox/progress.json 2>/dev/null; then
    notify
    exit 0
  fi
  now=$(cksum /vercel/sandbox/progress.json 2>/dev/null)
  if [ "$now" = "$last" ]; then quiet=$((quiet + 2)); else quiet=0; last="$now"; fi
  if [ "$quiet" -ge "$STALL" ]; then
    echo stalled > ${STALL_MARKER}
    notify
    exit 0
  fi
  sleep 2
done`;
  await sandbox.runCommand({
    cmd: "bash",
    args: ["-c", script],
    env: { OUT: outputFile, PUT: putUrl, CB: callbackUrl ?? "", STALL: String(RENDER_STALL_SECONDS) },
    detached: true,
  });
}

/**
 * Looks a render's sandbox up without waking it.
 *
 * Every SDK call on a stopped sandbox resumes it, which boots a fresh VM: a
 * poll that arrived after the sandbox timed out used to start a new machine,
 * fail to find the render command in it, and report a render whose MP4 was
 * already stored as failed. Returns null when the sandbox is not running.
 */
async function runningSandbox(name: string): Promise<Sandbox | null> {
  const sandbox = await Sandbox.get({ name, resume: false }).catch(() => null);
  if (!sandbox) return null;
  let status: string | undefined;
  try {
    status = sandbox.status;
  } catch {
    return null;
  }
  return status === "running" || status === "pending" ? sandbox : null;
}

/**
 * Stops a sandbox by name, without waking it if it has already stopped. A
 * name the self-hosted worker handed out cancels that worker's render instead.
 */
export async function stopSandboxByName(name: string): Promise<void> {
  if (isRenderWorkerHandle(name)) return stopRenderWorkerJob(name);
  const sandbox = await runningSandbox(name);
  if (sandbox) await Promise.resolve(sandbox.stop()).catch(() => undefined);
}

export class RemotionVercelCreativeRenderAdapter implements CreativeRenderAdapter {
  async startDetached(request: CreativeRenderRequest): Promise<CreativeDetachedRenderHandle> {
    assertValidDocument(request.document);
    const resolvedOptions = resolveCreativeRenderOptions(request.document, request.options);
    const sandbox = await restoreCreativeRendererSandbox();
    if (request.onSandboxCreated) {
      try {
        await request.onSandboxCreated(sandbox.name);
      } catch (error) {
        await Promise.resolve(sandbox.stop()).catch(() => undefined);
        throw error;
      }
    }
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
      await startOutputUploader(sandbox, outputFile, request.outputKey, request.callbackUrl).catch((error) => {
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
    const sandbox = await runningSandbox(handle.sandboxId);
    if (!sandbox) {
      // The sandbox is gone, but the render may have stored its output first.
      const stored = await storedRenderOutput(handle.outputKey, "remotion-vercel");
      if (stored) return stored;
      return { status: "failed", progress: 0, error: "Render sandbox expired before producing output." };
    }
    let command: Awaited<ReturnType<Sandbox["getCommand"]>>;
    try {
      command = await sandbox.getCommand(handle.cmdId);
    } catch (error) {
      const stored = await storedRenderOutput(handle.outputKey, "remotion-vercel");
      await Promise.resolve(sandbox.stop()).catch(() => undefined);
      if (stored) return stored;
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
      const stalled = await sandbox.fs.readFile(STALL_MARKER, "utf8").catch(() => null);
      if (stalled) {
        await Promise.resolve(sandbox.stop()).catch(() => undefined);
        return {
          status: "failed",
          progress: overallProgress,
          error: `Render stopped making progress for ${RENDER_STALL_SECONDS / 60} minutes and was stopped.`,
        };
      }
      return {
        status: "rendering",
        progress: Math.min(0.99, overallProgress),
        phase: stage,
        estimatedCompletionMs: estimateRenderCompletionMs(handle.startedAtMs, overallProgress),
      };
    }
    // Usually the sandbox has already stored the MP4 itself.
    const uploaded = await sandbox.fs.readFile(UPLOAD_MARKER, "utf8").catch(() => null);
    if (uploaded && String(uploaded).trim() === "uploaded") {
      const stored = await storedRenderOutput(handle.outputKey, "remotion-vercel");
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
    await stopSandboxByName(handle.sandboxId);
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

    const sandbox = await restoreCreativeRendererSandbox(IN_REQUEST_SANDBOX_TIMEOUT_MS);
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

      return { frames, contactSheet: await buildContactSheet(request.document, frames) };
    } finally {
      try {
        await sandbox.stop();
      } catch {
        // Sandbox also has a hard timeout; cleanup failure must not hide render result.
      }
    }
  }
}

/**
 * Picks the renderer per call. New work goes to the self-hosted worker when
 * CREATIVE_RENDER_WORKER_SECRET is set and to the Vercel Sandbox otherwise; a
 * render already running is always polled and stopped by the backend that
 * started it, so switching the variable never strands one mid-flight.
 */
export class RoutingCreativeRenderAdapter implements CreativeRenderAdapter {
  constructor(
    private readonly vercel: CreativeRenderAdapter = new RemotionVercelCreativeRenderAdapter(),
    private readonly worker: CreativeRenderAdapter = new RemoteWorkerCreativeRenderAdapter(),
    private readonly useWorker: () => boolean = renderWorkerConfigured,
  ) {}

  private current(): CreativeRenderAdapter {
    return this.useWorker() ? this.worker : this.vercel;
  }

  private owner(handle: CreativeDetachedRenderHandle): CreativeRenderAdapter {
    return isRenderWorkerHandle(handle.sandboxId) ? this.worker : this.vercel;
  }

  render(request: CreativeRenderRequest) {
    return this.current().render(request);
  }

  renderFrame(request: CreativeFrameRenderRequest) {
    return this.current().renderFrame(request);
  }

  renderFrames(request: CreativeFramesRenderRequest) {
    return this.current().renderFrames(request);
  }

  startDetached(request: CreativeRenderRequest) {
    return this.current().startDetached(request);
  }

  pollDetached(handle: CreativeDetachedRenderHandle) {
    return this.owner(handle).pollDetached(handle);
  }

  stopDetached(handle: CreativeDetachedRenderHandle) {
    return this.owner(handle).stopDetached(handle);
  }
}

export const creativeRenderAdapter: CreativeRenderAdapter = new RoutingCreativeRenderAdapter();
