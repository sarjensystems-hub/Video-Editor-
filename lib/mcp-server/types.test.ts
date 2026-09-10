import { describe, expect, it } from "vitest";
import { parseGenerateVideoRequest } from "./types";

describe("parseGenerateVideoRequest", () => {
  it("applies social video defaults", () => {
    const result = parseGenerateVideoRequest({
      prompt: "Drive through rain",
      idempotency_key: "idem-1",
    });

    expect(result).toMatchObject({
      mode: "cinematic",
      aspectRatio: "9:16",
      resolution: "720p",
      duration: 5,
      generateAudio: true,
      provider: "openrouter",
      references: [],
    });
  });

  it("preserves ordered references and accepts snake-case fields", () => {
    const result = parseGenerateVideoRequest({
      prompt: "Show the car",
      idempotency_key: "idem-2",
      aspect_ratio: "16:9",
      generate_audio: false,
      references: [
        { url: "https://example.com/front.jpg", label: "Car front", role: "vehicle" },
        { url: "https://example.com/side.jpg", role: "style" },
      ],
    });

    expect(result.aspectRatio).toBe("16:9");
    expect(result.generateAudio).toBe(false);
    expect(result.references.map((reference) => reference.url)).toEqual([
      "https://example.com/front.jpg",
      "https://example.com/side.jpg",
    ]);
  });

  it("accepts an optional Studio site id", () => {
    const result = parseGenerateVideoRequest({
      prompt: "Show the car",
      idempotency_key: "idem-site",
      site_id: "11111111-1111-4111-8111-111111111111",
    });
    expect(result.siteId).toBe("11111111-1111-4111-8111-111111111111");
  });

  it("rejects avatar mode until a provider exists", () => {
    expect(() =>
      parseGenerateVideoRequest({ prompt: "talk", idempotency_key: "idem", mode: "avatar" }),
    ).toThrow(/not configured/i);
  });

  it("rejects invalid duration and missing idempotency", () => {
    expect(() =>
      parseGenerateVideoRequest({ prompt: "x", idempotency_key: "idem", duration: 16 }),
    ).toThrow(/4.*15/);
    expect(() => parseGenerateVideoRequest({ prompt: "x" })).toThrow(/idempotency/i);
  });
});
