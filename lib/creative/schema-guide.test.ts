/**
 * The guide is only worth publishing if it cannot drift.
 *
 * A doc that says `set_text_fit` takes an object is worse than no doc, because
 * a caller believes it and spends a transaction discovering the validator wants
 * two named fields. So nothing here is checked for prose quality: every example
 * is APPLIED, through the same `applyCreativeTransaction` the MCP edit tool
 * runs, against a fixture built to be exactly what the examples assume. An
 * example that stops matching the engine fails this suite instead of being
 * published as a lie.
 */

import { describe, expect, it } from "vitest";
import {
  CREATIVE_COORDINATE_SPACES,
  CREATIVE_ELEMENT_EXAMPLES,
  CREATIVE_OPERATION_EXAMPLES,
  CREATIVE_SCHEMA_GUIDE_SECTIONS,
  CREATIVE_STRUCTURAL_INVARIANTS,
  CREATIVE_TIME_BASES,
  MAX_TRANSACTION_OPERATIONS,
  describeCreativeSchema,
} from "./schema-guide";
import { CREATIVE_OPERATION_TYPES } from "./operation-contract";
import { parseCreativeTransactionInput } from "./mcp-runtime";
import { applyCreativeTransaction } from "./transactions";
import { createNeutralDesignSystem } from "./defaults";
import { validateCreativeDocument } from "./validate";
import { VIDEO_MCP_TOOLS } from "../mcp-server/mcp";
import { CREATIVE_ELEMENT_TYPES } from "./schema";
import type { CreativeDocument } from "./schema";

/**
 * The document every example is written against, and the reason the examples
 * can share one set of ids: two scenes with an overlap between them, a group
 * on each side of the cut, and one element of every type that an operation
 * addresses.
 */
function guideFixture(): CreativeDocument {
  const box = (x: number, y: number, width: number, height: number, zIndex: number) => ({
    x, y, width, height, rotation: 0, opacity: 1, anchorX: 0, anchorY: 0, zIndex,
  });
  return {
    version: 1,
    id: "schema-guide-fixture",
    title: "Schema guide fixture",
    canvas: { width: 1920, height: 1080, fps: 30, background: { kind: "token", token: "background" } },
    designSystem: createNeutralDesignSystem(),
    scenes: [
      {
        id: "scene-1",
        name: "Open",
        durationMs: 6000,
        background: { kind: "token", token: "background" },
        // The overlap every continuation example needs to fit inside.
        transitionOut: { kind: "fade", durationMs: 800, easing: "ease-in-out" },
        elements: [
          { ...CREATIVE_ELEMENT_EXAMPLES.image, transform: box(0, 0, 1920, 1080, 0) },
          // Given an explicit window here, unlike the published example, so the
          // clip examples have a bounded duration to split, trim and duplicate.
          { ...CREATIVE_ELEMENT_EXAMPLES.video, timing: { startMs: 0, endMs: 4000 }, transform: box(0, 0, 1920, 1080, 1) },
          { ...CREATIVE_ELEMENT_EXAMPLES.shape, transform: box(120, 180, 1300, 420, 2) },
          { ...CREATIVE_ELEMENT_EXAMPLES.text, transform: box(160, 220, 1200, 260, 3) },
          { ...CREATIVE_ELEMENT_EXAMPLES.ui, transform: box(1040, 520, 720, 420, 4) },
          { ...CREATIVE_ELEMENT_EXAMPLES.chart, transform: box(160, 620, 760, 320, 3) },
          { ...CREATIVE_ELEMENT_EXAMPLES.connector, transform: box(0, 0, 1920, 1080, 5) },
        ],
        groups: [{ id: "card", name: "Metric card", elementIds: ["title", "plate"] }],
      },
      {
        id: "scene-2",
        name: "Proof",
        durationMs: 5000,
        elements: [
          { ...CREATIVE_ELEMENT_EXAMPLES.shape, id: "plate-2", transform: box(120, 180, 1300, 420, 2) },
          // Scene 2 is shorter than scene 1, and element timing is bounded by
          // the scene it lives in.
          { ...CREATIVE_ELEMENT_EXAMPLES.text, id: "title-2", timing: { startMs: 400, endMs: 4600 }, transform: box(160, 220, 1200, 260, 3) },
        ],
        groups: [{ id: "card-2", name: "Metric card B", elementIds: ["title-2", "plate-2"] }],
      },
    ],
  } as unknown as CreativeDocument;
}

/**
 * Prerequisites for the handful of operations that constrain something other
 * than their own arguments. Keeping them here rather than in the fixture is
 * deliberate: an invariant like "continue_group needs a transform on both
 * sides" is then demonstrated by the setup, not hidden inside a fixture nobody
 * reads.
 */
const PREREQUISITES: Record<string, Record<string, unknown>[]> = {
  continue_group: [
    { type: "set_group_transform", sceneId: "scene-1", groupId: "card", transform: { x: 0, y: 0, scaleX: 1, scaleY: 1, rotation: 0, opacity: 1, anchorX: 0.5, anchorY: 0.5 } },
    { type: "set_group_transform", sceneId: "scene-2", groupId: "card-2", transform: { x: 0, y: 0, scaleX: 1, scaleY: 1, rotation: 0, opacity: 1, anchorX: 0.5, anchorY: 0.5 } },
  ],
  remove_continuation: [CREATIVE_OPERATION_EXAMPLES.continue_element.example],
  remove_group_continuation: [
    { type: "set_group_transform", sceneId: "scene-1", groupId: "card", transform: { x: 0, y: 0, scaleX: 1, scaleY: 1, rotation: 0, opacity: 1, anchorX: 0.5, anchorY: 0.5 } },
    { type: "set_group_transform", sceneId: "scene-2", groupId: "card-2", transform: { x: 0, y: 0, scaleX: 1, scaleY: 1, rotation: 0, opacity: 1, anchorX: 0.5, anchorY: 0.5 } },
    CREATIVE_OPERATION_EXAMPLES.continue_group.example,
  ],
  // The published example adds the canonical text element, which the fixture
  // already carries so that every other example has something to address.
  add_element: [{ type: "remove_element", sceneId: "scene-1", elementId: "title" }],
  // Both retimings make the clip outlast a 6000ms scene, which is the point of
  // the invariant they demonstrate.
  set_clip_speed: [{ type: "update_scene", sceneId: "scene-1", patch: { durationMs: 12000 } }],
  duplicate_clip: [{ type: "update_scene", sceneId: "scene-1", patch: { durationMs: 12000 } }],
  // A gradient animation needs a gradient to animate.
  set_gradient_animation: [CREATIVE_OPERATION_EXAMPLES.set_fill.example],
  remove_marker: [CREATIVE_OPERATION_EXAMPLES.add_marker.example],
  update_audio_clip: [CREATIVE_OPERATION_EXAMPLES.add_audio_clip.example],
  remove_audio_clip: [CREATIVE_OPERATION_EXAMPLES.add_audio_clip.example],
  remove_project_attachment: [CREATIVE_OPERATION_EXAMPLES.set_project_attachment.example],
  // The seeded group already holds title and plate, so the example that adds
  // one has to start from a scene where they are free.
  create_group: [{ type: "ungroup", sceneId: "scene-1", groupId: "card" }],
  // duplicate_group prefixes every child id, so the source group must not
  // already have been consumed by another example's edits.
  explode_text: [{ type: "ungroup", sceneId: "scene-1", groupId: "card" }],
};

function editToolSchema(): any {
  const edit = VIDEO_MCP_TOOLS.find((tool: any) => tool.name === "studio_edit_creative_project") as any;
  return edit.inputSchema.properties.transaction.properties.operations;
}

describe("Creative schema guide", () => {
  it("publishes an example for every advertised operation", () => {
    const missing = CREATIVE_OPERATION_TYPES.filter((type) => !CREATIVE_OPERATION_EXAMPLES[type]);
    expect(missing).toEqual([]);
    // And nothing that is not a real operation, which would advertise a
    // capability the engine does not have.
    const invented = Object.keys(CREATIVE_OPERATION_EXAMPLES).filter((type) => !CREATIVE_OPERATION_TYPES.includes(type));
    expect(invented).toEqual([]);
  });

  it("publishes an example for every element type", () => {
    expect(Object.keys(CREATIVE_ELEMENT_EXAMPLES).sort()).toEqual([...CREATIVE_ELEMENT_TYPES].sort());
  });

  it("starts from a fixture the engine itself accepts", () => {
    const validation = validateCreativeDocument(guideFixture());
    expect(validation.issues.map((issue) => `${issue.path}: ${issue.message}`)).toEqual([]);
    expect(validation.valid).toBe(true);
  });

  // The point of the whole file: these are not illustrations, they run.
  for (const type of CREATIVE_OPERATION_TYPES) {
    it(`applies the published ${type} example through the real transaction pipeline`, () => {
      const entry = CREATIVE_OPERATION_EXAMPLES[type];
      expect(entry, `no example published for ${type}`).toBeDefined();

      const operations = [...(PREREQUISITES[type] ?? []), entry.example];
      // Through the MCP parser first, so an example that the tool surface
      // would reject before reaching the engine also fails here.
      const transaction = parseCreativeTransactionInput({
        summary: `schema guide example: ${type}`,
        operations,
      });
      const result = applyCreativeTransaction(guideFixture(), transaction);
      expect(
        result.ok ? "" : `${result.error.code} at operation ${result.error.operationIndex}: ${result.error.message}`,
      ).toBe("");
    });
  }

  it("holds the published transaction cap equal to the advertised one", () => {
    expect(editToolSchema().maxItems).toBe(MAX_TRANSACTION_OPERATIONS);
  });

  it("names only real operations in every invariant and time base", () => {
    const named = [
      ...CREATIVE_STRUCTURAL_INVARIANTS.flatMap((entry) => entry.operations),
      ...CREATIVE_TIME_BASES.flatMap((entry) => entry.operations),
      ...CREATIVE_COORDINATE_SPACES.flatMap((entry) => entry.operations),
    ];
    expect(named.filter((type) => !CREATIVE_OPERATION_TYPES.includes(type))).toEqual([]);
  });

  it("gives every invariant a unique id, a rule and a symptom", () => {
    const ids = CREATIVE_STRUCTURAL_INVARIANTS.map((entry) => entry.id);
    expect(new Set(ids).size).toBe(ids.length);
    for (const invariant of CREATIVE_STRUCTURAL_INVARIANTS) {
      expect(invariant.rule.length, invariant.id).toBeGreaterThan(20);
      expect(invariant.symptom.length, invariant.id).toBeGreaterThan(20);
    }
  });

  it("records the element-local text animation clock that a wrong frame exposed", () => {
    const textAnimation = CREATIVE_TIME_BASES.find((entry) => entry.operations.includes("apply_text_animation"));
    expect(textAnimation?.basis).toBe("element-local");
    // And that it is genuinely the odd one out, which is the whole trap.
    const presetTiming = CREATIVE_TIME_BASES.find((entry) => entry.operations.includes("apply_motion_preset"));
    expect(presetTiming?.basis).toBe("scene-local");
    const audioTiming = CREATIVE_TIME_BASES.find((entry) => entry.operations.includes("add_audio_clip"));
    expect(audioTiming?.basis).toBe("rendered-timeline");
  });
});

describe("describeCreativeSchema", () => {
  it("returns every section by default", () => {
    const payload = describeCreativeSchema();
    for (const section of CREATIVE_SCHEMA_GUIDE_SECTIONS) {
      const key = section === "time" ? "time_bases" : section;
      expect(Object.keys(payload)).toContain(key);
    }
    expect((payload.operations as unknown[]).length).toBe(CREATIVE_OPERATION_TYPES.length);
  });

  it("narrows to the requested operations so one lookup does not cost the whole guide", () => {
    const payload = describeCreativeSchema({ sections: ["operations"], operations: ["set_glass"] });
    expect(Object.keys(payload)).toEqual(["operations"]);
    expect(payload.operations).toHaveLength(1);
    expect((payload.operations as { type: string }[])[0].type).toBe("set_glass");
  });

  it("narrows to the requested element types", () => {
    const payload = describeCreativeSchema({ sections: ["elements"], elements: ["chart"] });
    expect(Object.keys(payload.elements as object)).toEqual(["chart"]);
  });

  it("refuses an unknown operation instead of returning nothing", () => {
    // Returning an empty list is how a caller concludes a capability is
    // missing when they only mistyped it.
    expect(() => describeCreativeSchema({ operations: ["set_glassy"] })).toThrow(/set_glass/);
    expect(() => describeCreativeSchema({ elements: ["gradient"] })).toThrow(/Unknown element type/);
    expect(() => describeCreativeSchema({ sections: ["everything" as never] })).toThrow(/Unknown section/);
  });
});
