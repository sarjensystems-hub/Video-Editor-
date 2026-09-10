import { randomUUID } from "node:crypto";
import type { Sandbox } from "@vercel/sandbox";

const REMOTION_WORKERS = new Set(["render-video.mjs", "render-still.mjs"]);

export const REMOTION_FILE_TRANSPORT_LOADER_PATH =
  "/vercel/sandbox/studio-remotion-config-loader.mjs";

/**
 * @remotion/vercel 4.0.517 launches its sandbox worker with the whole render
 * config JSON in argv[2]. A sufficiently rich CreativeDocument can exceed the
 * host's exec argument limit before Node starts at all (E2BIG / "argument list
 * too long"). Keep Remotion's own worker unchanged, but transport the large
 * config through the sandbox filesystem and let a tiny loader restore argv[2]
 * inside the already-started Node process.
 */
export const REMOTION_FILE_TRANSPORT_LOADER_SOURCE = `import { readFile } from "node:fs/promises";

const configPath = process.argv[2];
const worker = process.argv[3];
const allowedWorkers = new Set(["render-video.mjs", "render-still.mjs"]);
if (!configPath || !worker || !allowedWorkers.has(worker)) {
  throw new Error("Invalid Studio Remotion file-transport arguments");
}
const serializedConfig = await readFile(configPath, "utf8");
process.argv.splice(2, 2, serializedConfig);
await import(new URL(\`./\${worker}\`, import.meta.url).href);
`;

type SandboxLike = {
  fs?: {
    writeFile?: (path: string, contents: string | Uint8Array) => Promise<unknown>;
  };
  runCommand?: (...args: unknown[]) => Promise<unknown>;
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

export function remotionSerializedConfigBytes(serializedConfig: string): number {
  return new TextEncoder().encode(serializedConfig).byteLength;
}

/**
 * Returns a transparent Sandbox proxy. All normal sandbox operations pass
 * through unchanged. Only Remotion's two Node worker launches are intercepted.
 * Their serialized config is written to /tmp and the OS sees only three short
 * arguments: loader path, config path and worker name.
 *
 * The interception is deliberately lazy: renderer unit tests use lightweight
 * Sandbox.create() doubles because @remotion/vercel itself is mocked there.
 * Such doubles need not grow fake runCommand/fs implementations merely because
 * production Sandboxes support them.
 */
export function withFileBackedRemotionConfig(sandbox: Sandbox): Sandbox {
  const raw = sandbox as unknown as SandboxLike;

  return new Proxy(sandbox as unknown as object, {
    get(target, property, receiver) {
      if (property === "runCommand" && typeof raw.runCommand === "function") {
        const originalRunCommand = raw.runCommand.bind(sandbox);
        return async (request: unknown, ...rest: unknown[]) => {
          if (!isRecord(request)) {
            return originalRunCommand(request, ...rest);
          }

          const args = Array.isArray(request.args) ? request.args : [];
          const worker = typeof args[0] === "string" ? args[0] : null;
          const serializedConfig = typeof args[1] === "string" ? args[1] : null;
          if (request.cmd !== "node" || !worker || !REMOTION_WORKERS.has(worker) || serializedConfig === null) {
            return originalRunCommand(request, ...rest);
          }

          const writeFile = raw.fs?.writeFile;
          if (typeof writeFile !== "function") {
            throw new Error("Vercel Sandbox filesystem writeFile is unavailable for Remotion config transport");
          }

          const configPath = `/tmp/studio-remotion-config-${randomUUID()}.json`;
          await writeFile.call(raw.fs, REMOTION_FILE_TRANSPORT_LOADER_PATH, REMOTION_FILE_TRANSPORT_LOADER_SOURCE);
          await writeFile.call(raw.fs, configPath, serializedConfig);

          const bytes = remotionSerializedConfigBytes(serializedConfig);
          console.info(
            `[creative-render] ${worker} config ${bytes} bytes transported by file (argv-safe)`,
          );

          return originalRunCommand(
            {
              ...request,
              args: [
                REMOTION_FILE_TRANSPORT_LOADER_PATH,
                configPath,
                worker,
                ...args.slice(2),
              ],
            },
            ...rest,
          );
        };
      }

      const value = Reflect.get(target, property, receiver);
      return typeof value === "function" ? value.bind(target) : value;
    },
  }) as unknown as Sandbox;
}
