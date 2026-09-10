import { describe, expect, it } from "vitest";
import { CREATIVE_OPERATION_SCHEMA } from "./operation-contract";

type JsonSchema = Record<string, unknown>;

function operation(type: string): JsonSchema {
  const schemas = (CREATIVE_OPERATION_SCHEMA.oneOf as JsonSchema[]) ?? [];
  const found = schemas.find((schema) => {
    const properties = schema.properties as Record<string, JsonSchema> | undefined;
    const values = (properties?.type as { enum?: unknown[] } | undefined)?.enum;
    return values?.[0] === type;
  });
  if (!found) throw new Error(`Missing operation schema: ${type}`);
  return found;
}

function property(schema: JsonSchema, key: string): JsonSchema {
  const properties = schema.properties as Record<string, JsonSchema> | undefined;
  const value = properties?.[key];
  if (!value) throw new Error(`Missing schema property: ${key}`);
  return value;
}

function advertisedKinds(schema: JsonSchema): string[] {
  const variants = (schema.oneOf as JsonSchema[] | undefined) ?? [];
  return variants.flatMap((variant) => {
    const kind = property(variant, "kind") as { enum?: string[] };
    return kind.enum ?? [];
  });
}

describe("chart colour contract", () => {
  it("does not advertise gradients for native chart fills", () => {
    const fill = property(operation("set_chart_data"), "fill");
    expect(advertisedKinds(fill)).toEqual(["literal", "token"]);
    expect(JSON.stringify(fill)).not.toContain('"gradient"');
  });

  it("does not advertise gradients for chart emphasis or chart strokes", () => {
    const emphasis = property(operation("set_chart_point_emphasis"), "color");
    const stroke = property(operation("set_chart_data"), "stroke");
    const strokeColor = property(stroke, "color");
    expect(advertisedKinds(emphasis)).toEqual(["literal", "token"]);
    expect(advertisedKinds(strokeColor)).toEqual(["literal", "token"]);
  });

  it("keeps generic shape fill gradients available while documenting the chart restriction", () => {
    const fill = property(operation("set_fill"), "fill");
    expect(JSON.stringify(fill)).toContain('"gradient"');
    expect(String(fill.description)).toMatch(/gradients.*shape.*chart.*literal\/token/i);
  });

  it("documents the same target-specific rule on add_element", () => {
    const element = property(operation("add_element"), "element");
    const fill = property(element, "fill");
    expect(String(fill.description)).toMatch(/gradient.*shape.*chart.*literal.*token/i);
    const stroke = property(element, "stroke");
    expect(advertisedKinds(property(stroke, "color"))).toEqual(["literal", "token"]);
  });
});
