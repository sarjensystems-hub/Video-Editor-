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
}));
vi.mock("@remotion/vercel", () => ({
  renderStillOnVercel: (...args: unknown[]) => renderStillOnVercel(...args),
  renderMediaOnVercel: (...args: unknown[]) => renderMediaOnVercel(...args),
}));
vi.mock("@vercel/sandbox", () => ({
  Sandbox: { create: (...args: unknown[]) => sandboxCreate(...args), get: (...args: unknown[]) => sandboxGet(...args) },
}));
vi.mock("sharp", () => ({ default: (...args: unknown[]) => sharpFactory(...args) }));

const SNAPSHOT_URL = "https://cdn.example.com/creative-render-snapshots/deployment-1.json";

function pngBytes(marker: number) {
  return new Uint8Array([0x89, 0x50, 0x4e, 0x47, marker]);
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
    process.env.R2_PUBLIC_BASE_URL = "https://cdn.example.com/";

    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string) => {
        expect(url).toBe(SNAPSHOT_URL);
        return { ok: true, json: async () => ({ snapshotId: "snap-1" }) } as unknown as Response;
      }),
    );

    sandboxCreate.mockResolvedValue({ fs: { readFile }, stop: sandboxStop, vcpus: 8 });
    readFile.mockImplementation(async () => pngBytes(1));
    renderStillOnVercel.mockImplementation(async ({ outputFile }: { outputFile: string }) => ({
      sandboxFilePath: outputFile,
      contentType: "image/png",
    }));
    uploadAnyBytes.mockImplementation(async (_bytes: Uint8Array, key: string) => `https://cdn.example.com/${key}`);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("renders an exact frame through the final-render composition and input props", async () => {
    const adapter = await importAdapter();
    const document = createCanonicalCreativeFixture();
    const assets = { "fixture-background": { url: "https://cdn.example.com/bg.png", mimeType: "image/png" } };

    const result = await adapter.renderFrame({
      document,
      assets,
      timeMs: 1500,
      outputKey: "creative-previews/user-1/project-1/rev-1-45.png",
    });

    expect(renderStillOnVercel).toHaveBeenCalledTimes(1);
    const call = renderStillOnVercel.mock.calls[0][0];
    expect(call.compositionId).toBe("StudioCreative");
    expect(call.inputProps).toEqual({ document, assets });
    expect(call.frame).toBe(45);
    expect(call.imageFormat).toBe("png");

    expect(result).toEqual({
      url: "https://cdn.example.com/creative-previews/user-1/project-1/rev-1-45.png",
      contentType: "image/png",
      sizeBytes: 5,
      renderer: "remotion-vercel",
      frame: 45,
      timeMs: 1500,
    });
    expect(uploadAnyBytes).toHaveBeenCalledWith(
      expect.any(Uint8Array),
      "creative-previews/user-1/project-1/rev-1-45.png",
      "image/png",
    );
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
    // The sandbox has to outlive the function driving it; a sandbox that
    // self-terminates first fails the render with an unreadable transport error.
    expect(params.timeout ?? 0).toBeGreaterThan(800 * 1000);
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
    await adapter.render({ document: createCanonicalCreativeFixture(), assets: {} });
    const options = renderMediaOnVercel.mock.calls[0][0] as { concurrency?: number };
    expect(options.concurrency).toBe(1);
  });

  it("forwards a resolved draft timeline window to Remotion", async () => {
    renderMediaOnVercel.mockResolvedValue({ sandboxFilePath: "/tmp/creative-output.mp4", contentType: "video/mp4" });
    readFile.mockResolvedValue(new Uint8Array([1, 2, 3, 4]));
    uploadAnyBytes.mockResolvedValue("https://cdn.example.com/render.mp4");
    const adapter = await importAdapter();
    await adapter.render({ document: createCanonicalCreativeFixture(), assets: {}, options: { startMs: 1000, endMs: 2500, quality: "draft" } });
    expect(renderMediaOnVercel).toHaveBeenCalledWith(expect.objectContaining({ frameRange: [30, 74], scale: 0.5, crf: 28, jpegQuality: 65 }));
  });

  it("renders frames in parallel and leaves headroom for the encoder", async () => {
    renderMediaOnVercel.mockResolvedValue({ sandboxFilePath: "/tmp/creative-output.mp4", contentType: "video/mp4" });
    readFile.mockResolvedValue(new Uint8Array([1, 2, 3, 4]));
    uploadAnyBytes.mockResolvedValue("https://cdn.example.com/render.mp4");
    const adapter = await importAdapter();
    await adapter.render({ document: createCanonicalCreativeFixture(), assets: {} });
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

  it("fails when a rendered frame cannot be persisted to permanent storage", async () => {
    uploadAnyBytes.mockResolvedValue(null);
    const adapter = await importAdapter();
    await expect(
      adapter.renderFrame({ document: createCanonicalCreativeFixture(), assets: {}, timeMs: 0 }),
    ).rejects.toThrow(/could not be persisted/i);
  });

  it("renders a multi-frame batch from one restored sandbox", async () => {
    const adapter = await importAdapter();
    const result = await adapter.renderFrames({
      document: createCanonicalCreativeFixture(),
      assets: {},
      timesMs: [0, 2000, 4000],
      outputKeys: ["a.png", "b.png", "c.png"],
    });

    expect(sandboxCreate).toHaveBeenCalledTimes(1);
    expect(renderStillOnVercel).toHaveBeenCalledTimes(3);
    expect(result.frames.map((frame) => frame.frame)).toEqual([0, 60, 120]);
    expect(result.frames.map((frame) => frame.timeMs)).toEqual([0, 2000, 4000]);
    expect(result.frames.map((frame) => frame.url)).toEqual([
      "https://cdn.example.com/a.png",
      "https://cdn.example.com/b.png",
      "https://cdn.example.com/c.png",
    ]);
    expect(result.contactSheet).toBeUndefined();
    expect(sandboxStop).toHaveBeenCalledTimes(1);
    expect(
      renderStillOnVercel.mock.calls.map((call) => (call[0] as { outputFile: string }).outputFile),
    ).toEqual(["/tmp/creative-frame-0.png", "/tmp/creative-frame-1.png", "/tmp/creative-frame-2.png"]);
  });

  it("composites a deterministic contact sheet when a sheet key is requested", async () => {
    const resize = vi.fn().mockReturnThis();
    const composite = vi.fn().mockReturnThis();
    const png = vi.fn().mockReturnThis();
    const toBuffer = vi.fn().mockResolvedValue(Buffer.from([1, 2, 3, 4, 5, 6]));
    sharpFactory.mockImplementation(() => ({ resize, composite, png, toBuffer }));

    const adapter = await importAdapter();
    const result = await adapter.renderFrames({
      document: createCanonicalCreativeFixture(),
      assets: {},
      timesMs: [0, 4000],
      contactSheetKey: "creative-previews/user-1/project-1/rev-1-sheet.png",
    });

    expect(result.contactSheet).toEqual({
      url: "https://cdn.example.com/creative-previews/user-1/project-1/rev-1-sheet.png",
      contentType: "image/png",
      sizeBytes: 6,
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
