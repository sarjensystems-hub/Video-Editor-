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

  it("applies Grok Imagine limits per model", () => {
    expect(parseGenerateVideoRequest({
      prompt: "Short clip",
      idempotency_key: "idem-grok-1",
      model: "x-ai/grok-imagine-video-1.5",
      duration: 2,
    }).duration).toBe(2);

    expect(() => parseGenerateVideoRequest({
      prompt: "Short clip",
      idempotency_key: "idem-seedance-short",
      duration: 2,
    })).toThrow(/from 4 to 15/);

    expect(() => parseGenerateVideoRequest({
      prompt: "Two refs",
      idempotency_key: "idem-lite-2",
      model: "x-ai/grok-imagine-video-1.5-lite",
      references: [{ url: "https://example.com/a.jpg" }, { url: "https://example.com/b.jpg" }],
    })).toThrow(/single image/);

    expect(parseGenerateVideoRequest({
      prompt: "One ref",
      idempotency_key: "idem-lite-1",
      model: "x-ai/grok-imagine-video-1.5-lite",
      references: [{ url: "https://example.com/a.jpg", role: "first_frame" }],
    }).references).toHaveLength(1);
  });
});
