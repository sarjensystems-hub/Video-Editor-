import { describe, expect, it } from "vitest";
import { suggestCreativeValidationFix, validationIssueWithSuggestedFix } from "./validation-suggestions";

describe("creative validation suggestions", () => {
  it("turns missing references into an actionable read-or-create fix", () => {
    const fix = suggestCreativeValidationFix({ code: "missing_reference", path: "scenes[0].groups[0].elementIds[2]", message: "Element does not exist." });
    expect(fix).toMatch(/existing referenced id|create\/register/);
  });

  it("explains ColorValue object shape for color-related element errors", () => {
    const fix = suggestCreativeValidationFix({ code: "invalid_element", path: "scenes[0].elements[0].border.color", message: "Color is invalid." });
    expect(fix).toContain('kind: "literal"');
  });

  it("attaches suggested_fix without hiding the original validator evidence", () => {
    const issue = validationIssueWithSuggestedFix({ code: "invalid_timing", path: "scenes[0].elements[1].timing", message: "Timing ends after scene." });
    expect(issue.code).toBe("invalid_timing");
    expect(issue.message).toBe("Timing ends after scene.");
    expect(issue.suggested_fix).toMatch(/start before end|lengthen/);
  });
});
