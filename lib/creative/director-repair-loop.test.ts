import { beforeEach, describe, expect, it, vi } from "vitest";
import { createCanonicalCreativeFixture } from "./fixtures";

vi.mock("../openrouter", () => ({
  extractJson: (raw: string) => raw,
  fetchAIResponse: vi.fn(),
}));

import { fetchAIResponse } from "../openrouter";
import { getCreativeDurationMs } from "./evaluate";
import { planCreativeTransaction } from "./director";
import { applyCreativeTransaction } from "./transactions";

describe("creative director repair convergence", () => {
  beforeEach(() => {
    vi.mocked(fetchAIResponse).mockReset();
  });

  it("uses a second bounded repair when the first repair still misses an explicit duration target", async () => {
    const base = createCanonicalCreativeFixture();
    const document = {
      ...base,
      scenes: [
        {
          ...base.scenes[0],
          id: "scene-1",
          name: "First",
          durationMs: 7000,
          transitionOut: { kind: "fade" as const, durationMs: 500, easing: "ease-in-out" as const },
          groups: [],
          elements: [],
        },
        {
          ...base.scenes[0],
          id: "scene-2",
          name: "Second",
          durationMs: 8000,
          transitionOut: undefined,
          groups: [],
          elements: [],
        },
      ],
    };

    vi.mocked(fetchAIResponse)
      .mockResolvedValueOnce(JSON.stringify({
        summary: "Initial duration attempt",
        operations: [{ type: "update_scene", sceneId: "scene-2", patch: { durationMs: 8000 } }],
      }))
      .mockResolvedValueOnce(JSON.stringify({
        summary: "First repair still short",
        operations: [{ type: "update_scene", sceneId: "scene-2", patch: { durationMs: 8250 } }],
      }))
      .mockResolvedValueOnce(JSON.stringify({
        summary: "Second repair reaches target",
        operations: [{ type: "update_scene", sceneId: "scene-2", patch: { durationMs: 8500 } }],
      }));

    const transaction = await planCreativeTransaction(document, "Preserve the overall 15-second duration.");
    const applied = applyCreativeTransaction(document, transaction);

    expect(fetchAIResponse).toHaveBeenCalledTimes(3);
    expect(applied.ok).toBe(true);
    if (!applied.ok) return;
    expect(getCreativeDurationMs(applied.document)).toBe(15000);
  });

  it("anchors duration repairs to the evaluated previous candidate without conflicting original delta guidance", async () => {
    const base = createCanonicalCreativeFixture();
    const document = {
      ...base,
      scenes: [
        {
          ...base.scenes[0],
          id: "scene-1",
          name: "First",
          durationMs: 7500,
          transitionOut: { kind: "fade" as const, durationMs: 800, easing: "ease-in-out" as const },
          groups: [],
          elements: [],
        },
        {
          ...base.scenes[0],
          id: "scene-2",
          name: "Second",
          durationMs: 7500,
          transitionOut: undefined,
          groups: [],
          elements: [],
        },
      ],
    };

    expect(getCreativeDurationMs(document)).toBe(14200);

    vi.mocked(fetchAIResponse)
      .mockResolvedValueOnce(JSON.stringify({
        summary: "Initial candidate remains at the original rendered duration",
        operations: [{ type: "update_scene", sceneId: "scene-2", patch: { durationMs: 7500 } }],
      }))
      .mockResolvedValueOnce(JSON.stringify({
        summary: "First repair reaches fourteen point four seconds",
        operations: [{ type: "update_scene", sceneId: "scene-2", patch: { durationMs: 7700 } }],
      }))
      .mockResolvedValueOnce(JSON.stringify({
        summary: "Second repair reaches the exact target",
        operations: [{ type: "update_scene", sceneId: "scene-2", patch: { durationMs: 8300 } }],
      }));

    const transaction = await planCreativeTransaction(document, "Preserve the overall 15-second duration.");
    const secondRepairPrompt = vi.mocked(fetchAIResponse).mock.calls[2]?.[0] ?? "";
    const applied = applyCreativeTransaction(document, transaction);

    expect(fetchAIResponse).toHaveBeenCalledTimes(3);
    expect(secondRepairPrompt).toContain("PREVIOUS CANDIDATE DOCUMENT SUMMARY:");
    expect(secondRepairPrompt).toContain('"currentTotalDurationMs":14400');
    expect(secondRepairPrompt).toContain('"previousCandidateRenderedDurationMs":14400');
    expect(secondRepairPrompt).toContain('"requiredRenderedDurationMs":15000');
    expect(secondRepairPrompt).toContain('"requiredRemainingDeltaMs":600');
    expect(secondRepairPrompt).not.toContain('"requiredDeltaMs":800');
    expect(applied.ok).toBe(true);
    if (!applied.ok) return;
    expect(getCreativeDurationMs(applied.document)).toBe(15000);
  });
});
