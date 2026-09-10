import { describe, expect, it } from "vitest";
import { createOpenRouterVideoProvider } from "./provider";
import type { GenerateVideoRequest } from "./types";

const request: GenerateVideoRequest = {
  prompt: "A premium tracking shot",
  mode: "automotive_broll",
  provider: "openrouter",
  model: "custom/model",
  references: [
    { url: "https://example.com/car.jpg", label: "Car A", role: "vehicle" },
    { url: "https://example.com/style.jpg", role: "style" },
  ],
  aspectRatio: "9:16",
  resolution: "720p",
  duration: 5,
  generateAudio: true,
  idempotencyKey: "idem",
};

describe("OpenRouter video provider", () => {
  it("maps normalized requests without reordering references", async () => {
    let submitted: Record<string, unknown> | undefined;
    const provider = createOpenRouterVideoProvider({
      submitVideoJob: async (params) => {
        submitted = params as unknown as Record<string, unknown>;
        return { id: "up-1", status: "pending" };
      },
      pollVideoJob: async () => ({
        id: "up-1",
        status: "completed",
        usage: { cost: 0.25, is_byok: false },
      }),
      downloadVideoContent: async () => ({ bytes: Buffer.from("video"), contentType: "video/mp4" }),
    });

    const result = await provider.submit(request);
    expect(result).toEqual({ id: "up-1", status: "pending" });
    expect(submitted?.model).toBe("custom/model");
    expect((submitted?.characters as Array<{ url: string }>).map((item) => item.url)).toEqual(
      request.references.map((reference) => reference.url),
    );
    expect((submitted?.characters as Array<{ name: string }>)[0].name).toBe("Car A");
    expect((submitted?.characters as Array<{ name: string }>)[1].name).toBe("style");
    expect(submitted?.referenceInstruction).toMatch(/subject or object/i);
  });

  it("maps upstream usage cost", async () => {
    const provider = createOpenRouterVideoProvider({
      submitVideoJob: async () => ({ id: "up-1", status: "pending" }),
      pollVideoJob: async () => ({
        id: "up-1",
        status: "completed",
        usage: { cost: 0.25, is_byok: false },
      }),
      downloadVideoContent: async () => ({ bytes: Buffer.from("video"), contentType: "video/mp4" }),
    });

    await expect(provider.getStatus("up-1")).resolves.toMatchObject({
      status: "completed",
      costUsd: 0.25,
    });
  });
});
