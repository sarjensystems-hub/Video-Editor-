import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

describe("creative render sandbox lifecycle", () => {
  it("restores renderer snapshots as ephemeral sandboxes in both allocation paths", () => {
    const source = readFileSync(new URL("./render.ts", import.meta.url), "utf8");
    const createCalls = [...source.matchAll(/Sandbox\.create\(\{([\s\S]*?)\}\)/g)].map((match) => match[1]);

    expect(createCalls).toHaveLength(2);
    for (const call of createCalls) {
      expect(call).toMatch(/source/);
      expect(call).toMatch(/persistent:\s*false/);
    }
  });
});
