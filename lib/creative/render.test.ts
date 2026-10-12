import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createCanonicalCreativeFixture } from "./fixtures";

const uploadAnyBytes = vi.fn();
const renderStillOnVercel = vi.fn();
const renderMediaOnVercel = vi.fn();
const sandboxCreate = vi.fn();
const sandboxGet = vi.fn();
const sandboxStop = vi.fn();
const readFile = vi.fn();
const sharpFactory = vi.fn();

vi.mock("../storage", () => ({
  uploadAnyBytes: (...args: unknown[]) => uploadAnyBytes(...args),
  mediaUrl: async (key: string) => `https://app.example.com/media/${key}`,
}));
const getObjectText = vi.fn();
const headObject = vi.fn();
const presignPut = vi.fn(async () => "https://storage.example.com/put");
vi.mock("../b2", () => ({
  getObjectText: (...args: unknown[]) => getObjectText(...args),
  headObject: (...args: unknown[]) => headObject(...args),
  presignPut: (...args: unknown[]) => presignPut(...(args as [])),
}));
vi.mock("@remotion/vercel", () => ({
  renderStillOnVercel: (...args: unknown[]) => renderStillOnVercel(...args),
  renderMediaOnVercel: (...args: unknown[]) => renderMediaOnVercel(...args),
}));
vi.mock("@vercel/sandbox", () => ({
  Sandbox: { create: (...args: unknown[]) => sandboxCreate(...args), get: (...args: unknown[]) => sandboxGet(...args) },
}));
vi.mock("sharp", () => ({ default: (...args: unknown[]) => sharpFactory(...args) }));

const SNAPSHOT_KEY = "_system/render-snapshots/deployment-1.json";

function pngBytes(marker: number) {
  return new Uint8Array([0x89, 0x50, 0x4e, 0x47, marker]);
}

/** What the mocked sharp pipeline "encodes" to: a WebP header and a marker. */
const WEBP_BYTES = Buffer.from([0x52, 0x49, 0x46, 0x46, 0x57, 0x45, 0x42, 0x50]);

function sharpPipeline() {
  const pipeline = {
    resize: vi.fn(),
    composite: vi.fn(),
    png: vi.fn(),
    webp: vi.fn(),
    toBuffer: vi.fn(async () => WEBP_BYTES),
  };
  for (const step of ["resize", "composite", "png", "webp"] as const) pipeline[step].mockReturnValue(pipeline);
  return pipeline;
}

async function importAdapter() {
  const module = await import("./render");
  return new module.RemotionVercelCreativeRenderAdapter();
}

describe("creative still-frame render boundary", () => {
  beforeEach(() => {
    vi.resetModules();
    uploadAnyBytes.mockReset();
    renderStillOnVercel.mockReset();
    renderMediaOnVercel.mockReset();
    sandboxCreate.mockReset();
    sandboxGet.mockReset();
    sandboxStop.mockReset();
    readFile.mockReset();
    sharpFactory.mockReset();

    process.env.VERCEL_DEPLOYMENT_ID = "deployment-1";
    getObjectText.mockReset();
    getObjectText.mockImplementation(async (key: string) => {
      expect(key).toBe(SNAPSHOT_KEY);
      return JSON.stringify({ snapshotId: "snap-1" });
    });

    sandboxCreate.mockResolvedValue({ fs: { readFile }, stop: sandboxStop, vcpus: 4 });
    readFile.mockImplementation(async () => pngBytes(1));
    renderStillOnVercel.mockImplementation(async ({ outputFile }: { outputFile: string }) => ({
      sandboxFilePath: outputFile,
      contentType: "image/png",
    }));
    uploadAnyBytes.mockImplementation(async (_bytes: Uint8Array, key: string) => `https://cdn.example.com/${key}`);
    sharpFactory.mockImplementation(() => sharpPipeline());
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("renders an exact frame through the final-render composition and input props", async () => {
    const adapter = await importAdapter();
    const document = createCanonicalCreativeFixture();
    const assets = { "fixture-background": { url: "https://cdn.example.com/bg.png", mimeType: "image/png" } };

    const result = await adapter.renderFrame({ document, assets, timeMs: 1500 });

    expect(renderStillOnVercel).toHaveBeenCalledTimes(1);
    const call = renderStillOnVercel.mock.calls[0][0];
    expect(call.compositionId).toBe("StudioCreative");
    expect(call.inputProps).toEqual({ document, assets });
    expect(call.frame).toBe(45);
    expect(call.imageFormat).toBe("png");

    expect(result).toEqual({
      bytes: new Uint8Array(WEBP_BYTES),
      contentType: "image/webp",
      sizeBytes: WEBP_BYTES.byteLength,
      // The lossless render is kept for pixel measurement, untouched.
      png: pngBytes(1),
      renderer: "remotion-vercel",
      frame: 45,
      timeMs: 1500,
    });
    expect(sandboxStop).toHaveBeenCalledTimes(1);
  });

  it("restores the same snapshot the MP4 renderer uses", async () => {
    const adapter = await importAdapter();
    await adapter.renderFrame({ document: createCanonicalCreativeFixture(), assets: {}, timeMs: 0 });
    expect(sandboxCreate).toHaveBeenCalledWith(
      expect.objectContaining({ source: { type: "snapshot", snapshotId: "snap-1" } }),
    );
  });

  it("gives the sandbox enough cores to render in parallel", async () => {
    const adapter = await importAdapter();
    await adapter.renderFrame({ document: createCanonicalCreativeFixture(), assets: {}, timeMs: 0 });
    const params = sandboxCreate.mock.calls[0][0] as { resources?: { vcpus: number }; timeout?: number };
    expect(params.resources?.vcpus).toBeGreaterThan(1);
    // The sandbox has to outlive the function driving it (300s on Hobby); a
    // sandbox that self-terminates first fails the render with an unreadable
    // transport error. But a preview's sandbox must not outlive it by much:
    // a function killed at its limit never reaches the `finally` that stops it.
    expect(params.timeout ?? 0).toBeGreaterThan(300 * 1000);
    expect(params.timeout ?? 0).toBeLessThanOrEqual(10 * 60 * 1000);
  });

  it("gives a detached MP4 export the full sandbox lifetime", async () => {
    const runCommand = vi.fn(async () => ({ cmdId: "cmd-1" }));
    sandboxCreate.mockResolvedValue({ name: "sandbox-1", fs: { readFile, writeFile: vi.fn() }, runCommand, stop: sandboxStop, vcpus: 8 });
    renderMediaOnVercel.mockImplementation(async ({ sandbox }: any) => {
      await sandbox.runCommand({ cmd: "node", args: ["render-video.mjs"], detached: true });
      return { sandboxFilePath: "/tmp/creative-output.mp4", contentType: "video/mp4" };
    });
    const adapter = await importAdapter();
    await adapter.startDetached({ document: createCanonicalCreativeFixture(), assets: {}, outputKey: "u/renders/job.mp4" });
    const params = sandboxCreate.mock.calls[0][0] as { timeout?: number };
    expect(params.timeout).toBe(45 * 60 * 1000);
  });

  it("falls back to the default allocation rather than failing when vCPUs are refused", async () => {
    sandboxCreate.mockReset();
    sandboxCreate.mockRejectedValueOnce(new Error("vcpus not available on this plan"));
    sandboxCreate.mockResolvedValue({ fs: { readFile }, stop: sandboxStop, vcpus: 2 });
    const adapter = await importAdapter();
    await adapter.renderFrame({ document: createCanonicalCreativeFixture(), assets: {}, timeMs: 0 });
    expect(sandboxCreate).toHaveBeenCalledTimes(2);
    expect(sandboxCreate.mock.calls[1][0]).not.toHaveProperty("resources");
  });

  it("scales concurrency to the cores the sandbox was granted, not the ones requested", async () => {
    // A refused resource request leaves a two-core sandbox; six browser workers
    // on two cores thrash rather than render.
    sandboxCreate.mockReset();
    sandboxCreate.mockRejectedValueOnce(new Error("vcpus not available on this plan"));
    sandboxCreate.mockResolvedValue({ fs: { readFile }, stop: sandboxStop, vcpus: 2 });
    renderMediaOnVercel.mockResolvedValue({ sandboxFilePath: "/tmp/creative-output.mp4", contentType: "video/mp4" });
    readFile.mockResolvedValue(new Uint8Array([1, 2, 3, 4]));
    uploadAnyBytes.mockResolvedValue("https://cdn.example.com/render.mp4");
    const adapter = await importAdapter();
    await adapter.render({ document: createCanonicalCreativeFixture(), assets: {}, outputKey: "user-1/renders/job.mp4" });
    const options = renderMediaOnVercel.mock.calls[0][0] as { concurrency?: number };
    expect(options.concurrency).toBe(1);
  });

  it("forwards a resolved draft timeline window to Remotion", async () => {
    renderMediaOnVercel.mockResolvedValue({ sandboxFilePath: "/tmp/creative-output.mp4", contentType: "video/mp4" });
    readFile.mockResolvedValue(new Uint8Array([1, 2, 3, 4]));
    uploadAnyBytes.mockResolvedValue("https://cdn.example.com/render.mp4");
    const adapter = await importAdapter();
    await adapter.render({ document: createCanonicalCreativeFixture(), assets: {}, outputKey: "user-1/renders/job.mp4", options: { startMs: 1000, endMs: 2500, quality: "draft" } });
    expect(renderMediaOnVercel).toHaveBeenCalledWith(expect.objectContaining({ frameRange: [30, 74], scale: 0.5, crf: 28, jpegQuality: 65 }));
  });

  it("renders frames in parallel and leaves headroom for the encoder", async () => {
    renderMediaOnVercel.mockResolvedValue({ sandboxFilePath: "/tmp/creative-output.mp4", contentType: "video/mp4" });
    readFile.mockResolvedValue(new Uint8Array([1, 2, 3, 4]));
    uploadAnyBytes.mockResolvedValue("https://cdn.example.com/render.mp4");
    const adapter = await importAdapter();
    await adapter.render({ document: createCanonicalCreativeFixture(), assets: {}, outputKey: "user-1/renders/job.mp4" });
    const options = renderMediaOnVercel.mock.calls[0][0] as { concurrency?: number };
    const vcpus = (sandboxCreate.mock.calls[0][0] as { resources?: { vcpus: number } }).resources?.vcpus ?? 0;
    expect(options.concurrency).toBeGreaterThan(1);
    expect(options.concurrency).toBeLessThan(vcpus);
  });

  it("launches a reconnectable detached render without waiting for all frames", async () => {
    const actualCommand = {
      cmdId: "cmd-1",
      logs: async function* () { yield { stream: "stdout", data: "later" }; },
      wait: vi.fn(async () => ({ exitCode: 0 })),
    };
    const runCommand = vi.fn(async () => actualCommand);
    sandboxCreate.mockResolvedValue({ name: "sandbox-1", fs: { readFile, writeFile: vi.fn() }, runCommand, stop: sandboxStop, extendTimeout: vi.fn(), vcpus: 8 });
    renderMediaOnVercel.mockImplementation(async ({ sandbox }: any) => {
      const command = await sandbox.runCommand({ cmd: "node", args: ["render-video.mjs", "{}"], detached: true });
      for await (const _log of command.logs()) { /* the facade must already be done */ }
      await command.wait();
      return { sandboxFilePath: "/tmp/creative-output.mp4", contentType: "application/octet-stream" };
    });
    const adapter = await importAdapter();
    const handle = await adapter.startDetached({ document: createCanonicalCreativeFixture(), assets: {}, outputKey: "renders/job.mp4" });
    expect(handle).toMatchObject({ sandboxId: "sandbox-1", cmdId: "cmd-1", outputFile: "/tmp/creative-output.mp4", outputKey: "renders/job.mp4" });
    expect(actualCommand.wait).not.toHaveBeenCalled();
    expect(sandboxStop).not.toHaveBeenCalled();
  });

  it("reconnects to finalize a detached render into R2", async () => {
    const resumedStop = vi.fn();
    sandboxGet.mockResolvedValue({
      status: "running",
      getCommand: vi.fn(async () => ({ exitCode: 0, stderr: vi.fn(async () => "") })),
      fs: { readFile: vi.fn(async (path: string) => path.endsWith("progress.json") ? JSON.stringify({ stage: "done", overallProgress: 1, size: 4, contentType: "video/mp4" }) : new Uint8Array([1, 2, 3, 4])) },
      stop: resumedStop,
    });
    uploadAnyBytes.mockResolvedValue("https://cdn.example.com/renders/job.mp4");
    const adapter = await importAdapter();
    const result = await adapter.pollDetached({ sandboxId: "sandbox-1", cmdId: "cmd-1", outputFile: "/tmp/creative-output.mp4", outputKey: "renders/job.mp4", startedAtMs: 1000 });
    expect(result).toMatchObject({ status: "completed", progress: 1, url: "https://cdn.example.com/renders/job.mp4", sizeBytes: 4 });
    expect(resumedStop).not.toHaveBeenCalled();
    await adapter.stopDetached({ sandboxId: "sandbox-1", cmdId: "cmd-1", outputFile: "/tmp/creative-output.mp4", outputKey: "renders/job.mp4", startedAtMs: 1000 });
    expect(resumedStop).toHaveBeenCalledOnce();
  });

  const HANDLE = { sandboxId: "sandbox-1", cmdId: "cmd-1", outputFile: "/tmp/creative-output.mp4", outputKey: "u/renders/job.mp4", startedAtMs: 1000 };

  it("never wakes a stopped sandbox, and reads a stored output as completed", async () => {
    const getCommand = vi.fn();
    sandboxGet.mockResolvedValue({ status: "stopped", getCommand, fs: { readFile: vi.fn() }, stop: vi.fn() });
    headObject.mockResolvedValue({ size: 1234, contentType: "video/mp4" });
    const adapter = await importAdapter();
    const result = await adapter.pollDetached(HANDLE);
    expect(sandboxGet).toHaveBeenCalledWith(expect.objectContaining({ name: "sandbox-1", resume: false }));
    expect(getCommand).not.toHaveBeenCalled();
    expect(result).toMatchObject({ status: "completed", sizeBytes: 1234 });
  });

  it("fails a stopped sandbox that stored nothing without waking it", async () => {
    const stop = vi.fn();
    sandboxGet.mockResolvedValue({ status: "stopped", getCommand: vi.fn(), fs: { readFile: vi.fn() }, stop });
    headObject.mockResolvedValue(null);
    const adapter = await importAdapter();
    await expect(adapter.pollDetached(HANDLE)).resolves.toMatchObject({ status: "failed" });
    await adapter.stopDetached(HANDLE);
    expect(stop).not.toHaveBeenCalled();
  });

  it("fails and stops a render the watchdog marked as stalled", async () => {
    const stop = vi.fn();
    sandboxGet.mockResolvedValue({
      status: "running",
      getCommand: vi.fn(async () => ({ exitCode: null, stderr: vi.fn(async () => "") })),
      fs: {
        readFile: vi.fn(async (path: string) => {
          if (path.endsWith("progress.json")) return JSON.stringify({ stage: "rendering", overallProgress: 0.4 });
          if (path === "/tmp/studio-render-stalled") return "stalled\n";
          throw new Error("ENOENT");
        }),
      },
      stop,
    });
    const adapter = await importAdapter();
    const result = await adapter.pollDetached(HANDLE);
    expect(result).toMatchObject({ status: "failed", progress: 0.4 });
    expect((result as { error: string }).error).toMatch(/stopped making progress/);
    expect(stop).toHaveBeenCalledOnce();
  });

  it("keeps a healthy render running", async () => {
    sandboxGet.mockResolvedValue({
      status: "running",
      getCommand: vi.fn(async () => ({ exitCode: null, stderr: vi.fn(async () => "") })),
      fs: {
        readFile: vi.fn(async (path: string) => {
          if (path.endsWith("progress.json")) return JSON.stringify({ stage: "rendering", overallProgress: 0.4 });
          throw new Error("ENOENT");
        }),
      },
      stop: vi.fn(),
    });
    const adapter = await importAdapter();
    await expect(adapter.pollDetached(HANDLE)).resolves.toMatchObject({ status: "rendering", progress: 0.4 });
  });

  it("records the sandbox before launching, and hands the uploader the callback URL", async () => {
    const runCommand = vi.fn(async () => ({ cmdId: "cmd-1" }));
    sandboxCreate.mockResolvedValue({ name: "sandbox-9", fs: { readFile, writeFile: vi.fn() }, runCommand, stop: sandboxStop, vcpus: 8 });
    const order: string[] = [];
    renderMediaOnVercel.mockImplementation(async ({ sandbox }: any) => {
      order.push("render");
      await sandbox.runCommand({ cmd: "node", args: ["render-video.mjs"], detached: true });
      return { sandboxFilePath: "/tmp/creative-output.mp4", contentType: "video/mp4" };
    });
    const adapter = await importAdapter();
    await adapter.startDetached({
      document: createCanonicalCreativeFixture(), assets: {}, outputKey: "u/renders/job.mp4",
      callbackUrl: "https://app.example.com/api/creative/render/job/callback?token=t",
      onSandboxCreated: async (name) => { order.push(`recorded:${name}`); },
    });
    expect(order).toEqual(["recorded:sandbox-9", "render"]);
    const uploader = (runCommand.mock.calls as unknown as Array<[{ cmd: string; env?: Record<string, string> }]>)
      .map(([command]) => command)
      .find((command) => command.cmd === "bash");
    expect(uploader?.env?.CB).toBe("https://app.example.com/api/creative/render/job/callback?token=t");
    expect(Number(uploader?.env?.STALL)).toBeGreaterThan(0);
  });

  it("stops the sandbox when recording it fails, before any render starts", async () => {
    sandboxCreate.mockResolvedValue({ name: "sandbox-9", fs: { readFile }, runCommand: vi.fn(), stop: sandboxStop, vcpus: 8 });
    const adapter = await importAdapter();
    await expect(adapter.startDetached({
      document: createCanonicalCreativeFixture(), assets: {}, outputKey: "u/renders/job.mp4",
      onSandboxCreated: async () => { throw new Error("db down"); },
    })).rejects.toThrow(/db down/);
    expect(renderMediaOnVercel).not.toHaveBeenCalled();
    expect(sandboxStop).toHaveBeenCalledOnce();
  });

  it("rejects an out-of-range timestamp before restoring a sandbox", async () => {
    const adapter = await importAdapter();
    await expect(
      adapter.renderFrame({ document: createCanonicalCreativeFixture(), assets: {}, timeMs: 8000 }),
    ).rejects.toThrow(/rendered duration/i);
    expect(sandboxCreate).not.toHaveBeenCalled();
    expect(renderStillOnVercel).not.toHaveBeenCalled();
  });

  it("rejects an empty rendered frame and still stops the sandbox", async () => {
    readFile.mockResolvedValue(new Uint8Array());
    const adapter = await importAdapter();
    await expect(
      adapter.renderFrame({ document: createCanonicalCreativeFixture(), assets: {}, timeMs: 0 }),
    ).rejects.toThrow(/empty frame/i);
    expect(sandboxStop).toHaveBeenCalledTimes(1);
  });

  /**
   * Previews are looked at once. Storing them left a multi-megabyte PNG in the
   * bucket for every frame an assistant ever inspected.
   */
  it("never writes a preview frame or contact sheet to storage", async () => {
    const adapter = await importAdapter();
    await adapter.renderFrames({
      document: createCanonicalCreativeFixture(),
      assets: {},
      timesMs: [0, 2000],
      contactSheet: true,
    });
    expect(uploadAnyBytes).not.toHaveBeenCalled();
  });

  it("sends previews as WebP no larger than the model can use", async () => {
    const pipelines: ReturnType<typeof sharpPipeline>[] = [];
    sharpFactory.mockImplementation(() => {
      const pipeline = sharpPipeline();
      pipelines.push(pipeline);
      return pipeline;
    });
    const { PREVIEW_MAX_EDGE } = await import("./render");
    const adapter = await importAdapter();
    await adapter.renderFrame({ document: createCanonicalCreativeFixture(), assets: {}, timeMs: 0 });

    const encoder = pipelines.find((pipeline) => pipeline.webp.mock.calls.length > 0);
    expect(encoder?.webp).toHaveBeenCalledWith(expect.objectContaining({ quality: expect.any(Number) }));
    expect(encoder?.resize).toHaveBeenCalledWith(PREVIEW_MAX_EDGE, PREVIEW_MAX_EDGE, {
      fit: "inside",
      withoutEnlargement: true,
    });
  });

  it("renders a multi-frame batch from one restored sandbox", async () => {
    const adapter = await importAdapter();
    const result = await adapter.renderFrames({
      document: createCanonicalCreativeFixture(),
      assets: {},
      timesMs: [0, 2000, 4000],
    });

    expect(sandboxCreate).toHaveBeenCalledTimes(1);
    expect(renderStillOnVercel).toHaveBeenCalledTimes(3);
    expect(result.frames.map((frame) => frame.frame)).toEqual([0, 60, 120]);
    expect(result.frames.map((frame) => frame.timeMs)).toEqual([0, 2000, 4000]);
    expect(result.frames.every((frame) => frame.contentType === "image/webp")).toBe(true);
    expect(result.contactSheet).toBeUndefined();
    expect(sandboxStop).toHaveBeenCalledTimes(1);
    expect(
      renderStillOnVercel.mock.calls.map((call) => (call[0] as { outputFile: string }).outputFile),
    ).toEqual(["/tmp/creative-frame-0.png", "/tmp/creative-frame-1.png", "/tmp/creative-frame-2.png"]);
  });

  it("composites a deterministic contact sheet when one is requested", async () => {
    const pipeline = sharpPipeline();
    sharpFactory.mockImplementation(() => pipeline);
    const { resize, composite } = pipeline;

    const adapter = await importAdapter();
    const result = await adapter.renderFrames({
      document: createCanonicalCreativeFixture(),
      assets: {},
      timesMs: [0, 4000],
      contactSheet: true,
    });

    expect(result.contactSheet).toEqual({
      bytes: new Uint8Array(WEBP_BYTES),
      contentType: "image/webp",
      sizeBytes: WEBP_BYTES.byteLength,
      columns: 2,
      rows: 1,
      width: 1920,
      height: 1202,
    });
    // 1080x1350 canvas, two columns inside the 1920px sheet width.
    expect(resize).toHaveBeenCalledWith(936, 1170, { fit: "fill" });
    expect(composite).toHaveBeenCalledTimes(1);
    expect(composite.mock.calls[0][0].map((tile: { left: number; top: number }) => [tile.left, tile.top])).toEqual([
      [16, 16],
      [968, 16],
    ]);
  });
});
