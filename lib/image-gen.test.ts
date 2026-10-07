import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("./openrouter-key", () => ({ getOpenRouterKey: async () => "sk-or-test" }));
vi.mock("@/lib/app-url", () => ({ appUrl: () => "https://studio.test" }));

import { IMAGE_MODEL, generateSocialImage } from "./image-gen";

afterEach(() => vi.unstubAllGlobals());

describe("generateSocialImage", () => {
  it("asks GPT Image for an image-only response at the canvas aspect ratio", async () => {
    const fetchMock = vi.fn(async () => new Response(JSON.stringify({
      choices: [{ message: { images: [{ image_url: { url: "data:image/png;base64,AAAA" } }] } }],
    })));
    vi.stubGlobal("fetch", fetchMock);

    const result = await generateSocialImage("a lighthouse at dusk", "portrait");

    expect(IMAGE_MODEL).toBe("openai/gpt-image-2.5-sunburst");
    const body = JSON.parse((fetchMock.mock.calls[0] as unknown as [string, RequestInit])[1].body as string);
    expect(body.model).toBe("openai/gpt-image-2.5-sunburst");
    expect(body.modalities).toEqual(["image"]);
    expect(body.image_config).toEqual({ aspect_ratio: "3:4" });
    expect(result).toEqual({ b64: "AAAA" });
  });
});
