import { describe, expect, it } from "vitest";
import { withUploadRule, type B2CorsRule } from "./b2-cors";

describe("upload CORS rule", () => {
  const consoleRule: B2CorsRule = {
    corsRuleName: "downloadFromOneOrigin",
    allowedOrigins: ["https://app.example"],
    allowedOperations: ["s3_get", "s3_head", "b2_download_file_by_name"],
    maxAgeSeconds: 3600,
  };

  it("puts the upload rule first so it answers before a download-only rule", () => {
    const rules = withUploadRule([consoleRule], ["https://app.example", "https://app.example"]);
    expect(rules[0]).toMatchObject({
      corsRuleName: "studio-uploads",
      allowedOrigins: ["https://app.example"],
      allowedOperations: expect.arrayContaining(["s3_put"]),
    });
    expect(rules[1]).toBe(consoleRule);
  });

  it("replaces its own earlier rule instead of stacking copies", () => {
    const once = withUploadRule([consoleRule], ["https://a.example"]);
    const twice = withUploadRule(once, ["https://b.example"]);
    expect(twice.filter((rule) => rule.corsRuleName === "studio-uploads")).toHaveLength(1);
    expect(twice[0].allowedOrigins).toEqual(["https://b.example"]);
  });
});
