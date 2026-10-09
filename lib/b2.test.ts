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
    delete process.env.TIGRIS_ACCESS_KEY_ID;
    delete process.env.TIGRIS_SECRET_ACCESS_KEY;
    delete process.env.TIGRIS_BUCKET;
    delete process.env.TIGRIS_ENDPOINT;
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

  it("prefers Tigris when it is configured, with virtual-hosted addressing", async () => {
    process.env.TIGRIS_ACCESS_KEY_ID = "tid";
    process.env.TIGRIS_SECRET_ACCESS_KEY = "tsecret";
    process.env.TIGRIS_BUCKET = "sarjen-studio";
    const { putObject, presignGet } = await import("./b2");
    await putObject("user-1/audio/v.mp3", new Uint8Array(10), "audio/mpeg");
    expect(calls[0].url).toBe("https://sarjen-studio.t3.storage.dev/user-1/audio/v.mp3");
    const headers = new Headers(calls[0].init.headers);
    expect(headers.get("authorization")).toMatch(/Credential=tid\/\d{8}\/auto\/s3\/aws4_request/);
    const signed = new URL(await presignGet("user-1/audio/v.mp3", 60));
    expect(signed.host).toBe("sarjen-studio.t3.storage.dev");
  });

  it("finishes a multipart upload with the ETags the browser was given, without listing parts", async () => {
    const { completeMultipartUpload } = await import("./b2");
    await completeMultipartUpload("user-1/assets/v.mp4", "up-1", 2, ['"aaa"', '"bbb"']);
    expect(calls).toHaveLength(1);
    expect(calls[0].init.method).toBe("POST");
    const sent = new TextDecoder().decode(calls[0].init.body as Uint8Array);
    expect(sent).toContain("<PartNumber>1</PartNumber><ETag>&quot;aaa&quot;</ETag>");
    expect(sent).toContain("<PartNumber>2</PartNumber><ETag>&quot;bbb&quot;</ETag>");
  });

  it("retries a completion that storage answers with InvalidPart", { timeout: 10_000 }, async () => {
    let attempts = 0;
    vi.stubGlobal("fetch", vi.fn(async () => {
      attempts += 1;
      return attempts === 1
        ? new Response("<Error><Code>InvalidPart</Code><Message>One or more of the specified parts could not be found.</Message></Error>", { status: 400 })
        : new Response("<CompleteMultipartUploadResult/>", { status: 200 });
    }));
    const { completeMultipartUpload } = await import("./b2");
    await expect(completeMultipartUpload("user-1/assets/v.mp4", "up-1", 1, ['"aaa"'])).resolves.toBeUndefined();
    expect(attempts).toBe(2);
  });

  it("falls back to listing the parts when the browser could not read an ETag", async () => {
    vi.stubGlobal("fetch", vi.fn(async (url: string | Request, init?: RequestInit) => {
      const method = init?.method ?? (url instanceof Request ? url.method : "GET");
      calls.push({ url: String(url instanceof Request ? url.url : url), init: { ...init, method } });
      if (method === "GET") {
        return new Response("<ListPartsResult><Part><PartNumber>1</PartNumber><ETag>&quot;listed&quot;</ETag></Part><IsTruncated>false</IsTruncated></ListPartsResult>");
      }
      return new Response("<CompleteMultipartUploadResult/>", { status: 200 });
    }));
    const { completeMultipartUpload } = await import("./b2");
    await completeMultipartUpload("user-1/assets/v.mp4", "up-1", 1, [null]);
    const complete = calls.find((call) => call.init.method === "POST")!;
    expect(new TextDecoder().decode(complete.init.body as Uint8Array)).toContain("&quot;listed&quot;");
  });
});
