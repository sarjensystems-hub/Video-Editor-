import { beforeEach, describe, expect, it, vi } from "vitest";

const { baseHandle } = vi.hoisted(() => ({ baseHandle: vi.fn() }));
vi.mock("./mcp-runtime-base", () => ({
  CREATIVE_MCP_TOOL_NAMES: ["studio_edit_creative_project", "studio_analyze_audio_asset"],
  MAX_CONTACT_SHEET_FRAMES: 12,
  handleCreativeMcpTool: baseHandle,
}));

import { handleCreativeMcpTool } from "./mcp-runtime";

describe("consolidated MCP guidance", () => {
  beforeEach(() => baseHandle.mockReset());

  it("adds suggested_fix to structured dry-run edit errors", async () => {
    baseHandle.mockResolvedValue({
      project_id: "p",
      dry_run: true,
      would_apply: false,
      error: { code: "invalid_element", message: "Color must use ColorValue", operationIndex: 2 },
    });
    const output = await handleCreativeMcpTool({} as any, "studio_edit_creative_project" as any, {}) as any;
    expect(output.error.suggested_fix).toMatch(/ColorValue|color/i);
    expect(output.error.operationIndex).toBe(2);
  });

  it("turns analyzed transients into deterministic edit-point suggestions", async () => {
    baseHandle.mockResolvedValue({
      asset_id: "a",
      peak_window_ms: 20,
      peaks: [0.05, 0.08, 0.9, 0.12, 0.1, 0.95, 0.1],
      transients_ms: [40, 100],
    });
    const output = await handleCreativeMcpTool({} as any, "studio_analyze_audio_asset" as any, {}) as any;
    expect(output.suggested_edit_points_ms.length).toBeGreaterThan(0);
    expect(output.suggested_edit_points.every((point: any) => point.confidence >= 0 && point.confidence <= 1)).toBe(true);
  });
});
