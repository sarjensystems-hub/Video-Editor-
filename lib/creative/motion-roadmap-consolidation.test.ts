import { readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { createCanonicalCreativeFixture } from "./fixtures";
import { applyCreativeTransaction } from "./transactions";
import { CREATIVE_OPERATION_SCHEMA, parseCreativeOperationInput } from "./operation-contract";
import { suggestEditPoints } from "./audio-analysis";
import { scoreReferenceSimilarity } from "./reference-similarity";
import { buildReferenceTimelineSkeleton } from "./reference-skeleton";
import { transactionErrorWithSuggestedFix } from "./validation-suggestions";
import type { ReferenceVideoAnalysis } from "./reference-analysis";

const ROOT = resolve(__dirname, "..", "..");
function findOperation(type: string): any {
  return (CREATIVE_OPERATION_SCHEMA as any).oneOf.find((entry: any) => entry.properties?.type?.enum?.[0] === type);
}
const reference: ReferenceVideoAnalysis = {
  duration_ms: 8000,
  sample_times_ms: [0, 1000, 2000, 3000, 4000, 5000, 6000, 7000],
  cuts: [{ time_ms: 4000, change_score: 0.8 }],
  shot_durations_ms: [4000, 4000],
  change_scores: [{ time_ms: 1000, score: 0.1 }],
  cut_threshold: 0.5,
  average_non_cut_change: 0.12,
  visual_density: 0.35,
  luminance_contrast: 0.25,
  composition_center: { x: 0.5, y: 0.45 },
  palette: ["#0a0a0a", "#ffffff", "#ef4444"],
  limitations: ["fixture"],
};

describe("motion roadmap consolidation", () => {
  it("retains changed edit responses and compact dry-run impact", () => {
    const runtime = readFileSync(join(ROOT, "lib/creative/mcp-runtime-base.ts"), "utf8");
    expect(runtime).toMatch(/input\.return === "changed"/);
    expect(runtime).toMatch(/changedDocumentPayload/);
    expect(runtime).toMatch(/const impact = diffCreativeDocuments/);
    expect(runtime).toMatch(/dry_run:\s*true/);
  });

  it("extends design tokens to strokes and motion", () => {
    const tokenSchema = findOperation("set_design_token");
    expect(tokenSchema.properties.namespace.enum).toEqual(expect.arrayContaining([
      "strokes", "motionPresets", "sceneTransitions",
    ]));
    expect(() => parseCreativeOperationInput({
      type: "set_design_token",
      namespace: "strokes",
      token: "hairline",
      value: { width: 1, color: { kind: "literal", value: "#ffffff" } },
    })).not.toThrow();

    const result = applyCreativeTransaction(createCanonicalCreativeFixture(), {
      summary: "Add reusable design tokens",
      operations: [
        { type: "set_design_token", namespace: "strokes", token: "hairline", value: { width: 1, color: { kind: "literal", value: "#ffffff" } } },
        { type: "set_design_token", namespace: "motionPresets", token: "micro-rise", value: { durationMs: 240, easing: "ease-out", tracks: [{ property: "y", mode: "delta", from: 14, to: 0 }] } },
        { type: "set_design_token", namespace: "sceneTransitions", token: "soft-cut", value: { kind: "fade", durationMs: 180, easing: "ease-in-out" } },
      ],
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.document.designSystem.strokes.hairline.width).toBe(1);
    expect(result.document.designSystem.motion.presets["micro-rise"].durationMs).toBe(240);
    expect(result.document.designSystem.motion.sceneTransitions["soft-cut"].kind).toBe("fade");
  });

  it("duplicates a grouped composition as a deterministic reusable macro", () => {
    const result = applyCreativeTransaction(createCanonicalCreativeFixture(), {
      summary: "Reuse the copy lockup",
      operations: [{
        type: "duplicate_group",
        sceneId: "scene-1",
        groupId: "copy-lockup",
        newGroupId: "copy-lockup-2",
        idPrefix: "copy2-",
        dy: -160,
      }],
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const scene = result.document.scenes[0];
    expect(scene.groups.find((group) => group.id === "copy-lockup-2")?.elementIds).toEqual([
      "copy2-headline", "copy2-accent-line",
    ]);
    expect(scene.elements.some((element) => element.id === "copy2-headline")).toBe(true);
  });

  it("turns measured waveform onsets into spaced edit suggestions", () => {
    const points = suggestEditPoints([0.05, 0.08, 0.9, 0.1, 0.1, 0.95, 0.08, 0.1, 0.85], 100, { minGapMs: 200 });
    expect(points.length).toBeGreaterThan(0);
    expect(points.every((point) => point.confidence >= 0 && point.confidence <= 1)).toBe(true);
    expect(points).toEqual([...points].sort((a, b) => a.timeMs - b.timeMs));
  });

  it("embeds deterministic project-vs-reference similarity in the reference scaffold", () => {
    const document = createCanonicalCreativeFixture();
    const score = scoreReferenceSimilarity(document, reference);
    expect(score.score).toBeGreaterThanOrEqual(0);
    expect(score.score).toBeLessThanOrEqual(100);
    const skeleton = buildReferenceTimelineSkeleton(document, reference);
    expect((skeleton.metadata as any).referenceSimilarity.score).toBe(score.score);
  });

  it("attaches an actionable suggested repair to transaction errors", () => {
    const error = transactionErrorWithSuggestedFix({ code: "invalid_element", message: "Color must use ColorValue", operationIndex: 2 });
    expect(error.suggested_fix).toMatch(/ColorValue|color/i);
    expect(error.operationIndex).toBe(2);
  });

  it("keeps rounded/polygon masks and element blend modes in the canonical operation contract", () => {
    const mask = findOperation("set_mask").properties.mask;
    expect(mask.properties.radius).toBeDefined();
    expect(mask.properties.points).toBeDefined();
    expect(findOperation("set_blend_mode")).toBeDefined();
  });
});
