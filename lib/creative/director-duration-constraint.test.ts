import { describe, expect, it } from "vitest";
import { createCanonicalCreativeFixture } from "./fixtures";
import type { CreativeTransaction } from "./transactions";
import * as director from "./director";

describe("creative director duration constraint", () => {
  it("rejects a raw 15-second scene sum that renders short because transitions overlap", () => {
    const base = createCanonicalCreativeFixture();
    const first = {
      ...base.scenes[0],
      id: "scene-1",
      name: "First",
      durationMs: 7000,
      transitionOut: { kind: "fade" as const, durationMs: 500, easing: "ease-in-out" as const },
      groups: [],
      elements: [],
    };
    const second = {
      ...base.scenes[0],
      id: "scene-2",
      name: "Second",
      durationMs: 8000,
      transitionOut: undefined,
      groups: [],
      elements: [],
    };
    const document = { ...base, scenes: [first, second] };
    const transaction: CreativeTransaction = {
      summary: "Keep the nominal scene sum at fifteen seconds",
      operations: [{ type: "update_scene", sceneId: "scene-2", patch: { durationMs: 8000 } }],
    };

    const guard = (director as unknown as Record<string, unknown>).validateCreativeDirectorDurationConstraint as
      | ((document: typeof base, transaction: CreativeTransaction, intent: string) => void)
      | undefined;

    expect(guard).toBeTypeOf("function");
    if (!guard) return;

    expect(() => guard(
      document as typeof base,
      transaction,
      "Preserve the overall 15-second duration.",
    )).toThrow(/expected rendered duration 15000ms.*14500ms/i);
  });

  it("resolves an explicit 15-second target separately from the shorter current rendered duration", () => {
    const base = createCanonicalCreativeFixture();
    const first = {
      ...base.scenes[0],
      id: "scene-1",
      durationMs: 7500,
      transitionOut: { kind: "fade" as const, durationMs: 800, easing: "ease-in-out" as const },
      groups: [],
      elements: [],
    };
    const second = {
      ...base.scenes[0],
      id: "scene-2",
      durationMs: 7500,
      transitionOut: undefined,
      groups: [],
      elements: [],
    };
    const document = { ...base, scenes: [first, second] } as typeof base;
    const prompt = director.buildCreativeDirectorPrompt(document, "Preserve the overall 15-second duration.");

    expect(prompt).toContain('"currentRenderedDurationMs":14200');
    expect(prompt).toContain('"requiredRenderedDurationMs":15000');
    expect(prompt).toContain('"requiredDeltaMs":800');
    expect(prompt).toMatch(/explicit target.*wins.*preserve/i);
  });
});
