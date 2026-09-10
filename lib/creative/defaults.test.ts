import { describe, expect, it } from "vitest";
import {
  createDefaultCanvas,
  createDefaultTransform,
  createEmptyCreativeDocument,
  createNeutralDesignSystem,
} from "./defaults";

describe("creative defaults", () => {
  it("creates the neutral canvas and transform defaults", () => {
    expect(createDefaultCanvas()).toEqual({
      width: 1080,
      height: 1080,
      fps: 30,
      background: { kind: "token", token: "background" },
    });
    expect(createDefaultCanvas(1080, 1920)).toMatchObject({ width: 1080, height: 1920 });
    expect(createDefaultTransform()).toEqual({
      x: 0,
      y: 0,
      width: 100,
      height: 100,
      rotation: 0,
      opacity: 1,
      anchorX: 0.5,
      anchorY: 0.5,
      zIndex: 0,
    });
    expect(createDefaultTransform({ width: 500, zIndex: 7 })).toMatchObject({ width: 500, zIndex: 7 });
  });

  it("creates a deterministic neutral visual and motion system", () => {
    const system = createNeutralDesignSystem();
    expect(system.colors).toEqual({
      background: "#FFFFFF",
      foreground: "#111111",
      muted: "#6B7280",
      accent: "#F97316",
    });
    expect(system.typography).toEqual({
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
    });
    expect(system.motion.presets).toEqual({
      "fade-in": {
        durationMs: 300,
        easing: "ease-out",
        tracks: [{ property: "opacity", mode: "absolute", from: 0, to: 1 }],
      },
      "fade-out": {
        durationMs: 250,
        easing: "ease-in",
        tracks: [{ property: "opacity", mode: "absolute", from: 1, to: 0 }],
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
    });
    expect(system.motion.sceneTransitions).toEqual({
      cut: { kind: "cut", durationMs: 0, easing: "linear" },
      fade: { kind: "fade", durationMs: 250, easing: "ease-in-out" },
    });
  });

  it("returns fresh nested objects for every caller", () => {
    const first = createNeutralDesignSystem();
    const second = createNeutralDesignSystem();
    first.colors.background = "#000000";
    first.motion.presets["fade-in"].tracks[0].from = 0.5;

    expect(second.colors.background).toBe("#FFFFFF");
    expect(second.motion.presets["fade-in"].tracks[0].from).toBe(0);
  });

  it("creates a minimally valid one-scene document", () => {
    const document = createEmptyCreativeDocument({
      id: "project-1",
      title: "Project",
      width: 1080,
      height: 1920,
    });

    expect(document).toMatchObject({
      version: 1,
      id: "project-1",
      title: "Project",
      canvas: { width: 1080, height: 1920, fps: 30 },
    });
    expect(document.scenes).toEqual([
      { id: "scene-1", name: "Scene 1", durationMs: 5000, elements: [], groups: [] },
    ]);
  });
});
