import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { downloadFilename, isTrustedMediaUrl, ownedMediaPath } from "./media-url";

const ORIGINAL = { ...process.env };

describe("trusting a stored media URL", () => {
  beforeEach(() => {
    process.env.NEXT_PUBLIC_SUPABASE_URL = "https://proj.supabase.co";
  });
  afterEach(() => {
    process.env = { ...ORIGINAL };
  });

  it("accepts our own storage host", () => {
    expect(isTrustedMediaUrl("https://proj.supabase.co/storage/v1/object/public/x.mp4")).toBe(true);
  });

  it("refuses anywhere else", () => {
    expect(isTrustedMediaUrl("https://evil.test/x.mp4")).toBe(false);
    // Right host, but not the storage path.
    expect(isTrustedMediaUrl("https://proj.supabase.co/rest/v1/secrets")).toBe(false);
    // A lookalike host must not pass.
    expect(isTrustedMediaUrl("https://proj.supabase.co.evil.test/storage/v1/object/public/x.mp4")).toBe(false);
  });

  it("refuses anything that is not https", () => {
    expect(isTrustedMediaUrl("http://proj.supabase.co/storage/v1/object/public/x.mp4")).toBe(false);
    expect(isTrustedMediaUrl("file:///etc/passwd")).toBe(false);
    expect(isTrustedMediaUrl("not a url")).toBe(false);
  });

  it("trusts nothing when no storage host is configured", () => {
    delete process.env.NEXT_PUBLIC_SUPABASE_URL;
    expect(isTrustedMediaUrl("https://proj.supabase.co/storage/v1/object/public/x.mp4")).toBe(false);
  });

  it("does not trust everything when the env var is malformed", () => {
    process.env.NEXT_PUBLIC_SUPABASE_URL = "not-a-url";
    expect(isTrustedMediaUrl("https://evil.test/storage/x.mp4")).toBe(false);
  });
});

describe("finding the caller's own stored file", () => {
  const USER = "11111111-1111-4111-8111-111111111111";

  it("accepts a /media URL in the caller's folder, on any domain the app answers on", () => {
    expect(ownedMediaPath(`https://video-editor-sarjen1.vercel.app/media/${USER}/renders/job.mp4`, USER, "renders"))
      .toBe(`${USER}/renders/job.mp4`);
    expect(ownedMediaPath(`https://studio.example.com/media/${USER}/assets/a.png`, USER)).toBe(`${USER}/assets/a.png`);
  });

  it("refuses another user's file, the wrong kind, and anything that is not a /media URL", () => {
    expect(ownedMediaPath("https://app.example.com/media/someone-else/renders/job.mp4", USER, "renders")).toBeNull();
    expect(ownedMediaPath(`https://app.example.com/media/${USER}/videos/clip.mp4`, USER, "renders")).toBeNull();
    expect(ownedMediaPath(`https://app.example.com/media/${USER}/renders/`, USER, "renders")).toBeNull();
    expect(ownedMediaPath(`https://app.example.com/media/${USER}/renders/../../x`, USER, "renders")).toBeNull();
    expect(ownedMediaPath("https://proj.supabase.co/storage/v1/object/public/x.mp4", USER)).toBeNull();
    expect(ownedMediaPath(null, USER)).toBeNull();
  });
});

describe("naming a downloaded render", () => {
  it("slugifies the project title and dates it", () => {
    expect(downloadFilename("Sedans In India — Is That Legal?", "film", "2026-08-29T03:00:00Z"))
      .toBe("sedans-in-india-is-that-legal-2026-08-29.mp4");
  });

  it("marks a clip export so it does not collide with the film", () => {
    expect(downloadFilename("My Project", "scene-2", "2026-08-29T03:00:00Z"))
      .toBe("my-project-scene-2-2026-08-29.mp4");
  });

  it("still produces a usable name from an empty or symbol-only title", () => {
    expect(downloadFilename("", "film", null)).toMatch(/^creative-\d{4}-\d{2}-\d{2}\.mp4$/);
    expect(downloadFilename("!!!", "film", null)).toMatch(/^creative-\d{4}-\d{2}-\d{2}\.mp4$/);
  });

  it("falls back to today when the timestamp is unusable", () => {
    expect(downloadFilename("X", "film", "nonsense")).toMatch(/^x-\d{4}-\d{2}-\d{2}\.mp4$/);
  });
});
