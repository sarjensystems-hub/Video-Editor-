import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { jobCallbackToken, jobCallbackUrl, verifyJobCallbackToken } from "./job-callbacks";

const KEY = "a".repeat(64);

describe("job callbacks", () => {
  const original = process.env.API_KEY_ENCRYPTION_KEY;
  beforeEach(() => { process.env.API_KEY_ENCRYPTION_KEY = KEY; });
  afterEach(() => { process.env.API_KEY_ENCRYPTION_KEY = original; });

  it("accepts its own token and nothing else", () => {
    const token = jobCallbackToken("render", "job-1");
    expect(verifyJobCallbackToken("render", "job-1", token)).toBe(true);
    expect(verifyJobCallbackToken("render", "job-2", token)).toBe(false);
    expect(verifyJobCallbackToken("video", "job-1", token)).toBe(false);
    expect(verifyJobCallbackToken("render", "job-1", `${token}x`)).toBe(false);
    expect(verifyJobCallbackToken("render", "job-1", null)).toBe(false);
  });

  it("builds an https callback URL that verifies", () => {
    const url = new URL(jobCallbackUrl("https://studio.example.com", "video", "job-1")!);
    expect(url.pathname).toBe("/api/videos/callback/job-1");
    expect(verifyJobCallbackToken("video", "job-1", url.searchParams.get("token"))).toBe(true);
  });

  it("hands out no callback where none could arrive", () => {
    expect(jobCallbackUrl("http://localhost:3000", "render", "job-1")).toBeUndefined();
    expect(jobCallbackUrl("", "render", "job-1")).toBeUndefined();
    delete process.env.API_KEY_ENCRYPTION_KEY;
    const oauth = process.env.OAUTH_TOKEN_KEY;
    delete process.env.OAUTH_TOKEN_KEY;
    expect(jobCallbackUrl("https://studio.example.com", "render", "job-1")).toBeUndefined();
    process.env.OAUTH_TOKEN_KEY = oauth;
  });
});
