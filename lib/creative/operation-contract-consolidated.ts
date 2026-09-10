import * as base from "./operation-contract-base";
import { ANIMATION_PROPERTIES, SCENE_TRANSITION_KINDS } from "./schema";
import type { CreativeTransactionOperation } from "./transactions";

type JsonSchema = Record<string, unknown>;
const str = (description?: string): JsonSchema => ({ type: "string", minLength: 1, ...(description ? { description } : {}) });
const num = (description?: string): JsonSchema => ({ type: "number", ...(description ? { description } : {}) });

const flatColorSchema: JsonSchema = {
  oneOf: [
    { type: "object", additionalProperties: false, properties: { kind: { type: "string", enum: ["literal"] }, value: str() }, required: ["kind", "value"] },
    { type: "object", additionalProperties: false, properties: { kind: { type: "string", enum: ["token"] }, token: str() }, required: ["kind", "token"] },
  ],
};
const easingSchema: JsonSchema = {
  oneOf: [
    { type: "string", enum: ["linear", "ease-in", "ease-out", "ease-in-out", "spring-soft", "spring-snappy"] },
    { type: "object", additionalProperties: false, properties: { kind: { type: "string", enum: ["cubic-bezier"] }, x1: num(), y1: num(), x2: num(), y2: num() }, required: ["kind", "x1", "y1", "x2", "y2"] },
  ],
};
const strokeSchema: JsonSchema = {
  type: "object", additionalProperties: false,
  properties: { width: num(), color: flatColorSchema }, required: ["width", "color"],
};
const motionPresetSchema: JsonSchema = {
  type: "object", additionalProperties: false,
  properties: {
    durationMs: num(), easing: easingSchema,
    tracks: {
      type: "array", minItems: 1,
      items: {
        type: "object", additionalProperties: false,
        properties: {
          property: { type: "string", enum: [...ANIMATION_PROPERTIES] },
          mode: { type: "string", enum: ["absolute", "delta", "multiplier"] },
          from: num(), to: num(),
        },
        required: ["property", "mode", "from", "to"],
      },
    },
  },
  required: ["durationMs", "easing", "tracks"],
};
const sceneTransitionPresetSchema: JsonSchema = {
  type: "object", additionalProperties: false,
  properties: { kind: { type: "string", enum: [...SCENE_TRANSITION_KINDS] }, durationMs: num(), easing: easingSchema },
  required: ["kind", "durationMs", "easing"],
};

function operation(type: string, properties: Record<string, JsonSchema>, required: string[]): JsonSchema {
  return {
    type: "object", additionalProperties: false,
    properties: { type: { type: "string", enum: [type] }, ...properties },
    required: ["type", ...required],
  };
}

const replacementDesignTokenSchema = operation("set_design_token", {
  namespace: { type: "string", enum: ["colors", "spacing", "radii", "typography", "strokes", "motionPresets", "sceneTransitions"] },
  token: str(),
  value: {
    description: "Token value. Exact shape depends on namespace; canonical document validation is authoritative.",
    oneOf: [str(), num(), { type: "object" }],
  },
}, ["namespace", "token", "value"]);

const duplicateGroupSchema = operation("duplicate_group", {
  sceneId: str(), groupId: str(), idPrefix: str("Prefix applied to every duplicated child id and, by default, the new group id."),
  newGroupId: str(), name: str(), dx: num("Canvas-pixel x offset."), dy: num("Canvas-pixel y offset."),
}, ["sceneId", "groupId", "idPrefix"]);

function schemaOperationType(schema: JsonSchema): string | undefined {
  const properties = schema.properties as Record<string, JsonSchema> | undefined;
  const typeSchema = properties?.type as { enum?: unknown[] } | undefined;
  return typeof typeSchema?.enum?.[0] === "string" ? String(typeSchema.enum[0]) : undefined;
}

const baseSchemas = ((base.CREATIVE_OPERATION_SCHEMA as unknown as { oneOf?: JsonSchema[] }).oneOf ?? [])
  .filter((schema) => schemaOperationType(schema) !== "set_design_token");
const operationSchemas = [...baseSchemas, replacementDesignTokenSchema, duplicateGroupSchema];

export const CREATIVE_OPERATION_SCHEMA: JsonSchema = { oneOf: operationSchemas };
export const CREATIVE_OPERATION_TYPES = operationSchemas.map((schema) => schemaOperationType(schema)!).filter(Boolean);

function inputObject(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("operation must be an object");
  return value as Record<string, unknown>;
}
function requiredString(input: Record<string, unknown>, key: string): string {
  const value = typeof input[key] === "string" ? input[key].trim() : "";
  if (!value) throw new Error(`${key} is required`);
  return value;
}
function optionalNumber(input: Record<string, unknown>, key: string): number | undefined {
  if (input[key] === undefined) return undefined;
  const value = Number(input[key]);
  if (!Number.isFinite(value)) throw new Error(`${key} must be finite`);
  return value;
}

export function parseCreativeOperationInput(value: unknown): CreativeTransactionOperation {
  const input = inputObject(value);
  const type = requiredString(input, "type");
  if (type === "duplicate_group") {
    return {
      type,
      sceneId: requiredString(input, "sceneId"),
      groupId: requiredString(input, "groupId"),
      idPrefix: requiredString(input, "idPrefix"),
      ...(typeof input.newGroupId === "string" && input.newGroupId.trim() ? { newGroupId: input.newGroupId.trim() } : {}),
      ...(typeof input.name === "string" && input.name.trim() ? { name: input.name.trim() } : {}),
      ...(input.dx === undefined ? {} : { dx: optionalNumber(input, "dx") }),
      ...(input.dy === undefined ? {} : { dy: optionalNumber(input, "dy") }),
    };
  }
  if (type === "set_design_token") {
    const namespace = requiredString(input, "namespace");
    if (["strokes", "motionPresets", "sceneTransitions"].includes(namespace)) {
      const token = requiredString(input, "token");
      if (!input.value || typeof input.value !== "object" || Array.isArray(input.value)) {
        throw new Error(`${namespace} token value must be an object`);
      }
      return { type, namespace, token, value: input.value } as CreativeTransactionOperation;
    }
  }
  return base.parseCreativeOperationInput(value) as CreativeTransactionOperation;
}
