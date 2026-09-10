import { describe, expect, it } from "vitest";
import {
  ANIMATION_PROPERTIES,
  EASING_NAMES,
  SCENE_TRANSITION_KINDS,
  type CreativeDocument,
} from "./schema";

const contractDocument = {
  version: 1,
  id: "creative-contract",
  title: "Creative contract",
  canvas: {
    width: 1080,
    height: 1350,
    fps: 30,
    background: { kind: "token", token: "background" },
  },
  designSystem: {
    colors: {
      background: "#FFFFFF",
      foreground: "#111111",
      accent: "#F97316",
    },
    typography: {
      heading: {
        fontFamily: "Inter",
        fontSize: 64,
        fontWeight: 700,
        lineHeight: 1.05,
        letterSpacing: -1,
        align: "left",
        color: { kind: "token", token: "foreground" },
      },
    },
    spacing: { md: 24 },
    radii: { card: 24 },
    strokes: {
      subtle: { width: 1, color: { kind: "literal", value: "#E5E7EB" } },
    },
    motion: {
      presets: {
        "fade-in": {
          durationMs: 300,
          easing: "ease-out",
          tracks: [{ property: "opacity", mode: "absolute", from: 0, to: 1 }],
        },
      },
      sceneTransitions: {
        fade: { kind: "fade", durationMs: 250, easing: "ease-in-out" },
      },
    },
    mediaDirection: {
      photographicStyle: "premium automotive",
      motionIntensity: "medium",
      avoid: ["generated text"],
    },
  },
  scenes: [
    {
      id: "scene-1",
      name: "Opening",
      durationMs: 5000,
      background: { kind: "literal", value: "#000000" },
      elements: [
        {
          id: "headline",
          name: "Headline",
          type: "text",
          text: "Find the right people for your car.",
          style: { token: "heading" },
          transform: {
            x: 80,
            y: 120,
            width: 920,
            height: 180,
            rotation: 0,
            opacity: 1,
            anchorX: 0.5,
            anchorY: 0.5,
            zIndex: 3,
          },
          timing: { startMs: 400, endMs: 4800 },
          animations: [
            {
              id: "headline-y",
              property: "y",
              keyframes: [
                { timeMs: 400, value: 160, easing: "ease-out" },
                { timeMs: 800, value: 120, easing: "ease-out" },
              ],
            },
          ],
        },
        {
          id: "background",
          name: "Workshop",
          type: "image",
          assetId: "asset-workshop",
          fit: "cover",
          crop: { x: 0, y: 0, width: 1, height: 1 },
          borderRadius: 0,
          transform: {
            x: 0,
            y: 0,
            width: 1080,
            height: 1350,
            rotation: 0,
            opacity: 1,
            anchorX: 0.5,
            anchorY: 0.5,
            zIndex: 0,
          },
        },
        {
          id: "b-roll",
          name: "Workshop b-roll",
          type: "video",
          assetId: "asset-video",
          sourceStartMs: 500,
          sourceEndMs: 3500,
          fit: "cover",
          volume: 0.7,
          playbackRate: 1,
          muted: false,
          transform: {
            x: 0,
            y: 0,
            width: 1080,
            height: 1350,
            rotation: 0,
            opacity: 1,
            anchorX: 0.5,
            anchorY: 0.5,
            zIndex: 1,
          },
        },
        {
          id: "accent",
          name: "Accent",
          type: "shape",
          shape: "rect",
          fill: { kind: "token", token: "accent" },
          stroke: { width: 0, color: { kind: "token", token: "accent" } },
          borderRadius: 4,
          transform: {
            x: 80,
            y: 330,
            width: 160,
            height: 8,
            rotation: 0,
            opacity: 1,
            anchorX: 0,
            anchorY: 0.5,
            zIndex: 4,
          },
        },
      ],
      groups: [
        { id: "hero-copy", name: "Hero copy", elementIds: ["headline", "accent"] },
      ],
      transitionOut: { kind: "fade", durationMs: 250, easing: "ease-in-out" },
    },
  ],
  metadata: { purpose: "schema-contract", revision: 1 },
} satisfies CreativeDocument;

describe("CreativeDocument V1 schema", () => {
  it("supports the exact V1 easing, animation and transition vocabulary", () => {
    expect(EASING_NAMES).toEqual([
      "linear",
      "ease-in",
      "ease-out",
      "ease-in-out",
      "spring-soft",
      "spring-snappy",
    ]);
    // The six V1 properties keep their identity and leading order.
    expect(ANIMATION_PROPERTIES.slice(0, 6)).toEqual([
      "x",
      "y",
      "scaleX",
      "scaleY",
      "rotation",
      "opacity",
    ]);
    // Animated crop, added for reframes and punch-ins.
    for (const property of ["cropX", "cropY", "cropWidth", "cropHeight"]) {
      expect(ANIMATION_PROPERTIES).toContain(property);
    }
    // The five V1 kinds must keep their identity and their leading order so
    // documents written before the vocabulary grew still resolve the same way.
    expect(SCENE_TRANSITION_KINDS.slice(0, 5)).toEqual([
      "cut",
      "fade",
      "slide-left",
      "slide-right",
      "wipe-left",
    ]);
    // Editorial kinds added after V1.
    for (const kind of [
      "push-left", "push-right", "push-up",
      "zoom-in", "zoom-out", "blur", "flash",
      "whip-left", "whip-right",
    ]) {
      expect(SCENE_TRANSITION_KINDS).toContain(kind);
    }
  });

  it("represents layered static and motion content as JSON", () => {
    const json = JSON.stringify(contractDocument);
    const parsed = JSON.parse(json) as CreativeDocument;

    expect(parsed.version).toBe(1);
    expect(parsed.scenes[0].elements.map((element) => element.type)).toEqual([
      "text",
      "image",
      "video",
      "shape",
    ]);
    expect(parsed.scenes[0].groups[0].elementIds).toEqual(["headline", "accent"]);
    expect(parsed.scenes[0].elements[0].animations?.[0].keyframes).toHaveLength(2);
  });
});
