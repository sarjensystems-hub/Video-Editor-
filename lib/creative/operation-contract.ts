import * as current from "./operation-contract-consolidated";
import type { CreativeTransactionOperation } from "./transactions";

type JsonSchema = Record<string, unknown>;

const str = (description?: string): JsonSchema => ({
  type: "string",
  minLength: 1,
  ...(description ? { description } : {}),
});
const num = (description?: string): JsonSchema => ({
  type: "number",
  ...(description ? { description } : {}),
});

/**
 * SVG stroke/fill attributes require a single colour. A CSS gradient function
 * is valid for shape/UI backgrounds but is not a valid SVG paint value unless
 * the renderer creates a dedicated gradient definition. Until chart-native
 * gradient paint exists, advertise only the literal/token shapes the validator
 * and renderer truly support.
 */
const flatColorSchema: JsonSchema = {
  oneOf: [
    {
      type: "object",
      additionalProperties: false,
      properties: { kind: { type: "string", enum: ["literal"] }, value: str() },
      required: ["kind", "value"],
    },
    {
      type: "object",
      additionalProperties: false,
      properties: { kind: { type: "string", enum: ["token"] }, token: str() },
      required: ["kind", "token"],
    },
  ],
};

const flatStrokeSchema: JsonSchema = {
  type: "object",
  additionalProperties: false,
  properties: { width: num(), color: flatColorSchema },
  required: ["width", "color"],
};

function operationType(schema: JsonSchema): string | undefined {
  const properties = schema.properties as Record<string, JsonSchema> | undefined;
  const typeSchema = properties?.type as { enum?: unknown[] } | undefined;
  return typeof typeSchema?.enum?.[0] === "string" ? String(typeSchema.enum[0]) : undefined;
}

function withProperties(schema: JsonSchema, patches: Record<string, JsonSchema>): JsonSchema {
  return {
    ...schema,
    properties: {
      ...((schema.properties as Record<string, JsonSchema> | undefined) ?? {}),
      ...patches,
    },
  };
}

function annotateGenericElementSchema(schema: JsonSchema): JsonSchema {
  const operationProperties = (schema.properties as Record<string, JsonSchema> | undefined) ?? {};
  const elementSchema = operationProperties.element;
  if (!elementSchema) return schema;
  const elementProperties = (elementSchema.properties as Record<string, JsonSchema> | undefined) ?? {};
  const pointEmphasis = elementProperties.pointEmphasis;
  const pointItem = pointEmphasis && (pointEmphasis.items as JsonSchema | undefined);
  const pointProperties = (pointItem?.properties as Record<string, JsonSchema> | undefined) ?? {};
  return withProperties(schema, {
    element: {
      ...elementSchema,
      properties: {
        ...elementProperties,
        // Every current element stroke resolves to a single CSS/SVG colour.
        stroke: flatStrokeSchema,
        fill: {
          ...(elementProperties.fill ?? {}),
          description:
            "ColorValue. Gradient fills are valid for shape/background surfaces. Chart fills are SVG paint and must be literal or token colours.",
        },
        ...(pointEmphasis
          ? {
              pointEmphasis: {
                ...pointEmphasis,
                ...(pointItem
                  ? {
                      items: {
                        ...pointItem,
                        properties: { ...pointProperties, color: flatColorSchema },
                      },
                    }
                  : {}),
              },
            }
          : {}),
      },
    },
  });
}

function tightenAdvertisedColorContract(schema: JsonSchema): JsonSchema {
  const type = operationType(schema);
  if (type === "set_chart_data") {
    return withProperties(schema, {
      stroke: flatStrokeSchema,
      fill: {
        ...flatColorSchema,
        description:
          "Optional chart fill. Literal/token only; CSS gradient values are not valid SVG chart paint in the current renderer.",
      },
    });
  }
  if (type === "set_chart_point_emphasis") {
    return withProperties(schema, {
      color: {
        ...flatColorSchema,
        description: "Optional chart point/bar emphasis colour. Literal/token only.",
      },
    });
  }
  if (type === "set_connector") {
    return withProperties(schema, { stroke: flatStrokeSchema });
  }
  if (type === "set_fill") {
    const properties = (schema.properties as Record<string, JsonSchema> | undefined) ?? {};
    return withProperties(schema, {
      fill: {
        ...(properties.fill ?? {}),
        description:
          "ColorValue. Gradients are supported for shape fills; chart fills must use a literal/token colour.",
      },
    });
  }
  if (type === "add_element") return annotateGenericElementSchema(schema);
  return schema;
}

const sourceSchemas =
  ((current.CREATIVE_OPERATION_SCHEMA as { oneOf?: JsonSchema[] }).oneOf ?? []);
const operationSchemas = sourceSchemas.map(tightenAdvertisedColorContract);

export const CREATIVE_OPERATION_SCHEMA: JsonSchema = { oneOf: operationSchemas };
export const CREATIVE_OPERATION_TYPES = [...current.CREATIVE_OPERATION_TYPES];

export function parseCreativeOperationInput(value: unknown): CreativeTransactionOperation {
  return current.parseCreativeOperationInput(value);
}
