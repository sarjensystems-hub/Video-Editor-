import { describe, expect, it } from "vitest";
import { createDefaultTransform, createEmptyCreativeDocument } from "./defaults";
import type { ColorValue, CreativeDocument } from "./schema";
import { validateCreativeDocument } from "./validate";

function clone<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}

function issueCodes(input: unknown) {
  return validateCreativeDocument(input).issues.map((issue) => issue.code);
}

function documentWithElements(): CreativeDocument {
  const document = createEmptyCreativeDocument({ id: "validation" });
  document.scenes[0].elements = [
    {
      id: "headline",
      name: "Headline",
      type: "text",
      text: "Hello",
      style: { token: "heading" },
      transform: createDefaultTransform({ width: 600, height: 120 }),
      timing: { startMs: 200, endMs: 4000 },
      animations: [
        {
          id: "headline-opacity",
          property: "opacity",
          keyframes: [
            { timeMs: 200, value: 0, easing: "ease-out" },
            { timeMs: 500, value: 1, easing: "ease-out" },
          ],
        },
      ],
    },
    {
      id: "image",
      name: "Image",
      type: "image",
      assetId: "asset-image",
      fit: "cover",
      crop: { x: 0, y: 0, width: 1, height: 1 },
      transform: createDefaultTransform({ zIndex: 1 }),
    },
    {
      id: "video",
      name: "Video",
      type: "video",
      assetId: "asset-video",
      sourceStartMs: 0,
      sourceEndMs: 3000,
      fit: "contain",
      volume: 1,
      playbackRate: 1,
      transform: createDefaultTransform({ zIndex: 2 }),
    },
    {
      id: "accent",
      name: "Accent",
      type: "shape",
      shape: "rect",
      fill: { kind: "token", token: "accent" },
      transform: createDefaultTransform({ width: 200, height: 8, zIndex: 3 }),
    },
  ];
  document.scenes[0].groups = [
    { id: "copy", name: "Copy", elementIds: ["headline", "accent"] },
  ];
  document.scenes[0].transitionOut = { kind: "fade", durationMs: 250, easing: "ease-in-out" };
  return document;
}

describe("validateCreativeDocument", () => {
  it("accepts valid V1 documents", () => {
    const result = validateCreativeDocument(documentWithElements());
    expect(result).toEqual({ valid: true, issues: [] });
  });

  it("reports invalid top-level documents, versions and canvas values", () => {
    expect(issueCodes(null)).toContain("invalid_document");

    const document = clone(documentWithElements()) as unknown as Record<string, unknown>;
    document.version = 2;
    (document.canvas as Record<string, unknown>).width = 0;
    (document.canvas as Record<string, unknown>).height = 8193;
    (document.canvas as Record<string, unknown>).fps = 121;
    const result = validateCreativeDocument(document);

    expect(result.issues).toEqual(expect.arrayContaining([
      expect.objectContaining({ code: "unsupported_version", path: "version" }),
      expect.objectContaining({ code: "invalid_canvas", path: "canvas.width" }),
      expect.objectContaining({ code: "invalid_canvas", path: "canvas.height" }),
      expect.objectContaining({ code: "invalid_canvas", path: "canvas.fps" }),
    ]));
  });

  it("validates design tokens and conservative colors", () => {
    const document = clone(documentWithElements());
    document.canvas.background = { kind: "token", token: "missing" };
    document.designSystem.colors.bad = "red";
    document.scenes[0].elements[0].type === "text" && (document.scenes[0].elements[0].style.token = "missing-style");

    const result = validateCreativeDocument(document);
    expect(result.issues).toEqual(expect.arrayContaining([
      expect.objectContaining({ code: "missing_reference", path: "canvas.background.token" }),
      expect.objectContaining({ code: "invalid_design_token", path: "designSystem.colors.bad" }),
      expect.objectContaining({ code: "missing_reference", path: "scenes[0].elements[0].style.token" }),
    ]));
  });

  it("detects duplicate IDs in scene, element, group and animation scopes", () => {
    const document = clone(documentWithElements());
    document.scenes.push(clone(document.scenes[0]));
    document.scenes[0].elements.push(clone(document.scenes[0].elements[0]));
    document.scenes[0].groups.push(clone(document.scenes[0].groups[0]));
    const text = document.scenes[0].elements[0];
    if (text.animations) text.animations.push(clone(text.animations[0]));

    const duplicates = validateCreativeDocument(document).issues.filter((issue) => issue.code === "duplicate_id");
    expect(duplicates.map((issue) => issue.path)).toEqual(expect.arrayContaining([
      "scenes[1].id",
      "scenes[0].elements[4].id",
      "scenes[0].groups[1].id",
      "scenes[0].elements[0].animations[1].id",
    ]));
  });

  it("validates transforms, timing and animation windows", () => {
    const document = clone(documentWithElements());
    const text = document.scenes[0].elements[0];
    text.transform.width = 0;
    text.transform.opacity = 1.5;
    text.transform.anchorX = -0.1;
    text.transform.zIndex = 1.5;
    text.timing = { startMs: 1000, endMs: 900 };
    text.animations = [
      {
        id: "bad",
        property: "opacity",
        keyframes: [
          { timeMs: 1000, value: -1, easing: "ease-out" },
          { timeMs: 900, value: 2, easing: "ease-out" },
        ],
      },
    ];

    const codes = issueCodes(document);
    expect(codes).toContain("invalid_transform");
    expect(codes).toContain("invalid_timing");
    expect(codes).toContain("invalid_animation");
  });

  it("validates transitions, crops, video values and group references", () => {
    const document = clone(documentWithElements());
    document.scenes[0].transitionOut = { kind: "cut", durationMs: 100, easing: "linear" };

    const image = document.scenes[0].elements[1];
    if (image.type === "image") {
      image.assetId = "";
      image.crop = { x: 0.8, y: 0, width: 0.4, height: 1 };
    }

    const video = document.scenes[0].elements[2];
    if (video.type === "video") {
      video.sourceStartMs = -1;
      video.sourceEndMs = 0;
      video.volume = 2;
      video.playbackRate = 0;
    }

    document.scenes[0].groups = [
      { id: "one", name: "One", elementIds: ["headline", "missing"] },
      { id: "two", name: "Two", elementIds: ["headline"] },
    ];

    const result = validateCreativeDocument(document);
    expect(result.issues).toEqual(expect.arrayContaining([
      expect.objectContaining({ code: "invalid_transition" }),
      expect.objectContaining({ code: "missing_reference", path: "scenes[0].elements[1].assetId" }),
      expect.objectContaining({ code: "invalid_element", path: "scenes[0].elements[1].crop" }),
      expect.objectContaining({ code: "invalid_element", path: "scenes[0].elements[2].sourceStartMs" }),
      expect.objectContaining({ code: "missing_reference", path: "scenes[0].groups[0].elementIds[1]" }),
      expect.objectContaining({ code: "invalid_group", path: "scenes[0].groups[1].elementIds[0]" }),
    ]));
  });

  it("collects independent issues in a single pass", () => {
    const document = clone(documentWithElements());
    document.id = "";
    document.scenes[0].durationMs = 0;
    document.scenes[0].elements[3].transform.height = -1;

    const result = validateCreativeDocument(document);
    expect(result.valid).toBe(false);
    expect(result.issues.length).toBeGreaterThanOrEqual(3);
    expect(result.issues.map((issue) => issue.code)).toEqual(expect.arrayContaining([
      "invalid_document",
      "invalid_scene",
      "invalid_transform",
    ]));
  });
});

function validGradientFill(): ColorValue {
  return {
    kind: "gradient" as const,
    gradient: {
      kind: "linear" as const,
      stops: [
        { offset: 0, color: { kind: "token" as const, token: "accent" } },
        { offset: 1, color: { kind: "literal" as const, value: "#000000" } },
      ],
    },
  };
}

describe("gradients", () => {
  it("accepts a gradient wherever a background can render one - shape fill, canvas and scene background", () => {
    const document = clone(documentWithElements());
    document.scenes[0].elements[3].type === "shape" && (document.scenes[0].elements[3].fill = validGradientFill());
    document.canvas.background = validGradientFill();
    document.scenes[0].background = validGradientFill();

    expect(validateCreativeDocument(document)).toEqual({ valid: true, issues: [] });
  });

  it("rejects a gradient with fewer than two stops", () => {
    const document = clone(documentWithElements());
    const shape = document.scenes[0].elements[3];
    if (shape.type !== "shape") throw new Error("fixture drifted");
    shape.fill = { kind: "gradient", gradient: { kind: "linear", stops: [{ offset: 0, color: { kind: "literal", value: "#fff" } }] } };

    const result = validateCreativeDocument(document);
    expect(result.issues).toEqual(expect.arrayContaining([
      expect.objectContaining({ code: "invalid_design_token", path: "scenes[0].elements[3].fill.gradient.stops" }),
    ]));
  });

  it("rejects a stop offset outside 0..1", () => {
    const document = clone(documentWithElements());
    const shape = document.scenes[0].elements[3];
    if (shape.type !== "shape") throw new Error("fixture drifted");
    shape.fill = {
      kind: "gradient",
      gradient: {
        kind: "linear",
        stops: [
          { offset: -0.2, color: { kind: "literal", value: "#fff" } },
          { offset: 1.5, color: { kind: "literal", value: "#000" } },
        ],
      },
    };

    const result = validateCreativeDocument(document);
    expect(result.issues).toEqual(expect.arrayContaining([
      expect.objectContaining({ code: "invalid_design_token", path: "scenes[0].elements[3].fill.gradient.stops[0].offset" }),
      expect.objectContaining({ code: "invalid_design_token", path: "scenes[0].elements[3].fill.gradient.stops[1].offset" }),
    ]));
  });

  it("rejects an unknown gradient kind", () => {
    const document = clone(documentWithElements());
    const shape = document.scenes[0].elements[3];
    if (shape.type !== "shape") throw new Error("fixture drifted");
    shape.fill = {
      kind: "gradient",
      gradient: { kind: "sparkle", stops: [{ offset: 0, color: { kind: "literal", value: "#fff" } }, { offset: 1, color: { kind: "literal", value: "#000" } }] },
    } as unknown as typeof shape.fill;

    const result = validateCreativeDocument(document);
    expect(result.issues).toEqual(expect.arrayContaining([
      expect.objectContaining({ code: "invalid_design_token", path: "scenes[0].elements[3].fill.gradient.kind" }),
    ]));
  });

  it("rejects a gradient used where only a flat colour can render: stroke, text colour, and a gradient stop's own colour", () => {
    const document = clone(documentWithElements());
    const shape = document.scenes[0].elements[3];
    if (shape.type !== "shape") throw new Error("fixture drifted");
    shape.stroke = { width: 2, color: validGradientFill() };

    const text = document.scenes[0].elements[0];
    if (text.type !== "text") throw new Error("fixture drifted");
    text.style = { token: "heading", overrides: { color: validGradientFill() } };

    document.designSystem.typography.heading.color = validGradientFill();

    const result = validateCreativeDocument(document);
    expect(result.issues).toEqual(expect.arrayContaining([
      expect.objectContaining({ code: "invalid_design_token", path: "scenes[0].elements[3].stroke.color", message: expect.stringContaining("cannot be used here") }),
      expect.objectContaining({ code: "invalid_design_token", path: "scenes[0].elements[0].style.overrides.color", message: expect.stringContaining("cannot be used here") }),
      expect.objectContaining({ code: "invalid_design_token", path: "designSystem.typography.heading.color", message: expect.stringContaining("cannot be used here") }),
    ]));
  });

  it("rejects a gradient nested inside one of its own stops", () => {
    const document = clone(documentWithElements());
    const shape = document.scenes[0].elements[3];
    if (shape.type !== "shape") throw new Error("fixture drifted");
    const nested = validGradientFill();
    if (nested.kind !== "gradient") throw new Error("fixture drifted");
    nested.gradient.stops[0] = { offset: 0, color: validGradientFill() };
    shape.fill = nested;

    const result = validateCreativeDocument(document);
    expect(result.issues).toEqual(expect.arrayContaining([
      expect.objectContaining({ code: "invalid_design_token", path: "scenes[0].elements[3].fill.gradient.stops[0].color", message: expect.stringContaining("cannot be used here") }),
    ]));
  });
});

describe("blend mode", () => {
  it("accepts every advertised blend mode and rejects one the engine does not know", () => {
    const document = clone(documentWithElements());
    document.scenes[0].elements[0].blendMode = "multiply";
    expect(validateCreativeDocument(document)).toEqual({ valid: true, issues: [] });

    const invalid = clone(documentWithElements()) as unknown as Record<string, unknown>;
    ((invalid.scenes as Record<string, unknown>[])[0].elements as Record<string, unknown>[])[0].blendMode = "sepia";
    expect(validateCreativeDocument(invalid).issues).toEqual(expect.arrayContaining([
      expect.objectContaining({ code: "invalid_element", path: "scenes[0].elements[0].blendMode" }),
    ]));
  });
});
