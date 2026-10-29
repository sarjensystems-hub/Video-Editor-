/**
 * The self-hosted creative render worker.
 *
 * Runs the same Remotion composition the Vercel Sandbox ran (remotion/index.ts)
 * with @remotion/renderer and Chrome Headless Shell, on any machine with Node:
 * a VPS, a Fly/Railway box, or someone's own computer behind a tunnel. The app
 * talks to it over HTTP (lib/creative/render-worker.ts); the contract is
 * lib/creative/render-worker-protocol.ts.
 *
 * It holds no storage credential and no database access. It downloads media
 * from signed URLs into the bundle's public folder once per job, renders, PUTs
 * the result to a signed URL and calls the job's signed callback URL.
 *
 *   RENDER_WORKER_SECRET        required; the app sends it as a bearer token
 *   PORT                        default 8787
 *   RENDER_WORKER_MAX_RENDERS   MP4 renders at once, default 1 (others queue)
 *   RENDER_WORKER_CONCURRENCY   browser tabs per render, default CPUs - 1
 *   RENDER_WORKER_BUNDLE_DIR    a prebuilt `remotion bundle`; bundled at start otherwise
 *   RENDER_WORKER_TMP           scratch folder for MP4s, default the OS temp dir
 *   RENDER_WORKER_GL            Chrome OpenGL backend (angle, egl, swangle, ...)
 *   RENDER_WORKER_BROWSER_EXECUTABLE  a Chrome/Chromium to use instead of downloading
 *                               Remotion's Chrome Headless Shell
 *   FFMPEG_PATH                 ffmpeg for preview copies; Remotion's own by default
 *
 * Run it with `npm run render-worker`.
 */

import { execFile } from "node:child_process";
import { randomUUID, timingSafeEqual } from "node:crypto";
import { createWriteStream } from "node:fs";
import { mkdir, readFile, rename, rm, stat } from "node:fs/promises";
import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { createRequire } from "node:module";
import { availableParallelism, tmpdir } from "node:os";
import path from "node:path";
import { Readable } from "node:stream";
import { pipeline } from "node:stream/promises";
import type { ReadableStream as NodeReadableStream } from "node:stream/web";
import { promisify } from "node:util";
import { bundle } from "@remotion/bundler";
import {
  ensureBrowser,
  makeCancelSignal,
  openBrowser,
  renderMedia,
  renderStill,
  selectComposition,
  type ChromiumOptions,
} from "@remotion/renderer";
import { CREATIVE_REMOTION_COMPOSITION_ID, type CreativeRemotionInputProps } from "../lib/creative/remotion";
import type {
  RenderWorkerHealth,
  RenderWorkerInput,
  RenderWorkerRenderRequest,
  RenderWorkerRenderStatus,
  RenderWorkerStillsRequest,
  RenderWorkerStillsResponse,
} from "../lib/creative/render-worker-protocol";
import { PREVIEW_COPY_MAX_EDGE, localizeAssetMap } from "../lib/creative/sandbox-media";

const ROOT = path.resolve(__dirname, "..");
const SECRET = process.env.RENDER_WORKER_SECRET?.trim() ?? "";
const PORT = positiveInt("PORT", 8787);
const CPUS = availableParallelism();
const MAX_RENDERS = positiveInt("RENDER_WORKER_MAX_RENDERS", 1);
/** One core is left for the encoder, which runs alongside the browser tabs. */
const RENDER_CONCURRENCY = positiveInt("RENDER_WORKER_CONCURRENCY", Math.max(1, CPUS - 1));
const TMP = path.resolve(process.env.RENDER_WORKER_TMP?.trim() || path.join(tmpdir(), "studio-render-worker"));
const GL = (process.env.RENDER_WORKER_GL?.trim() || null) as ChromiumOptions["gl"];
const CHROMIUM: ChromiumOptions = GL ? { gl: GL } : {};
const BROWSER_EXECUTABLE = process.env.RENDER_WORKER_BROWSER_EXECUTABLE?.trim() || null;
/** Same per-frame budget the sandbox used. */
const FRAME_TIMEOUT_MS = 120_000;
/** A document plus its asset map; a rich one is a few MB at most. */
const MAX_BODY_BYTES = 64 * 1024 * 1024;
/** Finished renders are remembered this long, for late polls. */
const KEEP_FINISHED_MS = 12 * 60 * 60 * 1000;
const SAFE_FILE = /^[A-Za-z0-9][A-Za-z0-9._-]{0,80}$/;

function positiveInt(name: string, fallback: number): number {
  const parsed = Number.parseInt(process.env[name] ?? "", 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

function log(...args: unknown[]) {
  console.log(new Date().toISOString(), "[render-worker]", ...args);
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

// ── Bundle ────────────────────────────────────────────────────────────────

let bundleDir = "";

async function prepareBundle(): Promise<string> {
  const prebuilt = process.env.RENDER_WORKER_BUNDLE_DIR?.trim();
  if (prebuilt) {
    const dir = path.resolve(prebuilt);
    await stat(path.join(dir, "index.html"));
    log(`using prebuilt bundle ${dir}`);
    return dir;
  }
  log("bundling remotion/index.ts");
  let lastLogged = -1;
  return bundle({
    entryPoint: path.join(ROOT, "remotion/index.ts"),
    outDir: path.join(ROOT, ".remotion-worker-bundle"),
    onProgress: (progress) => {
      const step = Math.floor(progress / 25);
      if (step !== lastLogged) {
        lastLogged = step;
        log(`bundling ${progress}%`);
      }
    },
  });
}

// ── Media ─────────────────────────────────────────────────────────────────

const execFileAsync = promisify(execFile);

function ffmpegPath(): string {
  if (process.env.FFMPEG_PATH?.trim()) return process.env.FFMPEG_PATH.trim();
  const require = createRequire(__filename);
  const arch = process.arch;
  const candidates =
    process.platform === "linux"
      ? [`@remotion/compositor-linux-${arch}-gnu`, `@remotion/compositor-linux-${arch}-musl`]
      : process.platform === "darwin"
        ? [`@remotion/compositor-darwin-${arch}`]
        : [`@remotion/compositor-win32-${arch}-msvc`];
  for (const name of candidates) {
    try {
      const { dir } = require(name) as { dir: string };
      return path.join(dir, process.platform === "win32" ? "ffmpeg.exe" : "ffmpeg");
    } catch {
      // Not installed for this platform; try the next.
    }
  }
  return "ffmpeg";
}

async function withRetries<T>(attempts: number, task: () => Promise<T>): Promise<T> {
  let lastError: unknown;
  for (let attempt = 0; attempt < attempts; attempt += 1) {
    try {
      return await task();
    } catch (error) {
      lastError = error;
      if (attempt < attempts - 1) await new Promise((resolve) => setTimeout(resolve, 1000 * 2 ** attempt));
    }
  }
  throw lastError;
}

async function download(url: string, dest: string): Promise<void> {
  await withRetries(3, async () => {
    const response = await fetch(url, { redirect: "follow" });
    if (!response.ok || !response.body) throw new Error(`download failed (${response.status})`);
    const part = `${dest}.part`;
    await pipeline(Readable.fromWeb(response.body as unknown as NodeReadableStream), createWriteStream(part));
    await rename(part, dest);
  });
}

async function putFile(url: string, file: string, contentType: string): Promise<void> {
  const body = await readFile(file);
  await withRetries(3, async () => {
    const response = await fetch(url, { method: "PUT", headers: { "Content-Type": contentType }, body });
    if (!response.ok) throw new Error(`upload failed (${response.status}): ${(await response.text()).slice(0, 300)}`);
  });
}

async function mapLimit<T, R>(items: T[], limit: number, worker: (item: T, index: number) => Promise<R>): Promise<R[]> {
  const results: R[] = new Array(items.length);
  let next = 0;
  async function run() {
    while (next < items.length) {
      const index = next++;
      results[index] = await worker(items[index], index);
    }
  }
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, run));
  return results;
}

/**
 * Copies a job's media into `public/_media/<key>/` inside the bundle, so the
 * composition reads local files (SANDBOX_LOCAL_ASSET_PREFIX) and no frame
 * downloads anything from storage. Best-effort per file, as in the sandbox:
 * a file that fails keeps its remote URL.
 */
async function prepareMedia(key: string, input: RenderWorkerInput) {
  const relDir = `_media/${key}`;
  const absDir = path.join(bundleDir, "public", "_media", key);
  await mkdir(absDir, { recursive: true });
  const copied = new Set<string>();
  const previewsStored: RenderWorkerStillsResponse["previewsStored"] = [];

  await mapLimit(input.media, 3, async (job) => {
    if (!SAFE_FILE.test(job.file)) return;
    const dest = path.join(absDir, job.file);
    try {
      if (!job.preview) {
        await download(job.url, dest);
        copied.add(job.file);
        return;
      }
      // A large video with no small copy yet: make one, store it, render from it.
      const source = `${dest}.src`;
      await download(job.url, source);
      try {
        const edge = PREVIEW_COPY_MAX_EDGE;
        await execFileAsync(ffmpegPath(), [
          "-y", "-hide_banner", "-loglevel", "error", "-i", source,
          "-vf", `scale='if(gt(iw,ih),min(${edge},iw),-2)':'if(gt(iw,ih),-2,min(${edge},ih))'`,
          "-c:v", "libx264", "-preset", "veryfast", "-crf", "28", "-pix_fmt", "yuv420p",
          "-c:a", "aac", "-b:a", "96k", "-movflags", "+faststart", `${dest}.part.mp4`,
        ], { maxBuffer: 4 * 1024 * 1024 });
        await rename(`${dest}.part.mp4`, dest);
        await rm(source, { force: true });
        copied.add(job.file);
        await putFile(job.preview.putUrl, dest, "video/mp4");
        previewsStored.push({ assetId: job.preview.assetId, sizeBytes: (await stat(dest)).size });
      } catch (error) {
        log(`preview copy for ${job.preview.assetId} failed; using the original`, errorMessage(error));
        await rm(`${dest}.part.mp4`, { force: true });
        if (!copied.has(job.file)) {
          await rename(source, dest);
          copied.add(job.file);
        }
      }
    } catch (error) {
      log(`could not fetch ${job.assetIds[0]}`, errorMessage(error));
    }
  });

  return {
    inputProps: {
      document: input.document,
      assets: localizeAssetMap(input.assets, input.media, copied, relDir),
    } satisfies CreativeRemotionInputProps,
    previewsStored,
    cleanup: () => rm(absDir, { recursive: true, force: true }),
  };
}

// ── Renders ───────────────────────────────────────────────────────────────

interface RenderJob extends RenderWorkerRenderStatus {
  request: RenderWorkerRenderRequest | null;
  cancel: ReturnType<typeof makeCancelSignal>;
  cancelled: boolean;
  finishedAt?: number;
}

const renders = new Map<string, RenderJob>();
const queue: RenderJob[] = [];
let activeRenders = 0;

function publicStatus(job: RenderJob): RenderWorkerRenderStatus {
  const { id, status, progress, stage, error, sizeBytes, contentType } = job;
  return { id, status, progress, stage, ...(error ? { error } : {}), ...(sizeBytes ? { sizeBytes, contentType } : {}) };
}

function pump() {
  while (activeRenders < MAX_RENDERS && queue.length > 0) {
    const job = queue.shift()!;
    activeRenders += 1;
    void runRender(job).finally(() => {
      activeRenders -= 1;
      pump();
    });
  }
}

async function notify(url: string | undefined) {
  if (!url) return;
  await withRetries(3, async () => {
    const response = await fetch(url, { method: "POST", signal: AbortSignal.timeout(60_000) });
    if (response.status >= 500) throw new Error(`callback answered ${response.status}`);
  }).catch((error) => log("callback failed", errorMessage(error)));
}

async function runRender(job: RenderJob) {
  const request = job.request!;
  const output = path.join(TMP, `${job.id}.mp4`);
  let media: Awaited<ReturnType<typeof prepareMedia>> | null = null;
  const started = Date.now();
  try {
    job.status = "rendering";
    job.stage = "downloading-media";
    job.progress = 0.01;
    media = await prepareMedia(job.id, request);
    if (job.cancelled) throw new Error("Render cancelled.");

    job.stage = "selecting-composition";
    job.progress = 0.02;
    const composition = await selectComposition({
      serveUrl: bundleDir,
      id: CREATIVE_REMOTION_COMPOSITION_ID,
      inputProps: media.inputProps,
      chromiumOptions: CHROMIUM,
      browserExecutable: BROWSER_EXECUTABLE,
      timeoutInMilliseconds: FRAME_TIMEOUT_MS,
    });

    job.stage = "rendering";
    const { options } = request;
    await renderMedia({
      composition,
      serveUrl: bundleDir,
      codec: "h264",
      outputLocation: output,
      inputProps: media.inputProps,
      ...(options.frameRange ? { frameRange: options.frameRange } : {}),
      scale: options.scale,
      ...(options.crf === undefined ? {} : { crf: options.crf }),
      jpegQuality: options.jpegQuality,
      concurrency: RENDER_CONCURRENCY,
      chromiumOptions: CHROMIUM,
      browserExecutable: BROWSER_EXECUTABLE,
      timeoutInMilliseconds: FRAME_TIMEOUT_MS,
      cancelSignal: job.cancel.cancelSignal,
      onProgress: ({ progress }) => {
        job.progress = 0.03 + progress * 0.92;
      },
    });

    job.stage = "uploading";
    job.progress = 0.96;
    const size = (await stat(output)).size;
    if (size <= 0) throw new Error("Renderer produced an empty file");
    await putFile(request.putUrl, output, "video/mp4");

    job.status = "completed";
    job.stage = "done";
    job.progress = 1;
    job.sizeBytes = size;
    job.contentType = "video/mp4";
    log(`render ${job.id} done in ${Math.round((Date.now() - started) / 1000)}s (${size} bytes)`);
  } catch (error) {
    job.status = "failed";
    job.stage = "error";
    job.error = job.cancelled ? "Render cancelled." : errorMessage(error).slice(0, 4000);
    log(`render ${job.id} failed`, job.error);
  } finally {
    job.finishedAt = Date.now();
    job.request = null;
    await media?.cleanup().catch(() => undefined);
    await rm(output, { force: true }).catch(() => undefined);
    await notify(request.callbackUrl);
  }
}

function startRender(request: RenderWorkerRenderRequest): RenderJob {
  const job: RenderJob = {
    id: randomUUID(),
    status: "queued",
    progress: 0,
    stage: "queued",
    request,
    cancel: makeCancelSignal(),
    cancelled: false,
  };
  renders.set(job.id, job);
  queue.push(job);
  log(`render ${job.id} queued (${queue.length} waiting, ${activeRenders} running)`);
  pump();
  return job;
}

function cancelRender(job: RenderJob) {
  if (job.status === "completed" || job.status === "failed") return;
  job.cancelled = true;
  const queued = queue.indexOf(job);
  if (queued >= 0) {
    queue.splice(queued, 1);
    job.status = "failed";
    job.stage = "error";
    job.error = "Render cancelled.";
    job.finishedAt = Date.now();
    job.request = null;
    return;
  }
  job.cancel.cancel();
}

setInterval(() => {
  const cutoff = Date.now() - KEEP_FINISHED_MS;
  for (const [id, job] of renders) if (job.finishedAt && job.finishedAt < cutoff) renders.delete(id);
}, 10 * 60 * 1000).unref();

// ── Stills ────────────────────────────────────────────────────────────────

async function renderStills(request: RenderWorkerStillsRequest): Promise<RenderWorkerStillsResponse> {
  const media = await prepareMedia(`stills-${randomUUID()}`, request);
  // One browser for the whole batch; each still is a tab in it.
  const browser = await openBrowser("chrome", { chromiumOptions: CHROMIUM, browserExecutable: BROWSER_EXECUTABLE });
  try {
    const composition = await selectComposition({
      serveUrl: bundleDir,
      id: CREATIVE_REMOTION_COMPOSITION_ID,
      inputProps: media.inputProps,
      puppeteerInstance: browser,
      timeoutInMilliseconds: FRAME_TIMEOUT_MS,
    });
    const frames = await mapLimit(request.frames, CPUS, async (frame) => {
      const { buffer } = await renderStill({
        composition,
        serveUrl: bundleDir,
        frame,
        inputProps: media.inputProps,
        imageFormat: "png",
        puppeteerInstance: browser,
        timeoutInMilliseconds: FRAME_TIMEOUT_MS,
      });
      if (!buffer || buffer.byteLength <= 0) throw new Error("Renderer produced an empty frame");
      return { frame, png: buffer.toString("base64") };
    });
    return { frames, previewsStored: media.previewsStored };
  } finally {
    await browser.close({ silent: true }).catch(() => undefined);
    await media.cleanup().catch(() => undefined);
  }
}

// ── HTTP ──────────────────────────────────────────────────────────────────

function send(res: ServerResponse, status: number, body: unknown) {
  const text = JSON.stringify(body);
  res.writeHead(status, { "Content-Type": "application/json", "Content-Length": Buffer.byteLength(text) });
  res.end(text);
}

function authorized(req: IncomingMessage): boolean {
  const given = Buffer.from(req.headers.authorization ?? "");
  const expected = Buffer.from(`Bearer ${SECRET}`);
  return given.length === expected.length && timingSafeEqual(given, expected);
}

async function readJson<T>(req: IncomingMessage): Promise<T> {
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of req) {
    size += (chunk as Buffer).byteLength;
    if (size > MAX_BODY_BYTES) throw Object.assign(new Error("Request body too large"), { status: 413 });
    chunks.push(chunk as Buffer);
  }
  try {
    return JSON.parse(Buffer.concat(chunks).toString("utf8")) as T;
  } catch {
    throw Object.assign(new Error("Request body is not JSON"), { status: 400 });
  }
}

function isInput(value: unknown): value is RenderWorkerInput {
  const body = value as Partial<RenderWorkerInput> | null;
  return Boolean(body && typeof body.document === "object" && typeof body.assets === "object" && Array.isArray(body.media));
}

async function handle(req: IncomingMessage, res: ServerResponse) {
  const url = new URL(req.url ?? "/", "http://worker");
  if (!authorized(req)) return send(res, 401, { error: "Unauthorized" });

  if (req.method === "GET" && url.pathname === "/health") {
    const health: RenderWorkerHealth = { ok: true, cpus: CPUS, activeRenders, queuedRenders: queue.length };
    return send(res, 200, health);
  }

  if (req.method === "POST" && url.pathname === "/renders") {
    const body = await readJson<RenderWorkerRenderRequest>(req);
    if (!isInput(body) || typeof body.putUrl !== "string" || !body.options) {
      return send(res, 400, { error: "document, assets, media, options and putUrl are required" });
    }
    return send(res, 202, { id: startRender(body).id });
  }

  const renderMatch = url.pathname.match(/^\/renders\/([0-9a-f-]{36})$/);
  if (renderMatch) {
    const job = renders.get(renderMatch[1]);
    if (!job) return send(res, 404, { error: "Unknown render" });
    if (req.method === "GET") return send(res, 200, publicStatus(job));
    if (req.method === "DELETE") {
      cancelRender(job);
      return send(res, 200, publicStatus(job));
    }
  }

  if (req.method === "POST" && url.pathname === "/stills") {
    const body = await readJson<RenderWorkerStillsRequest>(req);
    if (!isInput(body) || !Array.isArray(body.frames) || body.frames.length === 0 || !body.frames.every(Number.isInteger)) {
      return send(res, 400, { error: "document, assets, media and frames are required" });
    }
    return send(res, 200, await renderStills(body));
  }

  return send(res, 404, { error: "Not found" });
}

async function main() {
  if (SECRET.length < 16) {
    throw new Error("Set RENDER_WORKER_SECRET to a random string of at least 16 characters.");
  }
  await mkdir(TMP, { recursive: true });
  if (BROWSER_EXECUTABLE) {
    log(`using browser ${BROWSER_EXECUTABLE}`);
  } else {
    log("making sure Chrome Headless Shell is installed");
    await ensureBrowser();
  }
  bundleDir = await prepareBundle();

  createServer((req, res) => {
    handle(req, res).catch((error) => {
      const status = (error as { status?: number }).status ?? 500;
      log(`${req.method} ${req.url} failed`, errorMessage(error));
      if (!res.headersSent) send(res, status, { error: errorMessage(error) });
      else res.end();
    });
  })
    .on("listening", () => log(`listening on :${PORT} (${CPUS} CPUs, ${MAX_RENDERS} render(s) at once, ${RENDER_CONCURRENCY} tabs each)`))
    .listen(PORT);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
