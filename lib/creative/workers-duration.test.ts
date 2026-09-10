import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("./workers-base", () => ({
  generateCreativeSpeechAsset: vi.fn(async () => ({ id: "speech-1", url: "https://assets.example/speech.mp3", duration_ms: null })),
  generateCreativeMusicAsset: vi.fn(async () => ({ id: "music-1", url: "https://assets.example/music.mp3", duration_ms: null })),
}));
vi.mock("./audio-analysis", async (importOriginal) => {
  const actual = await importOriginal<typeof import("./audio-analysis")>();
  return { ...actual, probeAudioDurationMs: vi.fn(async () => 4321) };
});

import { generateCreativeMusicAsset, generateCreativeSpeechAsset } from "./workers";

function context() {
  const writes: Array<Record<string, unknown>> = [];
  return {
    writes,
    value: {
      userId: "user-1",
      supabase: {
        from: () => ({
          update: (value: Record<string, unknown>) => {
            writes.push(value);
            return { eq: () => ({ eq: async () => ({ error: null }) }) };
          },
        }),
      },
    } as any,
  };
}

describe("generated audio duration guarantee", () => {
  beforeEach(() => vi.clearAllMocks());

  it("measures and persists speech duration before returning the asset", async () => {
    const runtime = context();
    const asset = await generateCreativeSpeechAsset(runtime.value, { projectId: "p", text: "Hello" });
    expect(asset.duration_ms).toBe(4321);
    expect(runtime.writes).toEqual([{ duration_ms: 4321 }]);
  });

  it("measures and persists music duration before returning the asset", async () => {
    const runtime = context();
    const asset = await generateCreativeMusicAsset(runtime.value, { projectId: "p", prompt: "Pulse" });
    expect(asset.duration_ms).toBe(4321);
    expect(runtime.writes).toEqual([{ duration_ms: 4321 }]);
  });
});
