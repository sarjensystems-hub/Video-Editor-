import type {
  CreativeCanvas,
  CreativeDesignSystem,
  CreativeDocument,
  CreativeTransform,
} from "./schema";

export function createDefaultCanvas(width = 1080, height = 1080): CreativeCanvas {
  return {
    width,
    height,
    fps: 30,
    background: { kind: "token", token: "background" },
  };
}

export function createDefaultTransform(
  overrides: Partial<CreativeTransform> = {},
): CreativeTransform {
  return {
    x: 0,
    y: 0,
    width: 100,
    height: 100,
    rotation: 0,
    opacity: 1,
    anchorX: 0.5,
    anchorY: 0.5,
    zIndex: 0,
    ...overrides,
  };
}

export function createNeutralDesignSystem(): CreativeDesignSystem {
  return {
    colors: {
      background: "#FFFFFF",
      foreground: "#111111",
      muted: "#6B7280",
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
      body: {
        fontFamily: "Inter",
        fontSize: 32,
        fontWeight: 400,
        lineHeight: 1.3,
        letterSpacing: 0,
        align: "left",
        color: { kind: "token", token: "foreground" },
      },
      caption: {
        fontFamily: "Inter",
        fontSize: 22,
        fontWeight: 500,
        lineHeight: 1.25,
        letterSpacing: 0.2,
        align: "left",
        color: { kind: "token", token: "muted" },
      },
    },
    spacing: {
      xs: 8,
      sm: 16,
      md: 24,
      lg: 40,
      xl: 64,
    },
    radii: {
      sm: 8,
      md: 16,
      lg: 24,
      pill: 999,
    },
    strokes: {
      subtle: {
        width: 1,
        color: { kind: "literal", value: "#E5E7EB" },
      },
    },
    motion: {
      presets: {
        "fade-in": {
          durationMs: 300,
          easing: "ease-out",
          tracks: [
            { property: "opacity", mode: "absolute", from: 0, to: 1 },
          ],
        },
        "fade-out": {
          durationMs: 250,
          easing: "ease-in",
          tracks: [
            { property: "opacity", mode: "absolute", from: 1, to: 0 },
          ],
        },
        "rise-in": {
          durationMs: 400,
          easing: "ease-out",
          tracks: [
            { property: "y", mode: "delta", from: 40, to: 0 },
            { property: "opacity", mode: "absolute", from: 0, to: 1 },
          ],
        },
        "scale-in": {
          durationMs: 350,
          easing: "ease-out",
          tracks: [
            { property: "scaleX", mode: "absolute", from: 0.94, to: 1 },
            { property: "scaleY", mode: "absolute", from: 0.94, to: 1 },
            { property: "opacity", mode: "absolute", from: 0, to: 1 },
          ],
        },
      },
      sceneTransitions: {
        cut: { kind: "cut", durationMs: 0, easing: "linear" },
        fade: { kind: "fade", durationMs: 250, easing: "ease-in-out" },
      },
    },
  };
}

export function createEmptyCreativeDocument(input: {
  id: string;
  title?: string;
  width?: number;
  height?: number;
}): CreativeDocument {
  return {
    version: 1,
    id: input.id,
    title: input.title ?? "",
    canvas: createDefaultCanvas(input.width, input.height),
    designSystem: createNeutralDesignSystem(),
    scenes: [
      {
        id: "scene-1",
        name: "Scene 1",
        durationMs: 5000,
        elements: [],
        groups: [],
      },
    ],
  };
}
