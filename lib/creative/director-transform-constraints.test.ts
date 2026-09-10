import { describe, expect, it } from "vitest";
import { createCanonicalCreativeFixture } from "./fixtures";
import { buildCreativeDirectorPrompt } from "./director";

describe("creative director transform constraints", () => {
  it("tells the model the normalized transform ranges enforced by CreativeDocument validation", () => {
    const prompt = buildCreativeDirectorPrompt(
      createCanonicalCreativeFixture(),
      "Make the composition more confident",
    );

    expect(prompt).toMatch(/anchorX.*anchorY.*between 0 and 1/i);
    expect(prompt).toMatch(/opacity.*between 0 and 1/i);
    expect(prompt).toMatch(/width.*height.*positive/i);
    expect(prompt).toMatch(/zIndex.*integer/i);
  });
});
