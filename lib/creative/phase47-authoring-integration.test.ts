import { describe, expect, it } from "vitest";
import { createCanonicalCreativeFixture } from "./fixtures";
import { applyCreativeTransaction } from "./transactions";
import { parseCreativeOperationInput } from "./operation-contract";
import { creativeAssetAliases } from "./asset-alias";
import { creativeProjectAttachments } from "./project-attachments";

describe("Phase 4/7 authoring operations", () => {
  it("parses and applies revisioned asset aliases", () => {
    expect(parseCreativeOperationInput({ type: "set_asset_alias", alias: "hero-shot", assetId: "asset-1" })).toEqual({ type: "set_asset_alias", alias: "hero-shot", assetId: "asset-1" });
    const result = applyCreativeTransaction(createCanonicalCreativeFixture(), { summary: "alias", operations: [{ type: "set_asset_alias", alias: "hero-shot", assetId: "asset-1" }] });
    expect(result.ok).toBe(true);
    if (result.ok) expect(creativeAssetAliases(result.document)).toEqual({ "hero-shot": "asset-1" });
  });

  it("stores and removes project reference/brand attachments transactionally", () => {
    let result = applyCreativeTransaction(createCanonicalCreativeFixture(), { summary: "attach", operations: [{ type: "set_project_attachment", attachment: { id: "reference", kind: "reference", assetId: "asset-ref" } }] });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(creativeProjectAttachments(result.document)).toEqual([{ id: "reference", kind: "reference", assetId: "asset-ref" }]);
    result = applyCreativeTransaction(result.document, { summary: "detach", operations: [{ type: "remove_project_attachment", attachmentId: "reference" }] });
    expect(result.ok).toBe(true);
    if (result.ok) expect(creativeProjectAttachments(result.document)).toEqual([]);
  });

  it("adds a deterministic editable composition template as a normal scene", () => {
    const result = applyCreativeTransaction(createCanonicalCreativeFixture(), { summary: "template", operations: [{ type: "add_composition_template", template: "split", sceneId: "scene-template", durationMs: 2200, index: 0 }] });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const scene = result.document.scenes[0];
    expect(scene.id).toBe("scene-template");
    expect(scene.durationMs).toBe(2200);
    expect(scene.elements.some((element) => element.alias === "scene-template.left")).toBe(true);
  });
});
