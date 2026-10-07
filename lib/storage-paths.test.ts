import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { storagePathFromPublicUrl, userStoragePath } from "./storage-paths";

describe("per-user storage paths", () => {
  it("puts every file inside the user's own folder", () => {
    expect(userStoragePath("user-1", "videos", "job.mp4")).toBe("user-1/videos/job.mp4");
    expect(userStoragePath("user-1", "assets", "decomposition/x.png")).toBe("user-1/assets/decomposition/x.png");
  });

  it("refuses a name that would climb out of the folder", () => {
    expect(() => userStoragePath("user-1", "audio", "../user-2/audio/x.wav")).toThrow();
    expect(() => userStoragePath("user-1", "audio", "a//b.wav")).toThrow();
    expect(() => userStoragePath("user-1/../user-2", "audio", "x.wav")).toThrow();
    expect(() => userStoragePath("", "audio", "x.wav")).toThrow();
  });

  it("recovers the bucket path from one of our public URLs", () => {
    const url = "https://proj.supabase.co/storage/v1/object/public/article-images/user-1/videos/job%201.mp4";
    expect(storagePathFromPublicUrl(url, "article-images")).toBe("user-1/videos/job 1.mp4");
  });

  it("returns nothing for URLs that are not files in the bucket", () => {
    expect(storagePathFromPublicUrl("https://proj.supabase.co/storage/v1/object/public/other/x.mp4", "article-images")).toBeNull();
    expect(storagePathFromPublicUrl("https://cdn.example.com/x.mp4", "article-images")).toBeNull();
    expect(storagePathFromPublicUrl("not a url", "article-images")).toBeNull();
    expect(storagePathFromPublicUrl(null, "article-images")).toBeNull();
  });

  /**
   * The old layout put the kind first (`creative-audio/<uid>/…`), which the
   * bucket policy refuses and which scatters a user's files across folders.
   * Every path now comes from userStoragePath; nothing may build one by hand.
   */
  it("leaves no hand-built path in the old layout anywhere in the code", () => {
    const root = resolve(__dirname, "..");
    const offenders: string[] = [];
    const walk = (relative: string) => {
      for (const entry of readdirSync(join(root, relative))) {
        if (entry === "node_modules" || entry.startsWith(".")) continue;
        const child = join(relative, entry);
        if (statSync(join(root, child)).isDirectory()) walk(child);
        else if (/\.(ts|tsx|mjs)$/.test(entry) && !entry.includes(".test.")) {
          const source = readFileSync(join(root, child), "utf8");
          if (/`creative-(audio|renders|assets|previews|frames)\//.test(source)) offenders.push(child);
        }
      }
    };
    for (const dir of ["app", "lib", "components", "scripts"]) walk(dir);
    expect(offenders).toEqual([]);
  });
});
