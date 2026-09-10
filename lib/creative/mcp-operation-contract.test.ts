import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import {
  ANIMATION_PROPERTIES,
  CREATIVE_ELEMENT_TYPES,
  BLEND_MODES,
  CREATIVE_AUDIO_KINDS,
  CREATIVE_CHART_KINDS,
  CHART_LABEL_FORMATS,
  CONNECTOR_CURVES,
  EASING_NAMES,
  TEXT_FIT_MODES,
  CREATIVE_MARKER_KINDS,
  CREATIVE_MASK_KINDS,
  CREATIVE_UI_NODE_KINDS,
  GRADIENT_KINDS,
  SCENE_TRANSITION_KINDS,
  TEXT_ANIMATION_GRANULARITIES,
  TEXT_ANIMATION_MODES,
} from "./schema";
import { VIDEO_MCP_TOOLS } from "../mcp-server/mcp";
import { parseCreativeTransactionInput } from "./mcp-runtime";
import { CREATIVE_OPERATION_TYPES } from "./operation-contract";

function editOperationSchema(): any {
  const edit = VIDEO_MCP_TOOLS.find((tool: any) => tool.name === "studio_edit_creative_project") as any;
  return edit.inputSchema.properties.transaction.properties.operations.items;
}

function schemaFor(type: string): any {
  const schema = editOperationSchema();
  const choices = schema.oneOf as any[] | undefined;
  return choices?.find((choice) => choice.properties?.type?.enum?.includes(type));
}

describe("Creative Studio MCP operation contracts", () => {
  it("advertises a discriminated schema for every operation instead of type-only arbitrary JSON", () => {
    const schema = editOperationSchema();
    expect(Array.isArray(schema.oneOf)).toBe(true);
    expect(schema.oneOf).toHaveLength(CREATIVE_OPERATION_TYPES.length);
    for (const choice of schema.oneOf) {
      expect(choice.additionalProperties).toBe(false);
      expect(choice.required).toContain("type");
      expect(choice.properties.type.enum).toHaveLength(1);
    }
  });

  it("publishes the real required arguments for the stress-test editing vocabulary", () => {
    const expected: Record<string, string[]> = {
      // Neither selector is required on its own; exactly one of them is, and
      // that is enforced in the contract check rather than in JSON Schema.
      update_elements: ["type", "patch"],
      // Both clear when their optional payload is omitted, so neither requires it.
      set_scene_camera: ["type", "sceneId"],
      set_group_transform: ["type", "sceneId", "groupId"],
      animate_ui_node: ["type", "sceneId", "elementId", "nodeId", "animations"],
      set_ui_node_timing: ["type", "sceneId", "elementId", "nodeId"],
      move_ui_node: ["type", "sceneId", "elementId", "nodeId", "x", "y"],
      continue_element: ["type", "continuation"],
      remove_continuation: ["type", "continuationId"],
      continue_group: ["type", "continuation"],
      remove_group_continuation: ["type", "continuationId"],
      split_clip: ["type", "sceneId", "elementId", "atMs"],
      trim_clip: ["type", "sceneId", "elementId"],
      slip_clip: ["type", "sceneId", "elementId", "byMs"],
      set_clip_speed: ["type", "sceneId", "elementId", "speed"],
      set_clip_speed_ramp: ["type", "sceneId", "elementId"],
      freeze_clip: ["type", "sceneId", "elementId", "atMs"],
      duplicate_clip: ["type", "sceneId", "elementId", "atMs"],
      apply_text_animation: ["type", "sceneId", "elementId"],
      apply_motion_preset: ["type", "sceneId", "elementId", "presetName", "startMs"],
      set_mask: ["type", "sceneId", "elementId"],
      set_motion_blur: ["type", "sceneId", "elementId"],
      set_fill: ["type", "sceneId", "elementId", "fill"],
      // Clears back to normal when the optional payload is omitted, so it
      // is not required.
      set_blend_mode: ["type", "sceneId", "elementId"],
      set_chart_data: ["type", "sceneId", "elementId", "chartKind", "series", "stroke"],
      set_chart_point_emphasis: ["type", "sceneId", "elementId", "index"],
      set_transition: ["type", "sceneId"],
      add_audio_clip: ["type", "clip"],
      update_audio_clip: ["type", "clipId", "patch"],
      add_marker: ["type", "marker"],
      remove_marker: ["type", "markerId"],
      add_element: ["type", "sceneId", "element"],
    };
    for (const [type, required] of Object.entries(expected)) {
      const schema = schemaFor(type);
      expect(schema, `missing schema for ${type}`).toBeTruthy();
      expect(schema.required).toEqual(expect.arrayContaining(required));
    }
  });

  it("describes nested speed-ramp, mask, transition, audio and deterministic UI fields", () => {
    expect(schemaFor("set_clip_speed_ramp").properties.speedRamp.properties.keyframes.items.required).toEqual(["atMs", "speed"]);
    expect(schemaFor("set_mask").properties.mask.required).toEqual(expect.arrayContaining(["kind", "x", "y", "width", "height"]));
    expect(schemaFor("set_transition").properties.transition.required).toEqual(expect.arrayContaining(["kind", "durationMs", "easing"]));
    expect(schemaFor("add_audio_clip").properties.clip.required).toEqual(expect.arrayContaining(["id", "assetId", "kind", "startMs", "endMs", "sourceStartMs", "gain"]));

    const element = schemaFor("add_element").properties.element;
    expect(element.properties.type.enum).toEqual(expect.arrayContaining(["text", "image", "video", "shape", "ui"]));
    expect(element.properties.viewport.properties).toMatchObject({ width: { type: "integer" }, height: { type: "integer" } });
    expect(element.properties.nodes.items.properties.kind.enum).toEqual(["box", "text", "image"]);
    expect(element.properties.scroll.required).toEqual(["fromY", "toY", "startMs", "endMs", "easing"]);
    expect(element.properties.pointer.properties.keyframes.items.required).toEqual(["timeMs", "x", "y", "pressed"]);
  });

  it("rejects malformed operations before execution instead of letting undefined cross JSON boundaries", () => {
    expect(() => parseCreativeTransactionInput({
      summary: "Broken motion",
      operations: [{ type: "apply_motion_preset", sceneId: "scene-1", elementId: "title", startMs: 0 }],
    })).toThrow(/presetName is required/i);

    expect(() => parseCreativeTransactionInput({
      summary: "Broken design token",
      operations: [{ type: "set_design_token", namespace: "typography", token: "hero" }],
    })).toThrow(/value is required/i);

    expect(() => parseCreativeTransactionInput({
      summary: "Typo",
      operations: [{ type: "split_clip", sceneId: "scene-1", elementId: "clip", at_ms: 1000 }],
    })).toThrow(/atMs is required|unsupported field/i);
  });

  it("accepts a deterministic UI operation with omitted optional image content, nested nodes, scroll and pointer", () => {
    const transaction = parseCreativeTransactionInput({
      summary: "Add deterministic mobile UI",
      operations: [{
        type: "add_element",
        sceneId: "scene-1",
        element: {
          id: "ui-1",
          name: " booking flow",
          type: "ui",
          viewport: { width: 390, height: 844 },
          background: { kind: "literal", value: "#090909" },
          nodes: [{
            id: "shell",
            kind: "box",
            frame: { x: 16, y: 80, width: 358, height: 620 },
            children: [{
              id: "headline",
              kind: "text",
              frame: { x: 20, y: 24, width: 318, height: 56 },
              text: "Book service",
              style: { token: "heading" },
            }],
          }],
          scroll: { fromY: 0, toY: 180, startMs: 400, endMs: 1800, easing: "ease-in-out" },
          pointer: {
            radius: 16,
            color: { kind: "token", token: "accent" },
            keyframes: [
              { timeMs: 500, x: 330, y: 680, pressed: false },
              { timeMs: 900, x: 330, y: 680, pressed: true },
            ],
          },
          transform: { x: 100, y: 100, width: 780, height: 1688, rotation: 0, opacity: 1, anchorX: 0.5, anchorY: 0.5, zIndex: 4 },
        },
      }],
    });
    expect(transaction.operations[0].type).toBe("add_element");
    expect(JSON.parse(JSON.stringify(transaction))).toEqual(transaction);
  });

  it("accepts set_fill with a gradient and set_blend_mode", () => {
    const transaction = parseCreativeTransactionInput({
      summary: "Gradient fill and blend mode",
      operations: [
        {
          type: "set_fill",
          sceneId: "scene-1",
          elementId: "orb",
          fill: {
            kind: "gradient",
            gradient: {
              kind: "radial",
              centerX: 0.5,
              centerY: 0.4,
              stops: [
                { offset: 0, color: { kind: "token", token: "accent" } },
                { offset: 1, color: { kind: "literal", value: "#000000" } },
              ],
            },
          },
        },
        { type: "set_blend_mode", sceneId: "scene-1", elementId: "orb", blendMode: "screen" },
      ],
    });
    expect(transaction.operations.map((op) => op.type)).toEqual(["set_fill", "set_blend_mode"]);
    expect(JSON.parse(JSON.stringify(transaction))).toEqual(transaction);
  });
});

describe("the element schema describes the elements that actually exist", () => {
  const elementProperties = () => {
    const schema = editOperationSchema();
    const addElement = schema.oneOf.find(
      (choice: { properties: { type: { enum: string[] } } }) => choice.properties.type.enum[0] === "add_element",
    );
    return addElement.properties.element.properties as Record<string, Record<string, unknown>>;
  };

  it("accepts both meanings of fit", () => {
    // On image and video it is a media fit string; on text it is a shrink-to
    // -fit policy object. Declaring only the object made every valid image and
    // video element technically off-schema.
    const fit = elementProperties().fit as { oneOf: Array<Record<string, unknown>> };
    expect(Array.isArray(fit.oneOf)).toBe(true);
    const media = fit.oneOf.find((option) => option.type === "string") as { enum: string[] };
    expect(media.enum).toEqual(["cover", "contain", "fill"]);
    expect(fit.oneOf.some((option) => option.type === "object")).toBe(true);
  });

  it("advertises the background role, so scenery can be declared", () => {
    expect((elementProperties().role as { enum: string[] }).enum).toEqual(["background"]);
  });
});

/**
 * Every enum an agent is allowed to send must equal the constant the engine
 * validates against.
 *
 * These were hand-written copies. Two had already drifted: `blurPx` was added
 * to ANIMATION_PROPERTIES and never reached the schema, so an agent could not
 * send a blur track at all — the schema sets additionalProperties: false, so a
 * value missing from the enum is not merely undocumented, it is rejected. And
 * the marker enum advertised a kind ("note") that does not exist while hiding
 * two that do ("cue", "custom").
 *
 * A missing value is invisible from the engine's side: every test passes,
 * because nothing in the engine ever asks what the schema says.
 */
describe("advertised enums match the engine's own constants", () => {
  const schemaText = () => JSON.stringify(editOperationSchema());

  const cases: Array<{ name: string; values: readonly string[] }> = [
    { name: "animation properties", values: ANIMATION_PROPERTIES },
    { name: "element types", values: CREATIVE_ELEMENT_TYPES },
    { name: "marker kinds", values: CREATIVE_MARKER_KINDS },
    { name: "mask kinds", values: CREATIVE_MASK_KINDS },
    { name: "chart kinds", values: CREATIVE_CHART_KINDS },
    { name: "gradient kinds", values: GRADIENT_KINDS },
    { name: "blend modes", values: BLEND_MODES },
    { name: "ui node kinds", values: CREATIVE_UI_NODE_KINDS },
    { name: "scene transition kinds", values: SCENE_TRANSITION_KINDS },
    { name: "text animation granularities", values: TEXT_ANIMATION_GRANULARITIES },
    { name: "text animation modes", values: TEXT_ANIMATION_MODES },
    { name: "audio kinds", values: CREATIVE_AUDIO_KINDS },
    { name: "connector curves", values: CONNECTOR_CURVES },
    { name: "chart label formats", values: CHART_LABEL_FORMATS },
    { name: "easing names", values: EASING_NAMES },
    { name: "text fit modes", values: TEXT_FIT_MODES },
  ];

  for (const { name, values } of cases) {
    it(`advertises every ${name} the engine accepts`, () => {
      const text = schemaText();
      for (const value of values) {
        expect(text, `${name}: "${value}" is valid but not advertised`).toContain(`"${value}"`);
      }
    });
  }

  it("advertises blurPx, the one that blocked a session", () => {
    // Named separately because this is the regression, not a general rule.
    expect(schemaText()).toContain('"blurPx"');
  });

  it("does not advertise a marker kind the engine would reject", () => {
    // "note" was advertised and is not a real kind.
    const markerEnum = editOperationSchema().oneOf
      .find((choice: { properties: { type: { enum: string[] } } }) => choice.properties.type.enum[0] === "add_marker");
    const kinds: string[] = markerEnum.properties.marker.properties.kind.enum;
    expect(kinds).toEqual([...CREATIVE_MARKER_KINDS]);
  });

  it("advertises exactly the blend modes the engine validates against, on both the element schema and set_blend_mode", () => {
    const elementBlendMode = schemaFor("add_element").properties.element.properties.blendMode.enum;
    expect(elementBlendMode).toEqual([...BLEND_MODES]);
    const opBlendMode = schemaFor("set_blend_mode").properties.blendMode.enum;
    expect(opBlendMode).toEqual([...BLEND_MODES]);
  });
});

/**
 * Every advertised colour must be the shape the document validator accepts.
 *
 * A UI node border advertised `color` as a plain string while the validator
 * wanted a ColorValue object. A caller that trusted the schema got
 * "Color must be a literal or token reference" and had no correct form to send,
 * because sending the object would have contradicted the schema it was given.
 * It removed its borders rather than guess.
 *
 * Same family as the enum drift: the schema and the engine describing one
 * contract differently, invisible to any test that only exercises the engine.
 */
describe("advertised colours are the shape the validator accepts", () => {
  const colourPaths = (node: unknown, path: string[] = []): Array<{ path: string; value: unknown }> => {
    if (!node || typeof node !== "object") return [];
    const found: Array<{ path: string; value: unknown }> = [];
    for (const [key, value] of Object.entries(node as Record<string, unknown>)) {
      const here = [...path, key];
      // A colour-named property sitting inside a `properties` block is a field
      // declaration, not an arbitrary key called "color".
      if (/color$/i.test(key) && path[path.length - 1] === "properties") {
        found.push({ path: here.join("."), value });
      }
      found.push(...colourPaths(value, here));
    }
    return found;
  };

  const isColorValueShape = (value: unknown): boolean => {
    const schema = value as { oneOf?: Array<{ properties?: { kind?: { enum?: string[] } } }> };
    if (!Array.isArray(schema.oneOf)) return false;
    const kinds = schema.oneOf.flatMap((option) => option.properties?.kind?.enum ?? []);
    return kinds.includes("literal") && kinds.includes("token");
  };

  it("never advertises a colour as a bare string", () => {
    const colours = colourPaths(editOperationSchema());
    expect(colours.length, "found no colour fields to check — the walk is broken").toBeGreaterThan(0);

    const wrong = colours.filter((entry) => !isColorValueShape(entry.value));
    expect(wrong.map((entry) => entry.path)).toEqual([]);
  });

  it("still advertises literal and token on the gradient-capable colour, not only the gradient branch", () => {
    // A weakened guard could pass by only ever finding the gradient branch.
    // set_fill's `fill` is the one every agent reaches for first.
    const fill = schemaFor("set_fill").properties.fill;
    expect(isColorValueShape(fill)).toBe(true);
    const kinds = (fill.oneOf as Array<{ properties?: { kind?: { enum?: string[] } } }>).flatMap(
      (option) => option.properties?.kind?.enum ?? [],
    );
    expect(kinds).toEqual(expect.arrayContaining(["literal", "token", "gradient"]));
  });

  it("never lets a gradient stop's own colour be another gradient", () => {
    // A stop has to resolve to one CSS <color>; nesting would be exactly the
    // gradient-where-only-a-flat-colour-can-render mistake this feature
    // exists to reject, one level deeper.
    const fill = schemaFor("set_fill").properties.fill;
    const gradientBranch = (fill.oneOf as Array<{ properties?: { kind?: { enum?: string[] }; gradient?: unknown } }>).find(
      (option) => option.properties?.kind?.enum?.includes("gradient"),
    );
    const stopColor = (gradientBranch?.properties?.gradient as { properties?: { stops?: { items?: { properties?: { color?: unknown } } } } })
      ?.properties?.stops?.items?.properties?.color;
    expect(stopColor, "could not find the gradient stop colour schema — the walk is broken").toBeTruthy();
    const stopKinds = ((stopColor as { oneOf?: Array<{ properties?: { kind?: { enum?: string[] } } }> }).oneOf ?? []).flatMap(
      (option) => option.properties?.kind?.enum ?? [],
    );
    expect(stopKinds).toEqual(expect.arrayContaining(["literal", "token"]));
    expect(stopKinds).not.toContain("gradient");
  });
});

/**
 * The case list above is itself transcribed, which is the very thing this
 * suite exists to catch.
 *
 * Connectors were added with their curve enum left out of it, so the schema
 * happened to be right while nothing asserted it. Enumerating schema.ts and
 * requiring every enum-shaped export to be covered turns the next silent
 * omission into a failing test: a new enum either gets a case or an explicit,
 * reasoned exclusion here.
 */
describe("the enum guard covers every enum the schema defines", () => {
  const COVERED = new Set([
    "ANIMATION_PROPERTIES", "CREATIVE_ELEMENT_TYPES", "CREATIVE_MARKER_KINDS",
    "CREATIVE_MASK_KINDS", "CREATIVE_CHART_KINDS", "GRADIENT_KINDS", "BLEND_MODES",
    "CREATIVE_UI_NODE_KINDS", "SCENE_TRANSITION_KINDS", "TEXT_ANIMATION_GRANULARITIES",
    "CHART_LABEL_FORMATS",
    "TEXT_ANIMATION_MODES", "CREATIVE_AUDIO_KINDS", "CONNECTOR_CURVES", "EASING_NAMES",
    "TEXT_FIT_MODES",
  ]);

  /** Enums deliberately outside the edit contract, each with its reason. */
  const EXCLUDED = new Map<string, string>([]);

  it("has a case or a stated reason for each one", () => {
    const source = readFileSync(resolve(__dirname, "schema.ts"), "utf8");
    const exported = [...source.matchAll(/^export const ([A-Z_0-9]+) = \[/gm)].map((match) => match[1]);

    expect(exported.length, "no enum exports found - the pattern must have drifted").toBeGreaterThan(5);

    for (const name of exported) {
      expect(
        COVERED.has(name) || EXCLUDED.has(name),
        `${name} is an enum the engine validates against but no case advertises it. `
          + "Add it to the case list, or to EXCLUDED with the reason it is not in the edit contract.",
      ).toBe(true);
    }
  });
});
