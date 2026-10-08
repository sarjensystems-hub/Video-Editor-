import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { isUserStoragePath, mediaUrlFor, storagePathFromMediaUrl, userStoragePath } from "./storage-paths";

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

  it("accepts a reported upload path only inside the user's own folder", () => {
    expect(isUserStoragePath("user-1", "assets", "user-1/assets/uploads/a.mp4")).toBe(true);
    expect(isUserStoragePath("user-1", "assets", "user-2/assets/uploads/a.mp4")).toBe(false);
    expect(isUserStoragePath("user-1", "assets", "user-1/audio/a.wav")).toBe(false);
    expect(isUserStoragePath("user-1", "assets", "user-1/assets/../../user-2/assets/a.mp4")).toBe(false);
    expect(isUserStoragePath("user-1", "assets", "user-1/assets/")).toBe(false);
    expect(isUserStoragePath("user-1", "assets", 42)).toBe(false);
  });

  it("round-trips a storage path through its /media URL, on any domain", () => {
    const url = mediaUrlFor("https://app.example/", "user-1/videos/job 1.mp4");
    expect(url).toBe("https://app.example/media/user-1/videos/job%201.mp4");
    expect(storagePathFromMediaUrl(url)).toBe("user-1/videos/job 1.mp4");
    expect(storagePathFromMediaUrl("https://preview.example/media/user-1/a.png")).toBe("user-1/a.png");
  });

  it("returns nothing for URLs that are not our stored files", () => {
    expect(storagePathFromMediaUrl("https://proj.supabase.co/storage/v1/object/public/article-images/user-1/x.mp4")).toBeNull();
    // The URL parser resolves ".." before we see it, so a climb out of one
    // folder arrives as the other folder's path - which deletes then refuse.
    expect(storagePathFromMediaUrl("https://app.example/media/user-1/../user-2/x.mp4")).toBe("user-2/x.mp4");
    expect(storagePathFromMediaUrl("https://cdn.example.com/x.mp4")).toBeNull();
    expect(storagePathFromMediaUrl("not a url")).toBeNull();
    expect(storagePathFromMediaUrl(null)).toBeNull();
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

  it("keeps every file out of Supabase Storage", () => {
    const root = resolve(__dirname, "..");
    const offenders: string[] = [];
    const walk = (relative: string) => {
      for (const entry of readdirSync(join(root, relative))) {
        if (entry === "node_modules" || entry.startsWith(".")) continue;
        const child = join(relative, entry);
        if (statSync(join(root, child)).isDirectory()) walk(child);
        else if (/\.(ts|tsx|mjs)$/.test(entry) && !entry.includes(".test.")) {
          if (/\.storage\s*\.from\(/.test(readFileSync(join(root, child), "utf8"))) offenders.push(child);
        }
      }
    };
    for (const dir of ["app", "lib", "components", "scripts"]) walk(dir);
    expect(offenders).toEqual([]);
  });
});
