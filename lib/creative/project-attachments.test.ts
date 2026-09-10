import { describe, expect, it } from "vitest";
import { createCanonicalCreativeFixture } from "./fixtures";
import { creativeProjectAttachments, removeCreativeProjectAttachment, setCreativeProjectAttachment } from "./project-attachments";

describe("revisioned reference and brand attachments", () => {
  it("stores reference and brand asset links in the project document", () => {
    let document = createCanonicalCreativeFixture();
    document = setCreativeProjectAttachment(document, { id: "ref-main", kind: "reference", assetId: "asset-ref", label: "Reference film" });
    document = setCreativeProjectAttachment(document, { id: "brand-guide", kind: "brand", assetId: "asset-brand" });
    expect(creativeProjectAttachments(document)).toEqual([
      { id: "ref-main", kind: "reference", assetId: "asset-ref", label: "Reference film" },
      { id: "brand-guide", kind: "brand", assetId: "asset-brand" },
    ]);
  });

  it("replaces by stable attachment id and removes explicitly", () => {
    let document = createCanonicalCreativeFixture();
    document = setCreativeProjectAttachment(document, { id: "ref", kind: "reference", assetId: "a" });
    document = setCreativeProjectAttachment(document, { id: "ref", kind: "reference", assetId: "b" });
    expect(creativeProjectAttachments(document)).toEqual([{ id: "ref", kind: "reference", assetId: "b" }]);
    document = removeCreativeProjectAttachment(document, "ref");
    expect(creativeProjectAttachments(document)).toEqual([]);
  });
});
