import { describe, expect, it } from "vitest";
import { estimateRenderCompletionMs } from "./render";

describe("render completion estimate", () => {
  it("derives a stable ETA from elapsed time and progress", () => {
    expect(estimateRenderCompletionMs(1_000, 0.25, 11_000)).toBe(41_000);
  });

  it("withholds an ETA before measurable progress", () => {
    expect(estimateRenderCompletionMs(1_000, 0, 11_000)).toBeNull();
    expect(estimateRenderCompletionMs(1_000, 1, 11_000)).toBe(11_000);
  });
});
