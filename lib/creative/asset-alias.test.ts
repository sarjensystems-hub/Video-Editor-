import { describe, expect, it } from "vitest";
import { createCanonicalCreativeFixture } from "./fixtures";
import { creativeAssetAliases, resolveCreativeAssetId, setCreativeAssetAlias } from "./asset-alias";

describe("revisioned creative asset aliases", () => {
  it("stores aliases in document metadata and resolves them back to asset ids", () => {
    const document = setCreativeAssetAlias(createCanonicalCreativeFixture(), "hero-shot", "asset-123");
    expect(creativeAssetAliases(document)).toEqual({ "hero-shot": "asset-123" });
    expect(resolveCreativeAssetId(document, "hero-shot")).toBe("asset-123");
    expect(resolveCreativeAssetId(document, "asset-999")).toBe("asset-999");
  });

  it("removes an alias without disturbing other metadata", () => {
    let document = createCanonicalCreativeFixture();
    document = setCreativeAssetAlias(document, "hero", "asset-a");
    document = setCreativeAssetAlias(document, "logo", "asset-b");
    document = setCreativeAssetAlias(document, "hero");
    expect(creativeAssetAliases(document)).toEqual({ logo: "asset-b" });
    expect(document.metadata?.purpose).toBe("CreativeDocument V1 canonical fixture");
  });

  it("rejects aliases that would be ambiguous in an agent call", () => {
    const document = createCanonicalCreativeFixture();
    expect(() => setCreativeAssetAlias(document, "", "asset-a")).toThrow(/non-empty/);
    expect(() => setCreativeAssetAlias(document, "hero shot", "asset-a")).toThrow(/letters, numbers/);
    expect(() => setCreativeAssetAlias(document, "hero", "  ")).toThrow(/assetId/);
  });
});
