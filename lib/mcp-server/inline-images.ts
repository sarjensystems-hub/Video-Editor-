/**
 * Images a tool result hands to the assistant inline, without storing them.
 *
 * A tool handler returns a plain object that becomes the JSON
 * `structuredContent` of the response. Image bytes do not belong in that JSON,
 * so they ride alongside it under a symbol key: `JSON.stringify` skips symbol
 * keys, so they never leak into the text or structured payload, and the MCP
 * layer lifts them out into `image` content blocks.
 *
 * This is how preview frames reach the assistant. They used to be uploaded to
 * storage and fetched back to inline them, which left every inspected frame
 * behind in the bucket indefinitely.
 */

const INLINE_IMAGES = Symbol.for("studio.mcp.inlineImages");

export type InlineImageRole = "frame" | "sheet" | "difference";

export interface InlineImage {
  bytes: Uint8Array;
  mimeType: string;
  /** Lets a caller ask for only sheets, only frames, or both. */
  role: InlineImageRole;
}

export function withInlineImages<T extends object>(value: T, images: InlineImage[]): T {
  Object.defineProperty(value, INLINE_IMAGES, { value: images, enumerable: false });
  return value;
}

export function inlineImagesOf(value: unknown): InlineImage[] {
  if (!value || typeof value !== "object") return [];
  const images = (value as Record<symbol, unknown>)[INLINE_IMAGES];
  return Array.isArray(images) ? (images as InlineImage[]) : [];
}
