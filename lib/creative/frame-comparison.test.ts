import sharp from "sharp";
import { describe, expect, it } from "vitest";
import { compareCreativeFrameImages } from "./frame-comparison";

async function solid(r: number, g: number, b: number, width = 4, height = 3) {
  return sharp({ create: { width, height, channels: 4, background: { r, g, b, alpha: 1 } } }).png().toBuffer();
}

describe("preview-vs-render frame comparison", () => {
  it("reports exact raster parity and emits a transparent diff", async () => {
    const image = await solid(12, 34, 56);
    const result = await compareCreativeFrameImages(image, image);
    expect(result.metrics).toMatchObject({
      width: 4, height: 3, comparedPixels: 12, differentPixels: 0,
      differenceRatio: 0, meanAbsoluteError: 0, maxChannelError: 0, exactMatch: true,
    });
    expect([...(await sharp(result.diffPng).raw().toBuffer())].every((channel) => channel === 0)).toBe(true);
  });

  it("measures channel differences deterministically", async () => {
    const result = await compareCreativeFrameImages(await solid(10, 20, 30), await solid(20, 20, 30));
    expect(result.metrics).toMatchObject({ differentPixels: 12, differenceRatio: 1, maxChannelError: 10, exactMatch: false });
    expect(result.metrics.meanAbsoluteError).toBeCloseTo(2.5, 5);
  });

  it("refuses dimensions that cannot represent the same canvas", async () => {
    await expect(compareCreativeFrameImages(await solid(0, 0, 0, 4, 3), await solid(0, 0, 0, 5, 3))).rejects.toThrow(/dimensions/i);
  });
});
