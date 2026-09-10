import { describe, expect, it } from "vitest";
import sharp from "sharp";
import { analyzeReferenceFrameSeries, measureReferenceFrame, referenceFrameChange } from "./reference-analysis";

async function solid(r: number, g: number, b: number) {
  return sharp({ create: { width: 64, height: 36, channels: 3, background: { r, g, b } } }).png().toBuffer();
}

async function split(left: { r: number; g: number; b: number }, right: { r: number; g: number; b: number }) {
  const first = await sharp({ create: { width: 32, height: 36, channels: 3, background: left } }).png().toBuffer();
  const second = await sharp({ create: { width: 32, height: 36, channels: 3, background: right } }).png().toBuffer();
  return sharp({ create: { width: 64, height: 36, channels: 3, background: left } })
    .composite([{ input: first, left: 0, top: 0 }, { input: second, left: 32, top: 0 }])
    .png().toBuffer();
}

describe("reference frame analysis", () => {
  it("measures deterministic luminance, density and palette from pixels", async () => {
    const frame = await measureReferenceFrame(await split({ r: 0, g: 0, b: 0 }, { r: 255, g: 255, b: 255 }), 250);
    expect(frame.time_ms).toBe(250);
    expect(frame.mean_luminance).toBeGreaterThan(0.45);
    expect(frame.mean_luminance).toBeLessThan(0.55);
    expect(frame.luminance_contrast).toBeGreaterThan(0.45);
    expect(frame.edge_density).toBeGreaterThan(0);
    expect(frame.palette.length).toBeGreaterThan(1);
  });

  it("frame change is zero for identical pixels and large across a hard change", async () => {
    const blackA = await measureReferenceFrame(await solid(0, 0, 0), 0);
    const blackB = await measureReferenceFrame(await solid(0, 0, 0), 100);
    const white = await measureReferenceFrame(await solid(255, 255, 255), 200);
    expect(referenceFrameChange(blackA, blackB)).toBe(0);
    expect(referenceFrameChange(blackB, white)).toBeGreaterThan(0.9);
  });

  it("detects a hard cut as an outlier and turns it into shot durations", async () => {
    const frames = [
      await measureReferenceFrame(await solid(0, 0, 0), 0),
      await measureReferenceFrame(await solid(5, 5, 5), 250),
      await measureReferenceFrame(await solid(255, 255, 255), 500),
      await measureReferenceFrame(await solid(250, 250, 250), 750),
    ];
    const analysis = analyzeReferenceFrameSeries(frames, 1000);
    expect(analysis.cuts).toHaveLength(1);
    expect(analysis.cuts[0].time_ms).toBe(500);
    expect(analysis.shot_durations_ms).toEqual([500, 500]);
    expect(analysis.limitations.some((line) => line.includes("Text regions"))).toBe(true);
  });
});
