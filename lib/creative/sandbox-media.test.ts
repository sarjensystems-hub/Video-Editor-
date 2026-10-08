import { describe, expect, it } from "vitest";
import {
  PREVIEW_COPY_MIN_BYTES,
  localizeAssetMap,
  localizeSandboxMedia,
  planSandboxMedia,
  type SandboxRunner,
} from "./sandbox-media";
import { SANDBOX_LOCAL_ASSET_PREFIX, type CreativeRemotionAssetMap } from "./remotion";

const BIG = PREVIEW_COPY_MIN_BYTES + 1;

const assets: CreativeRemotionAssetMap = {
  bigVideo: { url: "https://app.example/media/u/assets/phone.MP4", mimeType: "video/mp4", kind: "video", sizeBytes: BIG },
  smallVideo: { url: "https://app.example/media/u/assets/clip.mov", mimeType: "video/quicktime", kind: "video", sizeBytes: 1000 },
  copied: { url: "https://app.example/media/u/assets/old.mp4", kind: "video", sizeBytes: BIG, previewUrl: "https://app.example/media/u/assets/previews/copied.mp4" },
  voice: { url: "https://app.example/media/u/audio/voice.mp3", mimeType: "audio/mpeg", kind: "audio" },
  sameFile: { url: "https://app.example/media/u/audio/voice.mp3", mimeType: "audio/mpeg", kind: "audio" },
  external: { url: "data:image/png;base64,AAAA", kind: "image" },
};

describe("sandbox media", () => {
  it("downloads each file once, reads existing preview copies, and makes missing ones for big videos", () => {
    const jobs = planSandboxMedia(assets, { usePreviews: true, canMakePreviews: true });
    const byAsset = (id: string) => jobs.find((job) => job.assetIds.includes(id))!;

    expect(byAsset("bigVideo").makePreviewFor).toBe("bigVideo");
    expect(byAsset("bigVideo").file).toMatch(/\.mp4$/);
    expect(byAsset("smallVideo").makePreviewFor).toBeNull();
    expect(byAsset("smallVideo").file).toMatch(/\.mov$/);
    expect(byAsset("copied").sourceUrl).toBe(assets.copied.previewUrl);
    expect(byAsset("copied").makePreviewFor).toBeNull();
    // Two rows sharing a file share the download.
    expect(byAsset("voice")).toBe(byAsset("sameFile"));
    expect(jobs.some((job) => job.assetIds.includes("external"))).toBe(false);
  });

  it("never substitutes a preview copy in a final render", () => {
    const jobs = planSandboxMedia(assets, { usePreviews: false, canMakePreviews: true });
    expect(jobs.every((job) => job.makePreviewFor === null)).toBe(true);
    expect(jobs.find((job) => job.assetIds.includes("copied"))!.sourceUrl).toBe(assets.copied.url);
  });

  it("points only the copied assets at their local files", () => {
    const jobs = planSandboxMedia(assets, { usePreviews: true, canMakePreviews: false });
    const voiceJob = jobs.find((job) => job.assetIds.includes("voice"))!;
    const local = localizeAssetMap(assets, jobs, new Set([voiceJob.file]));
    expect(local.voice.url).toBe(`${SANDBOX_LOCAL_ASSET_PREFIX}_media/${voiceJob.file}`);
    expect(local.sameFile.url).toBe(local.voice.url);
    expect(local.bigVideo.url).toBe(assets.bigVideo.url);
    expect(local.external.url).toBe(assets.external.url);
  });

  it("records a preview copy the sandbox made, and keeps remote URLs for anything that failed", async () => {
    const commands: Array<Record<string, string>> = [];
    const sandbox: SandboxRunner = {
      async runCommand({ env }) {
        commands.push(env ?? {});
        const failed = env?.SRC.includes("clip.mov");
        return {
          exitCode: failed ? 22 : 0,
          stdout: async () => (env?.PUT ? "PREVIEW_STORED 1234\n" : ""),
          stderr: async () => (failed ? "curl: (22) 403" : ""),
        };
      },
    };
    const saved: Array<[string, string, number]> = [];
    const result = await localizeSandboxMedia({
      sandbox,
      assets,
      options: { usePreviews: true, canMakePreviews: true },
      downloadUrl: async (url) => `${url}?signed`,
      previews: {
        target: async (assetId) => ({ putUrl: `https://b2.example/put/${assetId}`, url: `https://app.example/media/u/assets/previews/${assetId}.mp4` }),
        save: async (assetId, url, size) => {
          saved.push([assetId, url, size]);
        },
      },
    });

    expect(saved).toEqual([["bigVideo", "https://app.example/media/u/assets/previews/bigVideo.mp4", 1234]]);
    expect(result.bigVideo.url.startsWith(SANDBOX_LOCAL_ASSET_PREFIX)).toBe(true);
    expect(result.smallVideo.url).toBe(assets.smallVideo.url);
    // Downloads are signed, and nothing reaches a command line.
    expect(commands.every((env) => env.SRC.endsWith("?signed"))).toBe(true);
  });
});
