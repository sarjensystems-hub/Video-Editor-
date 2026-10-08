import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

describe("B2 requests", () => {
  const calls: Array<{ url: string; init: RequestInit }> = [];

  beforeEach(() => {
    vi.resetModules();
    calls.length = 0;
    process.env.B2_KEY_ID = "key-id";
    process.env.B2_APPLICATION_KEY = "secret";
    process.env.B2_BUCKET = "studio-videos";
    process.env.B2_ENDPOINT = "s3.us-east-005.backblazeb2.com";
    vi.stubGlobal("fetch", vi.fn(async (url: string, init: RequestInit) => {
      calls.push({ url: String(url), init });
      return new Response("", { status: 200 });
    }));
  });

  afterEach(() => vi.unstubAllGlobals());

  /** B2 answers 411 to an upload that does not declare its length. */
  it("sends uploads with an explicit Content-Length and a SigV4 signature", async () => {
    const { putObject } = await import("./b2");
    await putObject("user-1/renders/a.mp4", new Uint8Array(1234), "video/mp4");
    expect(calls).toHaveLength(1);
    const headers = new Headers(calls[0].init.headers);
    expect(calls[0].url).toBe("https://s3.us-east-005.backblazeb2.com/studio-videos/user-1/renders/a.mp4");
    expect(calls[0].init.method).toBe("PUT");
    expect(headers.get("content-length")).toBe("1234");
    expect(headers.get("authorization")).toMatch(/^AWS4-HMAC-SHA256 Credential=key-id\/\d{8}\/us-east-005\/s3\/aws4_request/);
    expect(headers.get("x-amz-content-sha256")).toBe("UNSIGNED-PAYLOAD");
    expect((calls[0].init.body as Uint8Array).byteLength).toBe(1234);
  });

  it("presigns reads in the URL itself, with the requested lifetime", async () => {
    const { presignGet } = await import("./b2");
    const url = new URL(await presignGet("user-1/images/x.png", 7200));
    expect(url.pathname).toBe("/studio-videos/user-1/images/x.png");
    expect(url.searchParams.get("X-Amz-Expires")).toBe("7200");
    expect(url.searchParams.get("X-Amz-Signature")).toMatch(/^[0-9a-f]{64}$/);
  });
});
