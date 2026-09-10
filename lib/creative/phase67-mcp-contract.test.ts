import { describe, expect, it } from "vitest";
import { VIDEO_MCP_TOOLS } from "../mcp-server/mcp";
import { CREATIVE_OPERATION_TYPES, parseCreativeOperationInput } from "./operation-contract";

function tool(name: string): any {
  const found = (VIDEO_MCP_TOOLS as readonly any[]).find((entry) => entry.name === name);
  if (!found) throw new Error(`Missing ${name}`);
  return found;
}

describe("Phase 6/7 MCP exposure", () => {
  it("advertises the deterministic analysis and revision-comparison tools", () => {
    for (const name of [
      "studio_inspect_timeline_state",
      "studio_critique_creative_project",
      "studio_analyze_reference_video",
      "studio_build_reference_skeleton",
      "studio_compare_creative_revisions",
    ]) expect(tool(name).inputSchema.additionalProperties).toBe(false);
    expect(tool("studio_compare_creative_revisions").inputSchema.properties.times_ms.maxItems).toBe(12);
  });

  it("publishes the remaining authoring helper operations through the canonical edit schema", () => {
    for (const type of ["set_asset_alias", "set_project_attachment", "remove_project_attachment", "add_composition_template"]) {
      expect(CREATIVE_OPERATION_TYPES).toContain(type);
    }
    expect(parseCreativeOperationInput({ type: "add_composition_template", template: "hero", sceneId: "hero-scene" })).toMatchObject({ type: "add_composition_template", template: "hero", sceneId: "hero-scene" });
  });
});
