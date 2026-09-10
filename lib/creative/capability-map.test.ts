/**
 * The map is only safe to publish before the first tool call if it cannot name
 * something that does not exist. An agent trusts it precisely because it
 * arrives with authority and before any evidence.
 */
import { describe, expect, it } from "vitest";
import {
  CREATIVE_CAPABILITY_MAP,
  CREATIVE_KNOWN_GAPS,
  creativeCapabilityDigest,
  creativeCapabilityReferences,
  renderCreativeCapabilityGuide,
} from "./capability-map";
import { CREATIVE_OPERATION_TYPES } from "./operation-contract";
import { CREATIVE_MCP_TOOL_NAMES } from "./mcp-runtime";
import { handleMcpMessage } from "../mcp-server/mcp";

describe("creative capability map", () => {
  it("names only operations and tools that actually exist", () => {
    const known = new Set<string>([...CREATIVE_OPERATION_TYPES, ...CREATIVE_MCP_TOOL_NAMES]);
    expect(creativeCapabilityReferences().filter((name) => !known.has(name))).toEqual([]);
  });

  it("names the manual approach, not just the primitive", () => {
    // "Use set_chart_data" helps nobody who has not yet realised they are
    // drawing a chart, so every entry has to describe what the agent is doing.
    for (const entry of CREATIVE_CAPABILITY_MAP) {
      expect(entry.instead.length, entry.use.join(",")).toBeGreaterThan(30);
      expect(entry.use.length).toBeGreaterThan(0);
    }
  });

  it("covers the primitives a real build rebuilt by hand", () => {
    const used = creativeCapabilityReferences();
    for (const primitive of [
      "set_chart_data", "set_glass", "set_group_transform", "set_scene_camera",
      "stagger_group", "apply_text_animation", "set_connector", "continue_element",
      "update_elements", "set_text_fit", "normalize_timeline_duration",
    ]) {
      expect(used, primitive).toContain(primitive);
    }
  });

  it("states what is missing, so the search ends in a line rather than five calls", () => {
    const gaps = CREATIVE_KNOWN_GAPS.join(" ");
    expect(gaps).toMatch(/nest/i);
    // set_counter shipped native counting-number text (roadmap #60), so the
    // line that used to warn it was missing would now be lying to a caller.
    expect(gaps).not.toMatch(/counting-number/i);
    // Per-callout timing shipped (roadmap #69) - same reason.
    expect(gaps).not.toMatch(/callouts cannot be timed/i);
  });

  it("ships in the instructions the server returns on initialize", async () => {
    // The whole point is placement: this has to arrive before the first tool
    // call, not sit in a tool description nobody reads closely.
    const result = await handleMcpMessage(
      { jsonrpc: "2.0", id: 1, method: "initialize", params: { protocolVersion: "2024-11-05" } } as never,
      {} as never,
    ) as { result?: { instructions?: string } };
    const instructions = result?.result?.instructions ?? "";
    expect(instructions).toContain("REACH FOR THE PRIMITIVE");
    expect(instructions).toContain("set_chart_data");
    expect(instructions).toContain("studio_describe_creative_schema");
    expect(instructions).toContain(renderCreativeCapabilityGuide());
  });

  it("hands the same map back on the calls that open a session", () => {
    const digest = creativeCapabilityDigest();
    expect((digest.reach_for as unknown[]).length).toBe(CREATIVE_CAPABILITY_MAP.length);
    expect(digest.exact_shapes).toBe("studio_describe_creative_schema");
    expect(digest.not_available).toEqual(CREATIVE_KNOWN_GAPS);
  });
});

describe("payload size", () => {
  it("stays small enough to pay for on every connection", () => {
    // Delivered on every initialize, so it earns its bytes by preventing round
    // trips. A round trip that re-reads a 10KB tool description costs more.
    const guide = renderCreativeCapabilityGuide().length;
    const digest = JSON.stringify(creativeCapabilityDigest()).length;
    expect(guide).toBeLessThan(9000);
    expect(digest).toBeLessThan(5000);
  });
});
