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

  it("applies Gemini Omni 1.2 Flash limits", () => {
    const omni = { prompt: "Clip", model: "google/gemini-omni-1.2-flash" };
    expect(parseGenerateVideoRequest({ ...omni, idempotency_key: "omni-1", duration: 3 }).duration).toBe(3);
    expect(() => parseGenerateVideoRequest({ ...omni, idempotency_key: "omni-2", duration: 2 })).toThrow(/from 3 to 15/);
    expect(() => parseGenerateVideoRequest({ ...omni, idempotency_key: "omni-3", resolution: "480p" })).toThrow(/360p or 720p or 1080p/);
    for (const resolution of ["360p", "720p", "1080p"]) {
      expect(parseGenerateVideoRequest({ ...omni, idempotency_key: `omni-${resolution}`, resolution }).resolution).toBe(resolution);
    }
    expect(() => parseGenerateVideoRequest({ prompt: "x", idempotency_key: "seed-1080", resolution: "1080p" })).toThrow(/720p or 480p/);
    expect(parseGenerateVideoRequest({
      prompt: "x", idempotency_key: "grok-1080", model: "x-ai/grok-imagine-video-1.5", resolution: "1080p",
    }).resolution).toBe("1080p");
    expect(() => parseGenerateVideoRequest({
      ...omni,
      idempotency_key: "omni-4",
      references: [1, 2, 3, 4].map((i) => ({ url: `https://example.com/${i}.jpg` })),
    })).toThrow(/at most 3/);
  });

  it("lets Gemini Omni pin a first and last frame on top of 3 references", () => {
    const refs = [
      { url: "https://example.com/start.jpg", role: "first_frame" },
      { url: "https://example.com/1.jpg" },
      { url: "https://example.com/2.jpg" },
      { url: "https://example.com/3.jpg" },
      { url: "https://example.com/end.jpg", role: "last_frame" },
    ];
    const omni = { prompt: "x", model: "google/gemini-omni-1.2-flash" };
    expect(parseGenerateVideoRequest({ ...omni, idempotency_key: "f1", references: refs }).references).toHaveLength(5);
    expect(() => parseGenerateVideoRequest({
      ...omni,
      idempotency_key: "f2",
      references: [refs[4], { url: "https://example.com/end2.jpg", role: "last_frame" }],
    })).toThrow(/at most one last_frame/);
    expect(() => parseGenerateVideoRequest({
      prompt: "x", idempotency_key: "f3", references: [refs[4]],
    })).toThrow(/cannot pin a last frame/);
  });
});
