/**
 * Renders on a self-hosted worker (render-worker/server.ts) instead of a
 * Vercel Sandbox: a small Node service with headless Chrome that runs the same
 * Remotion composition, on a VPS, a Fly/Railway machine or someone's own
 * computer behind a tunnel.
 *
 * Switched on by CREATIVE_RENDER_WORKER_URL and CREATIVE_RENDER_WORKER_SECRET.
 * The worker holds no credentials: it is handed signed URLs to download media
 * from and to PUT its output to, and it calls the render's signed callback URL
 * when it is done, exactly as the sandbox did.
 */

import { presignGet, presignPut } from "../b2";
import { storagePathFromMediaUrl } from "../storage-paths";
import { resolveCreativeFrameAtTime } from "./frame-time";
import type {
  CreativeDetachedRenderHandle,
  CreativeDetachedRenderStatus,
  CreativeFrameRenderRequest,
  CreativeFrameRenderResult,
  CreativeFramesRenderRequest,
  CreativeFramesRenderResult,
  CreativeRenderAdapter,
  CreativeRenderRequest,
  CreativeRenderResult,
} from "./render";
import { resolveCreativeRenderOptions } from "./render-options";
import {
  assertValidDocument,
  buildContactSheet,
  encodePreviewWebp,
  estimateRenderCompletionMs,
  storedRenderOutput,
} from "./render-shared";
import {
  RENDER_WORKER_HANDLE_PREFIX,
  type RenderWorkerMediaJob,
  type RenderWorkerRenderRequest,
  type RenderWorkerRenderStatus,
  type RenderWorkerStillsRequest,
  type RenderWorkerStillsResponse,
} from "./render-worker-protocol";
import type { CreativeRemotionAssetMap } from "./remotion";
import { planSandboxMedia, type PreviewCopyStore } from "./sandbox-media";

export { RENDER_WORKER_HANDLE_PREFIX } from "./render-worker-protocol";

/**
 * Signed URLs outlive the worker's queue: a render can wait behind another one
 * before it downloads anything or uploads its MP4.
 */
const WORKER_URL_TTL_SECONDS = 12 * 60 * 60;

/** Stills run inside one request, so they must answer well before its 300-second limit. */
const STILLS_TIMEOUT_MS = 270_000;
const CONTROL_TIMEOUT_MS = 30_000;

interface RenderWorkerConfig {
  url: string;
  secret: string;
}

function renderWorkerConfig(): RenderWorkerConfig | null {
  const url = process.env.CREATIVE_RENDER_WORKER_URL?.trim();
  const secret = process.env.CREATIVE_RENDER_WORKER_SECRET?.trim();
  return url && secret ? { url: url.replace(/\/+$/, ""), secret } : null;
}

/** Whether new renders and previews go to the self-hosted worker. */
export function renderWorkerConfigured(): boolean {
  return renderWorkerConfig() !== null;
}

/** Whether a handle (or a recorded sandbox name) belongs to the worker. */
export function isRenderWorkerHandle(name: string | null | undefined): boolean {
  return typeof name === "string" && name.startsWith(RENDER_WORKER_HANDLE_PREFIX);
}

function workerJobId(name: string): string {
  return name.slice(RENDER_WORKER_HANDLE_PREFIX.length);
}

async function workerFetch(path: string, init: RequestInit & { timeoutMs?: number } = {}): Promise<Response> {
  const config = renderWorkerConfig();
  if (!config) throw new Error("The render worker is not configured (CREATIVE_RENDER_WORKER_URL / CREATIVE_RENDER_WORKER_SECRET).");
  const { timeoutMs = CONTROL_TIMEOUT_MS, headers, ...rest } = init;
  try {
    return await fetch(`${config.url}${path}`, {
      ...rest,
      headers: { ...headers, Authorization: `Bearer ${config.secret}` },
      signal: AbortSignal.timeout(timeoutMs),
      cache: "no-store",
    });
  } catch (error) {
    throw new Error(`The render worker is unreachable: ${error instanceof Error ? error.message : String(error)}`);
  }
}

async function workerError(response: Response, doing: string): Promise<Error> {
  const body = await response.text().catch(() => "");
  let message = body;
  try {
    message = (JSON.parse(body) as { error?: string }).error ?? body;
  } catch {
    // Not JSON; use the text as it is.
  }
  return new Error(`Render worker failed ${doing} (${response.status}): ${message.slice(0, 500)}`);
}

/** A URL the worker can download without credentials; our own /media URLs are signed directly. */
async function workerDownloadUrl(url: string): Promise<string> {
  const path = storagePathFromMediaUrl(url);
  return path ? presignGet(path, WORKER_URL_TTL_SECONDS) : url;
}

/**
 * What the worker should copy locally, with the same plan the sandbox used:
 * deduplicated downloads, previews' small copies when `usePreviews`, and a
 * new preview copy for a large video that has none yet.
 */
export async function planWorkerMedia(
  assets: CreativeRemotionAssetMap,
  usePreviews: boolean,
  previews?: PreviewCopyStore,
): Promise<{ media: RenderWorkerMediaJob[]; previewUrls: Map<string, string> }> {
  const jobs = planSandboxMedia(assets, { usePreviews, canMakePreviews: usePreviews && Boolean(previews) });
  const previewUrls = new Map<string, string>();
  const media = await Promise.all(
    jobs.map(async (job): Promise<RenderWorkerMediaJob> => {
      const entry: RenderWorkerMediaJob = {
        file: job.file,
        url: await workerDownloadUrl(job.sourceUrl),
        assetIds: job.assetIds,
      };
      if (job.makePreviewFor && previews) {
        const target = await previews.target(job.makePreviewFor).catch(() => null);
        if (target) {
          previewUrls.set(job.makePreviewFor, target.url);
          entry.preview = { assetId: job.makePreviewFor, putUrl: target.putUrl };
        }
      }
      return entry;
    }),
  );
  return { media, previewUrls };
}

/** Cancels a worker render by its handle name. Best-effort, like stopping a sandbox. */
export async function stopRenderWorkerJob(name: string): Promise<void> {
  if (!isRenderWorkerHandle(name)) return;
  await workerFetch(`/renders/${encodeURIComponent(workerJobId(name))}`, { method: "DELETE" }).catch(() => undefined);
}

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export class RemoteWorkerCreativeRenderAdapter implements CreativeRenderAdapter {
  async startDetached(request: CreativeRenderRequest): Promise<CreativeDetachedRenderHandle> {
    assertValidDocument(request.document);
    const options = resolveCreativeRenderOptions(request.document, request.options);
    // A draft reads the same small preview copies as frame previews; the
    // final render always reads originals. New copies are only made by
    // previews, where the answer comes back in the same request to record.
    const { media } = await planWorkerMedia(request.assets, request.options?.quality === "draft");
    const body: RenderWorkerRenderRequest = {
      document: request.document,
      assets: request.assets,
      media,
      options: {
        ...(options.frameRange ? { frameRange: options.frameRange } : {}),
        scale: options.scale,
        ...(options.crf === undefined ? {} : { crf: options.crf }),
        jpegQuality: options.jpegQuality,
      },
      putUrl: await presignPut(request.outputKey, WORKER_URL_TTL_SECONDS),
      ...(request.callbackUrl ? { callbackUrl: request.callbackUrl } : {}),
    };
    const response = await workerFetch("/renders", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    if (!response.ok) throw await workerError(response, "to start the render");
    const { id } = (await response.json()) as { id?: string };
    if (!id) throw new Error("Render worker did not return a render id");
    const name = `${RENDER_WORKER_HANDLE_PREFIX}${id}`;

    if (request.onSandboxCreated) {
      try {
        await request.onSandboxCreated(name);
      } catch (error) {
        await stopRenderWorkerJob(name);
        throw error;
      }
    }

    return {
      sandboxId: name,
      cmdId: "render-worker",
      outputFile: "",
      outputKey: request.outputKey,
      startedAtMs: Date.now(),
    };
  }

  async pollDetached(handle: CreativeDetachedRenderHandle): Promise<CreativeDetachedRenderStatus> {
    // Unreachable throws: the job stays "rendering" until the worker answers
    // again or the job outlives WORKER_RENDER_LIFETIME_MS.
    const response = await workerFetch(`/renders/${encodeURIComponent(workerJobId(handle.sandboxId))}`);
    if (response.status === 404) {
      const stored = await storedRenderOutput(handle.outputKey, "remotion-worker");
      if (stored) return stored;
      return { status: "failed", progress: 0, error: "The render worker no longer has this render; it was probably restarted." };
    }
    if (!response.ok) throw await workerError(response, "to report render status");
    const status = (await response.json()) as RenderWorkerRenderStatus;

    if (status.status === "queued") {
      return { status: "rendering", progress: 0, phase: "queued", estimatedCompletionMs: null };
    }
    if (status.status === "rendering") {
      const progress = Math.min(0.99, Math.max(0, status.progress));
      return {
        status: "rendering",
        progress,
        phase: status.stage,
        estimatedCompletionMs: estimateRenderCompletionMs(handle.startedAtMs, progress),
      };
    }
    if (status.status === "failed") {
      return { status: "failed", progress: status.progress, error: status.error || "Render failed." };
    }
    const stored = await storedRenderOutput(handle.outputKey, "remotion-worker");
    if (stored) return stored;
    return { status: "failed", progress: 1, error: "The render worker finished but its output is not in storage." };
  }

  async stopDetached(handle: CreativeDetachedRenderHandle): Promise<void> {
    await stopRenderWorkerJob(handle.sandboxId);
  }

  async render(request: CreativeRenderRequest): Promise<CreativeRenderResult> {
    await request.onProgress?.(0.05, "queued");
    const handle = await this.startDetached(request);
    for (;;) {
      await sleep(2000);
      const status = await this.pollDetached(handle);
      if (status.status === "completed") {
        await request.onProgress?.(1, "completed");
        return { url: status.url, contentType: status.contentType, sizeBytes: status.sizeBytes, renderer: "remotion-worker" };
      }
      if (status.status === "failed") throw new Error(status.error);
      await request.onProgress?.(0.05 + status.progress * 0.9, status.phase);
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

  /** Same contract as the sandbox: exact PNG stills from the final-render composition. */
  async renderFrames(request: CreativeFramesRenderRequest): Promise<CreativeFramesRenderResult> {
    assertValidDocument(request.document);
    if (request.timesMs.length === 0) throw new Error("At least one time_ms is required");
    const resolved = request.timesMs.map((timeMs) => resolveCreativeFrameAtTime(request.document, timeMs));

    const { media, previewUrls } = await planWorkerMedia(request.assets, true, request.previews);
    const body: RenderWorkerStillsRequest = {
      document: request.document,
      assets: request.assets,
      media,
      frames: resolved.map(({ frame }) => frame),
    };
    const response = await workerFetch("/stills", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
      timeoutMs: STILLS_TIMEOUT_MS,
    });
    if (!response.ok) throw await workerError(response, "to render frames");
    const result = (await response.json()) as RenderWorkerStillsResponse;
    if (result.frames.length !== resolved.length) throw new Error("Render worker returned the wrong number of frames");

    for (const stored of result.previewsStored) {
      const url = previewUrls.get(stored.assetId);
      if (url && request.previews) await request.previews.save(stored.assetId, url, stored.sizeBytes).catch(() => undefined);
    }

    const frames = await Promise.all(
      resolved.map(async ({ frame, timeMs }, index) => {
        const png = new Uint8Array(Buffer.from(result.frames[index].png, "base64"));
        if (png.byteLength <= 0) throw new Error("Renderer produced an empty frame");
        const preview = await encodePreviewWebp(png);
        return {
          bytes: preview,
          contentType: "image/webp" as const,
          sizeBytes: preview.byteLength,
          png,
          renderer: "remotion-worker" as const,
          frame,
          timeMs,
        };
      }),
    );
    if (!request.contactSheet) return { frames };
    return { frames, contactSheet: await buildContactSheet(request.document, frames) };
  }
}
