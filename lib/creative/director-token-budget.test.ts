import { describe, expect, it } from "vitest";
import * as director from "./director";

describe("creative director completion budget", () => {
  it("keeps enough output headroom for complex valid CreativeDocument transactions", () => {
    const budget = (director as unknown as Record<string, unknown>).CREATIVE_DIRECTOR_MAX_TOKENS;

    expect(budget).toBeTypeOf("number");
    expect(budget).toBeGreaterThanOrEqual(12_000);
  });
});
