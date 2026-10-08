import { readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { beforeEach, describe, expect, it, vi } from "vitest";

const b2 = vi.hoisted(() => ({
  put: vi.fn(async (_path: string, _body: unknown, _type: string) => undefined),
  del: vi.fn(async (_path: string) => true),
}));

vi.mock("@/lib/b2", () => ({
  putObject: b2.put,
  deleteObject: b2.del,
}));

// Outside a request, the deployment's own address is the fallback origin.
vi.mock("@/lib/app-url", () => ({
  appUrl: () => "https://app.example",
  requestOrigin: async () => {
    throw new Error("no request");
  },
}));

import { deleteUserFiles, runWithMediaOrigin, uploadAnyBytes } from "./storage";

describe("storing a file", () => {
  beforeEach(() => {
    b2.put.mockClear();
  });

  it("writes to B2 and returns the file's permanent /media URL", async () => {
    const url = await runWithMediaOrigin("https://caller.example", () =>
      uploadAnyBytes(new Uint8Array([1, 2, 3]), "user-1/videos/video-1.mp4", "video/mp4"),
    );
    expect(b2.put).toHaveBeenCalledWith("user-1/videos/video-1.mp4", expect.any(Uint8Array), "video/mp4");
    expect(url).toBe("https://caller.example/media/user-1/videos/video-1.mp4");
  });

  /** A finished render outlives the MCP response; its URL must keep the right domain. */
  it("keeps the request's origin across awaits and deferred work", async () => {
    const url = await runWithMediaOrigin("https://caller.example", async () => {
      await new Promise((done) => setTimeout(done, 1));
      return uploadAnyBytes(new Uint8Array([1]), "user-1/renders/late.mp4", "video/mp4");
    });
    expect(url).toBe("https://caller.example/media/user-1/renders/late.mp4");
  });

  it("falls back to the deployment's address when there is no request", async () => {
    const url = await uploadAnyBytes(new Uint8Array([1]), "user-1/images/x.png", "image/png");
    expect(url).toBe("https://app.example/media/user-1/images/x.png");
  });

  it("returns null rather than throwing when storage refuses the file", async () => {
    b2.put.mockRejectedValueOnce(new Error("B2 down"));
    expect(await uploadAnyBytes(new Uint8Array([1]), "user-1/images/x.png", "image/png")).toBeNull();
  });

  it("is given its origin by the MCP route, whose work outlives the response", () => {
    const route = readFileSync(resolve(__dirname, "..", join("app", "api", "mcp", "route.ts")), "utf8");
    expect(route).toContain("runWithMediaOrigin(new URL(request.url).origin");
  });
});

describe("deleting a user's files", () => {
  const base = "https://app.example/media";

  beforeEach(() => {
    b2.del.mockClear();
  });

  it("removes files inside the user's own folder", async () => {
    const result = await deleteUserFiles("user-1", [`${base}/user-1/renders/a.mp4`, `${base}/user-1/assets/b.png`]);
    expect(b2.del.mock.calls.map(([path]) => path).sort()).toEqual(["user-1/assets/b.png", "user-1/renders/a.mp4"]);
    expect(result).toEqual({ removed: 2, skipped: 0, notRemoved: 0 });
  });

  /**
   * Asset URLs are stored data. Without this boundary a crafted URL could
   * name another user's file.
   */
  it("never touches another user's folder, a traversal, or a foreign URL", async () => {
    const result = await deleteUserFiles("user-1", [
      `${base}/user-2/renders/theirs.mp4`,
      `${base}/user-1/../user-2/x.mp4`,
      "https://cdn.example.com/user-1/x.mp4",
      "https://proj.supabase.co/storage/v1/object/public/article-images/user-1/old.mp4",
    ]);
    expect(b2.del).not.toHaveBeenCalled();
    expect(result.skipped).toBe(4);
  });

  it("removes each file once even when listed twice", async () => {
    await deleteUserFiles("user-1", [`${base}/user-1/videos/v.mp4`, `${base}/user-1/videos/v.mp4`, null]);
    expect(b2.del).toHaveBeenCalledTimes(1);
  });

  it("reports files storage would not remove", async () => {
    b2.del.mockResolvedValueOnce(false);
    const result = await deleteUserFiles("user-1", [`${base}/user-1/videos/v.mp4`]);
    expect(result).toEqual({ removed: 0, skipped: 0, notRemoved: 1 });
  });
});
