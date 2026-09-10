import { describe, expect, it, vi } from "vitest";
import {
  REMOTION_FILE_TRANSPORT_LOADER_PATH,
  REMOTION_FILE_TRANSPORT_LOADER_SOURCE,
  remotionSerializedConfigBytes,
  withFileBackedRemotionConfig,
} from "./remotion-sandbox-transport";

function fakeSandbox() {
  const writes: Array<{ path: string; contents: string | Uint8Array }> = [];
  const runCommand = vi.fn(async (request: unknown) => ({ request }));
  const writeFile = vi.fn(async (path: string, contents: string | Uint8Array) => {
    writes.push({ path, contents });
  });
  const sandbox = {
    vcpus: 4,
    fs: { writeFile },
    runCommand,
    stop: vi.fn(async () => undefined),
  };
  return { sandbox, writes, runCommand, writeFile };
}

describe("Remotion Vercel argv-safe config transport", () => {
  it.each(["render-video.mjs", "render-still.mjs"])(
    "moves a large %s config out of argv before process launch",
    async (worker) => {
      const { sandbox, writes, runCommand } = fakeSandbox();
      const wrapped = withFileBackedRemotionConfig(sandbox as never);
      const serializedConfig = JSON.stringify({
        inputProps: { document: "x".repeat(350_000) },
      });

      await (wrapped.runCommand as unknown as (request: unknown) => Promise<unknown>)({
        cmd: "node",
        args: [worker, serializedConfig],
        detached: true,
      });

      expect(writes).toHaveLength(2);
      expect(writes[0]).toEqual({
        path: REMOTION_FILE_TRANSPORT_LOADER_PATH,
        contents: REMOTION_FILE_TRANSPORT_LOADER_SOURCE,
      });
      expect(writes[1].path).toMatch(/^\/tmp\/studio-remotion-config-[\w-]+\.json$/);
      expect(writes[1].contents).toBe(serializedConfig);

      const forwarded = runCommand.mock.calls[0][0] as {
        cmd: string;
        args: string[];
        detached: boolean;
      };
      expect(forwarded.cmd).toBe("node");
      expect(forwarded.detached).toBe(true);
      expect(forwarded.args).toEqual([
        REMOTION_FILE_TRANSPORT_LOADER_PATH,
        writes[1].path,
        worker,
      ]);
      expect(forwarded.args.join(" ")).not.toContain("x".repeat(1000));
    },
  );

  it("passes unrelated sandbox commands through unchanged", async () => {
    const { sandbox, runCommand, writeFile } = fakeSandbox();
    const wrapped = withFileBackedRemotionConfig(sandbox as never);
    const request = { cmd: "node", args: ["some-other-worker.mjs", "small"] };

    await (wrapped.runCommand as unknown as (request: unknown) => Promise<unknown>)(request);

    expect(writeFile).not.toHaveBeenCalled();
    expect(runCommand).toHaveBeenCalledWith(request);
  });

  it("reports the exact UTF-8 config size for render preflight logging", () => {
    const value = "SARA-✓-".repeat(1000);
    expect(remotionSerializedConfigBytes(value)).toBe(Buffer.byteLength(value, "utf8"));
  });
});
