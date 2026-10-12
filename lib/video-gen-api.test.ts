import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/openrouter-key", () => ({ requireOpenRouterKey: async () => "sk-or-test" }));
vi.mock("@/lib/app-url", () => ({ appUrl: () => "https://studio.test" }));

import { submitVideoJob, type SubmitVideoJobParams } from "./video-gen-api";

const base: SubmitVideoJobParams = {
  prompt: "A car at dusk",
  aspectRatio: "16:9",
  resolution: "720p",
  duration: 6,
  characters: [],
  generateAudio: false,
};

function captureBody() {
  const fetchMock = vi.fn(async () => new Response(JSON.stringify({ id: "job-1", status: "pending" })));
  vi.stubGlobal("fetch", fetchMock);
  return () => JSON.parse((fetchMock.mock.calls[0] as unknown as [string, RequestInit])[1].body as string);
}

afterEach(() => vi.unstubAllGlobals());

describe("submitVideoJob", () => {
  it("sends Grok Imagine 1.5 references as input_references with the legend", async () => {
    const body = captureBody();
    await submitVideoJob({
      ...base,
      model: "x-ai/grok-imagine-video-1.5",
      characters: [
        { name: "Alice", url: "https://example.com/a.jpg" },
        { name: "Bob", url: "https://example.com/b.jpg" },
      ],
    });
    const sent = body();
    expect(sent.model).toBe("x-ai/grok-imagine-video-1.5");
    expect(sent.input_references).toHaveLength(2);
    expect(sent.frame_images).toBeUndefined();
    expect(sent.prompt).toMatch(/^Reference image 1 is Alice\. Reference image 2 is Bob\./);
  });

  it("sends the one Grok Imagine 1.5 Lite image as the first frame, without a legend", async () => {
    const body = captureBody();
    await submitVideoJob({
      ...base,
      model: "x-ai/grok-imagine-video-1.5-lite",
      duration: 2,
      characters: [{ name: "Car", url: "https://example.com/car.jpg" }],
    });
    const sent = body();
    expect(sent.frame_images).toEqual([
      { type: "image_url", image_url: { url: "https://example.com/car.jpg" }, frame_type: "first_frame" },
    ]);
    expect(sent.input_references).toBeUndefined();
    expect(sent.prompt).toBe("A car at dusk");
  });

  it("refuses more than one image for Grok Imagine 1.5 Lite before calling OpenRouter", async () => {
    const body = captureBody();
    await expect(submitVideoJob({
      ...base,
      model: "x-ai/grok-imagine-video-1.5-lite",
      characters: [
        { name: "A", url: "https://example.com/a.jpg" },
        { name: "B", url: "https://example.com/b.jpg" },
      ],
    })).rejects.toThrow(/single image/);
    expect(() => body()).toThrow();
  });

  it("refuses more than seven references for Grok Imagine 1.5", async () => {
    captureBody();
    const characters = Array.from({ length: 8 }, (_, i) => ({ name: `C${i}`, url: `https://example.com/${i}.jpg` }));
    await expect(submitVideoJob({ ...base, model: "x-ai/grok-imagine-video-1.5", characters }))
      .rejects.toThrow(/at most 7/);
  });

  it("keeps Seedance as the default model", async () => {
    const body = captureBody();
    await submitVideoJob(base);
    expect(body().model).toBe("bytedance/seedance-2.0-fast");
  });

  it("passes the callback URL to OpenRouter only when there is one", async () => {
    let body = captureBody();
    await submitVideoJob({ ...base, callbackUrl: "https://app.example.com/api/videos/callback/j?token=t" });
    expect(body().callback_url).toBe("https://app.example.com/api/videos/callback/j?token=t");
    vi.unstubAllGlobals();
    body = captureBody();
    await submitVideoJob(base);
    expect(body().callback_url).toBeUndefined();
  });

  it("submits again without the callback if OpenRouter refuses it", async () => {
    const bodies: Array<Record<string, unknown>> = [];
    vi.stubGlobal("fetch", vi.fn(async (_url: string, init: RequestInit) => {
      const sent = JSON.parse(init.body as string);
      bodies.push(sent);
      return sent.callback_url
        ? new Response(JSON.stringify({ error: "callback_url is not supported" }), { status: 400 })
        : new Response(JSON.stringify({ id: "job-2", status: "pending" }));
    }));
    await expect(submitVideoJob({ ...base, callbackUrl: "https://app.example.com/cb?token=t" }))
      .resolves.toMatchObject({ id: "job-2" });
    expect(bodies).toHaveLength(2);
    expect(bodies[1].callback_url).toBeUndefined();
  });

  it("does not resubmit on an unrelated 400", async () => {
    const fetchMock = vi.fn(async () => new Response(JSON.stringify({ error: "duration not supported" }), { status: 400 }));
    vi.stubGlobal("fetch", fetchMock);
    await expect(submitVideoJob({ ...base, callbackUrl: "https://app.example.com/cb?token=t" })).rejects.toThrow(/400/);
    expect(fetchMock).toHaveBeenCalledOnce();
  });
});
