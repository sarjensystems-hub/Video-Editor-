/**
 * The frame shapes a new creative can start in. Each is the platform-native
 * size for its ratio, so an export uploads without being rescaled.
 */

export const CREATIVE_CANVAS_FORMATS = {
  "9:16": { width: 1080, height: 1920, label: "Vertical", hint: "Reels, TikTok, Shorts, Stories" },
  "16:9": { width: 1920, height: 1080, label: "Landscape", hint: "YouTube, websites, presentations" },
  "4:5":  { width: 1080, height: 1350, label: "Portrait", hint: "Instagram and Facebook feed" },
  "1:1":  { width: 1080, height: 1080, label: "Square", hint: "Feeds, LinkedIn, ads" },
} as const;

export type CreativeCanvasFormat = keyof typeof CREATIVE_CANVAS_FORMATS;
export const CREATIVE_CANVAS_FORMAT_IDS = Object.keys(CREATIVE_CANVAS_FORMATS) as CreativeCanvasFormat[];
export const DEFAULT_CREATIVE_CANVAS_FORMAT: CreativeCanvasFormat = "9:16";

/** A requested format, or the default for anything unrecognised. */
export function resolveCanvasFormat(value: unknown): CreativeCanvasFormat {
  return typeof value === "string" && value in CREATIVE_CANVAS_FORMATS
    ? (value as CreativeCanvasFormat)
    : DEFAULT_CREATIVE_CANVAS_FORMAT;
}
