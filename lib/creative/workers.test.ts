import { describe, expect, it } from "vitest";
import {
  canPromoteVideoGeneration,
  normalizeCreativeImageFormat,
  normalizeGeneratedAssetFilename,
} from "./workers";

describe("creative generative workers", () => {
  it("normalizes supported image canvas formats", () => {
    expect(normalizeCreativeImageFormat("portrait")).toBe("portrait");
    expect(normalizeCreativeImageFormat("square")).toBe("square");
    expect(normalizeCreativeImageFormat("anything")).toBe("portrait");
  });

  it("only promotes completed video jobs with durable HTTPS output", () => {
    expect(canPromoteVideoGeneration({ status: "completed", video_url: "https://cdn.example.com/v.mp4" })).toBe(true);
    expect(canPromoteVideoGeneration({ status: "in_progress", video_url: "https://cdn.example.com/v.mp4" })).toBe(false);
    expect(canPromoteVideoGeneration({ status: "completed", video_url: null })).toBe(false);
    expect(canPromoteVideoGeneration({ status: "completed", video_url: "http://example.com/v.mp4" })).toBe(false);
  });

  it("creates safe generated asset filenames", () => {
    expect(normalizeGeneratedAssetFilename("Workshop / Hero", "png")).toBe("workshop-hero.png");
    expect(normalizeGeneratedAssetFilename("", "mp4")).toMatch(/^generated-.*\.mp4$/);
  });
});