import { readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";

const cookieClient = vi.hoisted(() => ({ used: false }));

// The browser-session client. In an MCP request there is no cookie behind it,
// so reaching for it there is exactly the bug: an anonymous upload, refused.
vi.mock("@/lib/supabase/server", () => ({
  createClient: async () => {
    cookieClient.used = true;
    return fakeClient("https://cookie.example/").client;
  },
}));


import { deleteUserFiles, runWithStorageClient, uploadAnyBytes } from "./storage";

function fakeClient(base: string) {
  const upload = vi.fn(async (path: string) => ({ data: { path }, error: null }));
  const client = {
    storage: {
      from: () => ({
        upload,
        getPublicUrl: (path: string) => ({ data: { publicUrl: `${base}${path}` } }),
      }),
    },
  } as unknown as SupabaseClient;
  return { client, upload };
}

describe("storage upload client", () => {
  beforeEach(() => {
    cookieClient.used = false;
  });

  it("uploads with the caller's client inside a storage scope", async () => {
    const caller = fakeClient("https://caller.example/");
    const url = await runWithStorageClient(caller.client, () =>
      uploadAnyBytes(new Uint8Array([1, 2, 3]), "user-1/video-1.mp4", "video/mp4"),
    );

    expect(url).toBe("https://caller.example/user-1/video-1.mp4");
    expect(caller.upload).toHaveBeenCalledTimes(1);
    expect(cookieClient.used).toBe(false);
  });

  /** A finished render outlives the MCP response; its upload must too. */
  it("keeps the caller's client across awaits and deferred work", async () => {
    const caller = fakeClient("https://caller.example/");
    const url = await runWithStorageClient(caller.client, async () => {
      await new Promise((done) => setTimeout(done, 1));
      return uploadAnyBytes(new Uint8Array([1]), "user-1/late.png", "image/png");
    });

    expect(url).toBe("https://caller.example/user-1/late.png");
    expect(cookieClient.used).toBe(false);
  });

  it("falls back to the browser session outside a scope", async () => {
    const url = await uploadAnyBytes(new Uint8Array([1]), "user-1/x.png", "image/png");
    expect(url).toBe("https://cookie.example/user-1/x.png");
    expect(cookieClient.used).toBe(true);
  });

  it("is opened by the MCP route, which has no cookies to fall back on", () => {
    const route = readFileSync(resolve(__dirname, "..", join("app", "api", "mcp", "route.ts")), "utf8");
    expect(route).toContain("runWithStorageClient(context.supabase");
  });
});

describe("deleting a user's files", () => {
  const base = "https://proj.supabase.co/storage/v1/object/public/article-images";

  function removingClient() {
    const remove = vi.fn(async (paths: string[]) => ({ data: paths.map((name) => ({ name })), error: null }));
    const client = { storage: { from: () => ({ remove }) } } as unknown as SupabaseClient;
    return { client, remove };
  }

  beforeEach(() => {
    process.env.NEXT_PUBLIC_SUPABASE_URL = "https://proj.supabase.co";
  });

  it("removes files inside the user's own folder", async () => {
    const { client, remove } = removingClient();
    const result = await runWithStorageClient(client, () =>
      deleteUserFiles("user-1", [`${base}/user-1/renders/a.mp4`, `${base}/user-1/assets/b.png`]),
    );
    expect(remove).toHaveBeenCalledWith(["user-1/renders/a.mp4", "user-1/assets/b.png"]);
    expect(result).toEqual({ removed: 2, skipped: 0, notRemoved: 0 });
  });

  /**
   * Connector requests run with a client that bypasses row-level security,
   * and asset URLs are stored data. Without this boundary a crafted URL could
   * name another user's file, or one in another Supabase project.
   */
  it("never touches another user's folder or another host", async () => {
    const { client, remove } = removingClient();
    const result = await runWithStorageClient(client, () =>
      deleteUserFiles("user-1", [
        `${base}/user-2/renders/theirs.mp4`,
        "https://evil.supabase.co/storage/v1/object/public/article-images/user-1/x.mp4",
        `${base}/user-1/../user-2/x.mp4`,
        "https://cdn.example.com/user-1/x.mp4",
      ]),
    );
    expect(remove).not.toHaveBeenCalled();
    expect(result.skipped).toBe(4);
  });

  it("removes each file once even when listed twice", async () => {
    const { client, remove } = removingClient();
    await runWithStorageClient(client, () =>
      deleteUserFiles("user-1", [`${base}/user-1/videos/v.mp4`, `${base}/user-1/videos/v.mp4`, null]),
    );
    expect(remove).toHaveBeenCalledWith(["user-1/videos/v.mp4"]);
  });
});
