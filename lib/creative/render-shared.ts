/**
 * What every creative renderer shares, whichever machine draws the frames:
 * document validation, turning a lossless frame into the small WebP an
 * assistant looks at, contact-sheet compositing, and reading a render's
 * output back from storage. Kept apart from render.ts so the self-hosted
 * worker adapter can use it without importing the Vercel Sandbox one.
 */

import { headObject } from "../b2";
import { planContactSheetLayout, type ContactSheetLayout } from "./contact-sheet";
import type { CreativeDocument } from "./schema";
import { validateCreativeDocument } from "./validate";

/** When a render that has reached `progress` since `startedAtMs` should finish, if it keeps pace. */
export function estimateRenderCompletionMs(startedAtMs: number, progress: number, nowMs = Date.now()): number | null {
  if (!Number.isFinite(progress) || progress <= 0) return null;
  if (progress >= 1) return nowMs;
  const elapsed = Math.max(0, nowMs - startedAtMs);
  return Math.round(startedAtMs + elapsed / progress);
}

/** Which backend drew a render. */
export type CreativeRendererName = "remotion-vercel" | "remotion-worker";

export function assertValidDocument(document: CreativeDocument) {
  const validation = validateCreativeDocument(document);
  if (!validation.valid) {
    throw new Error(validation.issues[0]?.message ?? "Invalid CreativeDocument");
  }
}

export function toBuffer(bytes: Uint8Array | ArrayBuffer): Uint8Array {
  return bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
}

/**
 * Longest edge a preview is sent at. Claude scales any image larger than this
 * down before reading it, so sending more pixels only costs bytes and upload
 * time, never detail the model can see.
 */
export const PREVIEW_MAX_EDGE = 1568;
export const PREVIEW_WEBP_QUALITY = 80;

/** One import of sharp shared by every frame in a batch, however many run at once. */
type Sharp = typeof import("sharp");
let sharpLoader: Promise<Sharp> | null = null;
function loadSharp(): Promise<Sharp> {
  sharpLoader ??= import("sharp").then((module) => module.default);
  return sharpLoader;
}

/** Re-encodes a lossless PNG as a small WebP for an assistant to look at. */
export async function encodePreviewWebp(png: Uint8Array): Promise<Uint8Array> {
  const sharp = await loadSharp();
  const webp = await sharp(Buffer.from(png))
    .resize(PREVIEW_MAX_EDGE, PREVIEW_MAX_EDGE, { fit: "inside", withoutEnlargement: true })
    .webp({ quality: PREVIEW_WEBP_QUALITY })
    .toBuffer();
  return new Uint8Array(webp);
}

export async function compositeContactSheet(
  frames: Uint8Array[],
  layout: ContactSheetLayout,
): Promise<Uint8Array> {
  const sharp = await loadSharp();
  const tiles = await Promise.all(
    layout.tiles.map(async (tile, index) => ({
      input: await sharp(Buffer.from(frames[index]))
        .resize(tile.width, tile.height, { fit: "fill" })
        .png()
        .toBuffer(),
      left: tile.x,
      top: tile.y,
    })),
  );
  const sheet = await sharp({
    create: {
      width: layout.sheetWidth,
      height: layout.sheetHeight,
      channels: 4,
      background: { r: 9, g: 9, b: 11, alpha: 1 },
    },
  })
    .composite(tiles)
    .png()
    .toBuffer();
  return new Uint8Array(sheet);
}

/** A frame as the renderers return it; enough to build a contact sheet from. */
interface RenderedFrameLike {
  png: Uint8Array;
}

/** One deterministic sheet of `frames`, sent as WebP like every preview. */
export async function buildContactSheet(document: CreativeDocument, frames: RenderedFrameLike[]) {
  const layout = planContactSheetLayout({
    frameCount: frames.length,
    frameWidth: document.canvas.width,
    frameHeight: document.canvas.height,
  });
  const sheet = await encodePreviewWebp(
    await compositeContactSheet(frames.map((entry) => entry.png), layout),
  );
  return {
    bytes: sheet,
    contentType: "image/webp" as const,
    sizeBytes: sheet.byteLength,
    columns: layout.columns,
    rows: layout.rows,
    width: layout.sheetWidth,
    height: layout.sheetHeight,
  };
}

/** The render's output as stored, when the renderer stored it itself. */
export async function storedRenderOutput(outputKey: string, renderer: CreativeRendererName) {
  const head = await headObject(outputKey).catch(() => null);
  if (!head || head.size <= 0) return null;
  const { mediaUrl } = await import("../storage");
  return {
    status: "completed" as const,
    progress: 1 as const,
    url: await mediaUrl(outputKey),
    contentType: head.contentType || "video/mp4",
    sizeBytes: head.size,
    renderer,
  };
}
