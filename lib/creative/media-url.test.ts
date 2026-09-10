import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { downloadFilename, isTrustedMediaUrl } from "./media-url";

const ORIGINAL = { ...process.env };

describe("trusting a stored media URL", () => {
  beforeEach(() => {
    process.env.R2_PUBLIC_BASE_URL = "https://pub-abc123.r2.dev";
    process.env.NEXT_PUBLIC_SUPABASE_URL = "https://proj.supabase.co";
  });
  afterEach(() => {
    process.env = { ...ORIGINAL };
  });

  it("accepts our own storage hosts", () => {
    expect(isTrustedMediaUrl("https://pub-abc123.r2.dev/creative-renders/a/b.mp4")).toBe(true);
    expect(isTrustedMediaUrl("https://proj.supabase.co/storage/v1/object/public/x.mp4")).toBe(true);
  });

  it("refuses anywhere else", () => {
    expect(isTrustedMediaUrl("https://evil.test/x.mp4")).toBe(false);
    // Right host, but not the storage path.
    expect(isTrustedMediaUrl("https://proj.supabase.co/rest/v1/secrets")).toBe(false);
    // A lookalike host must not pass.
    expect(isTrustedMediaUrl("https://pub-abc123.r2.dev.evil.test/x.mp4")).toBe(false);
  });

  it("refuses anything that is not https", () => {
    expect(isTrustedMediaUrl("http://pub-abc123.r2.dev/x.mp4")).toBe(false);
    expect(isTrustedMediaUrl("file:///etc/passwd")).toBe(false);
    expect(isTrustedMediaUrl("not a url")).toBe(false);
  });

  it("trusts nothing when no storage host is configured", () => {
    delete process.env.R2_PUBLIC_BASE_URL;
    delete process.env.NEXT_PUBLIC_SUPABASE_URL;
    expect(isTrustedMediaUrl("https://pub-abc123.r2.dev/x.mp4")).toBe(false);
  });

  it("does not trust everything when the env var is malformed", () => {
    process.env.R2_PUBLIC_BASE_URL = "not-a-url";
    expect(isTrustedMediaUrl("https://evil.test/x.mp4")).toBe(false);
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
