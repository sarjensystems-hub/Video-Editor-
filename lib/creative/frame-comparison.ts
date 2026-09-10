import sharp from "sharp";

export interface CreativeFrameComparisonMetrics {
  width: number;
  height: number;
  comparedPixels: number;
  differentPixels: number;
  differenceRatio: number;
  meanAbsoluteError: number;
  maxChannelError: number;
  exactMatch: boolean;
}

async function rgba(bytes: Uint8Array) {
  const image = sharp(Buffer.from(bytes)).ensureAlpha();
  const metadata = await image.metadata();
  if (!metadata.width || !metadata.height) throw new Error("Frame image dimensions are unavailable");
  return { width: metadata.width, height: metadata.height, pixels: await image.raw().toBuffer() };
}

/** Compare two native-size frames without resizing away preview/render drift. */
export async function compareCreativeFrameImages(previewImage: Uint8Array, renderedImage: Uint8Array) {
  const [preview, rendered] = await Promise.all([rgba(previewImage), rgba(renderedImage)]);
  if (preview.width !== rendered.width || preview.height !== rendered.height) {
    throw new Error(`Frame dimensions differ: preview is ${preview.width}x${preview.height}, render is ${rendered.width}x${rendered.height}`);
  }

  const diff = Buffer.alloc(preview.pixels.length);
  let differentPixels = 0;
  let totalError = 0;
  let maxChannelError = 0;
  for (let offset = 0; offset < preview.pixels.length; offset += 4) {
    let pixelError = 0;
    for (let channel = 0; channel < 4; channel += 1) {
      const error = Math.abs(preview.pixels[offset + channel] - rendered.pixels[offset + channel]);
      totalError += error;
      pixelError = Math.max(pixelError, error);
      maxChannelError = Math.max(maxChannelError, error);
    }
    if (pixelError > 0) {
      differentPixels += 1;
      diff[offset] = pixelError;
      diff[offset + 3] = 255;
    }
  }
  const comparedPixels = preview.width * preview.height;
  const diffPng = await sharp(diff, { raw: { width: preview.width, height: preview.height, channels: 4 } }).png().toBuffer();
  return {
    metrics: {
      width: preview.width,
      height: preview.height,
      comparedPixels,
      differentPixels,
      differenceRatio: differentPixels / comparedPixels,
      meanAbsoluteError: totalError / (comparedPixels * 4),
      maxChannelError,
      exactMatch: differentPixels === 0,
    } satisfies CreativeFrameComparisonMetrics,
    diffPng,
  };
}
