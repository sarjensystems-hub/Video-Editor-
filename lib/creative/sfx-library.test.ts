import { describe, expect, it } from "vitest";
import { CREATIVE_SFX_LIBRARY, generateDeterministicSfxWav } from "./sfx-library";

describe("deterministic SFX library", () => {
  it("exposes a compact built-in vocabulary", () => {
    expect(CREATIVE_SFX_LIBRARY.map((effect) => effect.id)).toEqual(["ui-click", "ui-pop", "whoosh", "success", "error", "impact"]);
  });

  it("renders byte-identical PCM WAV audio", () => {
    const first = generateDeterministicSfxWav("whoosh");
    expect(first.bytes.equals(generateDeterministicSfxWav("whoosh").bytes)).toBe(true);
    expect(first.bytes.subarray(0, 4).toString("ascii")).toBe("RIFF");
    expect(first.contentType).toBe("audio/wav");
    expect(first.durationMs).toBe(400);
  });
});
