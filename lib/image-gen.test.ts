import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("./openrouter-key", () => ({ getOpenRouterKey: async () => "sk-or-test" }));
vi.mock("@/lib/app-url", () => ({ appUrl: () => "https://studio.test" }));

import { IMAGE_MODEL, generateSocialImage } from "./image-gen";

afterEach(() => vi.unstubAllGlobals());

function stubFetch(response: Response) {
  const fetchMock = vi.fn(async () => response);
  vi.stubGlobal("fetch", fetchMock);
  const call = () => fetchMock.mock.calls[0] as unknown as [string, RequestInit];
  return { url: () => call()[0], body: () => JSON.parse(call()[1].body as string) };
}

describe("generateSocialImage", () => {
  it("calls OpenRouter's Images API at the canvas aspect ratio", async () => {
    const sent = stubFetch(new Response(JSON.stringify({ created: 1, data: [{ b64_json: "AAAA", media_type: "image/png" }] })));

    const result = await generateSocialImage("a lighthouse at dusk", "portrait");

    expect(IMAGE_MODEL).toBe("openai/gpt-image-2.5-sunburst");
    expect(sent.url()).toBe("https://openrouter.ai/api/v1/images");
    expect(sent.body()).toEqual({ model: IMAGE_MODEL, prompt: "a lighthouse at dusk", aspect_ratio: "3:4", n: 1 });
    expect(result).toEqual({ b64: "AAAA" });
  });

  it("sends reference images as input_references", async () => {
    const sent = stubFetch(new Response(JSON.stringify({ created: 1, data: [{ b64_json: "BBBB" }] })));

    await generateSocialImage("the same family at the gate", "landscape", ["https://example.com/frame1.png"]);

    expect(sent.body().input_references).toEqual([{ type: "image_url", image_url: { url: "https://example.com/frame1.png" } }]);
    expect(sent.body().aspect_ratio).toBe("16:9");
  });

  it("passes OpenRouter's reason through when it refuses", async () => {
    stubFetch(new Response(JSON.stringify({ error: { message: "Rate limit exceeded", code: 429 } }), { status: 429 }));

    await expect(generateSocialImage("x")).rejects.toThrow(/OpenRouter 429\): Rate limit exceeded/);
  });
});
