import { createDefaultTransform, createNeutralDesignSystem } from "./defaults";
import type { CreativeDocument } from "./schema";

export function createCanonicalCreativeFixture(): CreativeDocument {
  const designSystem = createNeutralDesignSystem();
  designSystem.colors.background = "#0A0A0A";
  designSystem.colors.foreground = "#FFFFFF";
  designSystem.colors.muted = "#A1A1AA";
  designSystem.colors.accent = "#EF4444";
  designSystem.mediaDirection = {
    photographicStyle: "cinematic premium automotive photography",
    lighting: "controlled high-contrast workshop lighting",
    subjectTreatment: "authentic premium car-care environment with restrained styling",
    negativeSpace: "preserve clean negative space for native typography and UI overlays",
    motionIntensity: "medium",
    avoid: [
      "generated typography inside imagery",
      "cheap promotional graphics",
      "exaggerated neon effects",
    ],
    audioCharacter: "restrained mechanical sound design with premium low-frequency texture",
  };

  return {
    version: 1,
    id: "canonical-layered-social",
    title: "Layered animated social creative",
    canvas: {
      width: 1080,
      height: 1350,
      fps: 30,
      background: { kind: "token", token: "background" },
    },
    designSystem,
    scenes: [
      {
        id: "scene-1",
        name: "Stop guessing",
        durationMs: 8000,
        background: { kind: "token", token: "background" },
        elements: [
          {
            id: "background-image",
            name: "Workshop background",
            type: "image",
            assetId: "fixture-background",
            fit: "cover",
            crop: { x: 0, y: 0, width: 1, height: 1 },
            transform: createDefaultTransform({
              x: 0,
              y: 0,
              width: 1080,
              height: 1350,
              anchorX: 0,
              anchorY: 0,
              zIndex: 0,
            }),
          },
          {
            id: "headline",
            name: "Headline",
            type: "text",
            text: "STOP GUESSING.",
            style: { token: "heading" },
            transform: createDefaultTransform({
              x: 80,
              y: 790,
              width: 900,
              height: 150,
              anchorX: 0,
              anchorY: 0,
              zIndex: 3,
            }),
            timing: { startMs: 600, endMs: 7600 },
            animations: [
              {
                id: "preset:rise-in:y",
                property: "y",
                keyframes: [
                  { timeMs: 600, value: 830, easing: "ease-out" },
                  { timeMs: 1000, value: 790, easing: "ease-out" },
                ],
              },
              {
                id: "preset:rise-in:opacity",
                property: "opacity",
                keyframes: [
                  { timeMs: 600, value: 0, easing: "ease-out" },
                  { timeMs: 1000, value: 1, easing: "ease-out" },
                ],
              },
            ],
          },
          {
            id: "accent-line",
            name: "Accent line",
            type: "shape",
            shape: "rect",
            fill: { kind: "token", token: "accent" },
            borderRadius: 4,
            transform: createDefaultTransform({
              x: 80,
              y: 980,
              width: 180,
              height: 8,
              anchorX: 0,
              anchorY: 0.5,
              zIndex: 4,
            }),
            timing: { startMs: 850, endMs: 7600 },
            animations: [
              {
                id: "accent-scale",
                property: "scaleX",
                keyframes: [
                  { timeMs: 850, value: 0, easing: "ease-out" },
                  { timeMs: 1200, value: 1, easing: "ease-out" },
                ],
              },
            ],
          },
          {
            id: "brand-logo",
            name: "Brand logo",
            type: "image",
            assetId: "fixture-logo",
            fit: "contain",
            transform: createDefaultTransform({
              x: 80,
              y: 1140,
              width: 260,
              height: 90,
              anchorX: 0,
              anchorY: 0,
              zIndex: 5,
            }),
            timing: { startMs: 6200, endMs: 8000 },
            animations: [
              {
                id: "logo-opacity",
                property: "opacity",
                keyframes: [
                  { timeMs: 6200, value: 0, easing: "ease-out" },
                  { timeMs: 6600, value: 1, easing: "ease-out" },
                ],
              },
            ],
          },
        ],
        groups: [
          {
            id: "copy-lockup",
            name: "Copy lockup",
            elementIds: ["headline", "accent-line"],
          },
        ],
        transitionOut: {
          kind: "fade",
          durationMs: 250,
          easing: "ease-in-out",
        },
      },
    ],
    metadata: {
      purpose: "CreativeDocument V1 canonical fixture",
      format: "social",
    },
  };
}
