import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createCanonicalCreativeFixture } from "./fixtures";
import { WORKER_RENDER_LIFETIME_MS, DETACHED_RENDER_LIFETIME_MS, isRenderJobStale } from "./render-job";

const headObject = vi.fn();
const presignPut = vi.fn(async (path: string) => `https://storage.example.com/put/${path}`);
const presignGet = vi.fn(async (path: string) => `https://storage.example.com/get/${path}`);
vi.mock("../b2", () => ({
  headObject: (...args: unknown[]) => headObject(...args),
  presignPut: (path: string) => presignPut(path),
  presignGet: (path: string) => presignGet(path),
  getObjectText: vi.fn(),
}));
vi.mock("../storage", () => ({
  mediaUrl: async (key: string) => `https://app.example.com/media/${key}`,
  uploadAnyBytes: vi.fn(),
}));
vi.mock("../storage-paths", () => ({
  storagePathFromMediaUrl: (url: string) => url.match(/^https:\/\/app\.example\.com\/media\/(.+)$/)?.[1] ?? null,
}));
vi.mock("@remotion/vercel", () => ({ renderStillOnVercel: vi.fn(), renderMediaOnVercel: vi.fn() }));
vi.mock("@vercel/sandbox", () => ({ Sandbox: { create: vi.fn(), get: vi.fn() } }));
vi.mock("sharp", () => {
  const pipeline: Record<string, unknown> = {};
  for (const step of ["resize", "composite", "png", "webp"]) pipeline[step] = () => pipeline;
  pipeline.toBuffer = async () => Buffer.from("WEBP");
  return { default: () => pipeline };
});

const fetchMock = vi.fn();

function json(status: number, body: unknown) {
  return new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });
}

const assets = {
  "fixture-background": { url: "https://app.example.com/media/u1/assets/bg.png", mimeType: "image/png", kind: "image" },
  "fixture-logo": { url: "https://cdn.example.com/logo.png", mimeType: "image/png", kind: "image" },
};

async function importWorker() {
  return import("./render-worker");
}

describe("self-hosted render worker adapter", () => {
  beforeEach(() => {
    vi.resetModules();
    fetchMock.mockReset();
    headObject.mockReset();
    vi.stubGlobal("fetch", fetchMock);
    process.env.CREATIVE_RENDER_WORKER_URL = "https://render.example.com/";
    process.env.CREATIVE_RENDER_WORKER_SECRET = "worker-secret";
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    delete process.env.CREATIVE_RENDER_WORKER_URL;
    delete process.env.CREATIVE_RENDER_WORKER_SECRET;
  });

  it("is only switched on when both the URL and the secret are set", async () => {
    const { renderWorkerConfigured } = await importWorker();
    expect(renderWorkerConfigured()).toBe(true);
    delete process.env.CREATIVE_RENDER_WORKER_SECRET;
    expect(renderWorkerConfigured()).toBe(false);
  });

  it("starts a render with signed URLs and returns a worker-prefixed handle", async () => {
    fetchMock.mockResolvedValueOnce(json(202, { id: "job-1" }));
    const onSandboxCreated = vi.fn();
    const { RemoteWorkerCreativeRenderAdapter } = await importWorker();
    const handle = await new RemoteWorkerCreativeRenderAdapter().startDetached({
      document: createCanonicalCreativeFixture(),
      assets,
      outputKey: "u1/renders/r1.mp4",
      callbackUrl: "https://app.example.com/api/creative/render/r1/callback?token=t",
      onSandboxCreated,
    });

    expect(handle).toMatchObject({ sandboxId: "worker:job-1", cmdId: "render-worker", outputKey: "u1/renders/r1.mp4" });
    expect(onSandboxCreated).toHaveBeenCalledWith("worker:job-1");
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe("https://render.example.com/renders");
    expect(init.headers.Authorization).toBe("Bearer worker-secret");
    const body = JSON.parse(init.body);
    expect(body.putUrl).toBe("https://storage.example.com/put/u1/renders/r1.mp4");
    expect(body.callbackUrl).toContain("/callback?token=t");
    expect(body.options).toMatchObject({ scale: 1, jpegQuality: 80 });
    // Our own media is signed; an external URL is passed through.
    expect(body.media.map((job: { url: string }) => job.url)).toEqual([
      "https://storage.example.com/get/u1/assets/bg.png",
      "https://cdn.example.com/logo.png",
    ]);
  });

  it("cancels the worker render when recording it fails", async () => {
    fetchMock.mockResolvedValueOnce(json(202, { id: "job-2" })).mockResolvedValueOnce(json(200, {}));
    const { RemoteWorkerCreativeRenderAdapter } = await importWorker();
    await expect(
      new RemoteWorkerCreativeRenderAdapter().startDetached({
        document: createCanonicalCreativeFixture(),
        assets,
        outputKey: "u1/renders/r2.mp4",
        onSandboxCreated: async () => {
          throw new Error("db down");
        },
      }),
    ).rejects.toThrow("db down");
    expect(fetchMock.mock.calls[1][0]).toBe("https://render.example.com/renders/job-2");
    expect(fetchMock.mock.calls[1][1].method).toBe("DELETE");
  });

  const handle = { sandboxId: "worker:job-1", cmdId: "render-worker", outputFile: "", outputKey: "u1/renders/r1.mp4", startedAtMs: Date.now() - 10_000 };

  it("maps worker progress onto the detached-render status", async () => {
    const { RemoteWorkerCreativeRenderAdapter } = await importWorker();
    const adapter = new RemoteWorkerCreativeRenderAdapter();

    fetchMock.mockResolvedValueOnce(json(200, { id: "job-1", status: "queued", progress: 0, stage: "queued" }));
    expect(await adapter.pollDetached(handle)).toMatchObject({ status: "rendering", progress: 0, phase: "queued" });

    fetchMock.mockResolvedValueOnce(json(200, { id: "job-1", status: "rendering", progress: 0.5, stage: "rendering" }));
    const rendering = await adapter.pollDetached(handle);
    expect(rendering).toMatchObject({ status: "rendering", progress: 0.5, phase: "rendering" });
    expect(rendering.status === "rendering" && rendering.estimatedCompletionMs).toBeGreaterThan(Date.now());

    fetchMock.mockResolvedValueOnce(json(200, { id: "job-1", status: "failed", progress: 0.3, stage: "error", error: "boom" }));
    expect(await adapter.pollDetached(handle)).toEqual({ status: "failed", progress: 0.3, error: "boom" });
  });

  it("reads a completed render from storage", async () => {
    fetchMock.mockResolvedValueOnce(json(200, { id: "job-1", status: "completed", progress: 1, stage: "done" }));
    headObject.mockResolvedValueOnce({ size: 1234, contentType: "video/mp4" });
    const { RemoteWorkerCreativeRenderAdapter } = await importWorker();
    expect(await new RemoteWorkerCreativeRenderAdapter().pollDetached(handle)).toEqual({
      status: "completed",
      progress: 1,
      url: "https://app.example.com/media/u1/renders/r1.mp4",
      contentType: "video/mp4",
      sizeBytes: 1234,
      renderer: "remotion-worker",
    });
  });

  it("fails a render the worker forgot, unless its output was already stored", async () => {
    const { RemoteWorkerCreativeRenderAdapter } = await importWorker();
    const adapter = new RemoteWorkerCreativeRenderAdapter();

    fetchMock.mockResolvedValueOnce(json(404, { error: "Unknown render" }));
    headObject.mockResolvedValueOnce(null);
    expect(await adapter.pollDetached(handle)).toMatchObject({ status: "failed" });

    fetchMock.mockResolvedValueOnce(json(404, { error: "Unknown render" }));
    headObject.mockResolvedValueOnce({ size: 99, contentType: "video/mp4" });
    expect(await adapter.pollDetached(handle)).toMatchObject({ status: "completed", sizeBytes: 99 });
  });

  it("throws while the worker is unreachable, so the job stays running", async () => {
    fetchMock.mockRejectedValueOnce(new TypeError("fetch failed"));
    const { RemoteWorkerCreativeRenderAdapter } = await importWorker();
    await expect(new RemoteWorkerCreativeRenderAdapter().pollDetached(handle)).rejects.toThrow(/unreachable/);
  });

  it("renders stills as WebP previews and records preview copies the worker made", async () => {
    const save = vi.fn(async () => undefined);
    const previews = {
      target: vi.fn(async (assetId: string) => ({ putUrl: `https://storage.example.com/put/${assetId}`, url: `https://app.example.com/media/p/${assetId}.mp4` })),
      save,
    };
    fetchMock.mockImplementationOnce(async (_url: string, init: { body: string }) => {
      const body = JSON.parse(init.body);
      expect(body.frames).toEqual([0, 15]);
      expect(body.media.find((job: { preview?: unknown }) => job.preview)).toMatchObject({ preview: { assetId: "clip" } });
      return json(200, {
        frames: body.frames.map((frame: number) => ({ frame, png: Buffer.from([0x89, 0x50, frame]).toString("base64") })),
        previewsStored: [{ assetId: "clip", sizeBytes: 500 }],
      });
    });
    const { RemoteWorkerCreativeRenderAdapter } = await importWorker();
    const result = await new RemoteWorkerCreativeRenderAdapter().renderFrames({
      document: createCanonicalCreativeFixture(),
      assets: { ...assets, clip: { url: "https://app.example.com/media/u1/assets/clip.mp4", kind: "video", sizeBytes: 200 * 1024 * 1024 } },
      timesMs: [0, 500],
      contactSheet: true,
      previews,
    });

    expect(result.frames.map((frame) => [frame.frame, frame.renderer, frame.contentType])).toEqual([
      [0, "remotion-worker", "image/webp"],
      [15, "remotion-worker", "image/webp"],
    ]);
    expect(Array.from(result.frames[1].png)).toEqual([0x89, 0x50, 15]);
    expect(result.contactSheet?.contentType).toBe("image/webp");
    expect(save).toHaveBeenCalledWith("clip", "https://app.example.com/media/p/clip.mp4", 500);
  });
});

describe("render routing", () => {
  beforeEach(() => vi.resetModules());

  function fakeAdapter(name: string) {
    return {
      render: vi.fn(async () => name),
      renderFrame: vi.fn(async () => name),
      renderFrames: vi.fn(async () => name),
      startDetached: vi.fn(async () => name),
      pollDetached: vi.fn(async () => name),
      stopDetached: vi.fn(async () => name),
    };
  }

  it("starts new work on the configured backend but polls a render where it started", async () => {
    const { RoutingCreativeRenderAdapter } = await import("./render");
    const vercel = fakeAdapter("vercel");
    const worker = fakeAdapter("worker");
    let useWorker = true;
    const router = new RoutingCreativeRenderAdapter(vercel as never, worker as never, () => useWorker);

    expect(await router.startDetached({} as never)).toBe("worker");
    expect(await router.renderFrames({} as never)).toBe("worker");
    useWorker = false;
    expect(await router.startDetached({} as never)).toBe("vercel");

    expect(await router.pollDetached({ sandboxId: "worker:abc" } as never)).toBe("worker");
    expect(await router.stopDetached({ sandboxId: "worker:abc" } as never)).toBe("worker");
    expect(await router.pollDetached({ sandboxId: "sbx_123" } as never)).toBe("vercel");
  });
});

describe("worker render lifetime", () => {
  it("gives worker renders hours rather than the sandbox's 45 minutes", () => {
    const startedAtMs = 0;
    const now = DETACHED_RENDER_LIFETIME_MS + 60_000;
    const running = (sandboxId: string) => ({
      status: "rendering",
      metadata: { detached_render: { sandboxId, startedAtMs } },
    });
    expect(isRenderJobStale(running("sbx_1"), now)).toBe(true);
    expect(isRenderJobStale(running("worker:1"), now)).toBe(false);
    expect(isRenderJobStale(running("worker:1"), WORKER_RENDER_LIFETIME_MS + 1)).toBe(true);
  });
});
