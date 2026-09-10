import type { CreativeDocument, JsonValue } from "./schema";
import { validateCreativeDocument } from "./validate";

export type CreativeProjectStatus = "draft" | "ready" | "rendering" | "archived";
export type CreativeAssetKind = "image" | "video" | "audio" | "font" | "other";
export type CreativeRenderStatus = "queued" | "rendering" | "completed" | "failed" | "cancelled";

export interface CreativeRevisionSnapshot {
  sequence: number;
  changeSummary: string;
  document: CreativeDocument;
}

export interface CreativeAssetRecord {
  id: string;
  userId: string;
  siteId: string | null;
  projectId: string | null;
  kind: CreativeAssetKind;
  source: string;
  url: string;
  mimeType: string | null;
  filename: string | null;
  width: number | null;
  height: number | null;
  durationMs: number | null;
  sizeBytes: number | null;
  metadata: Record<string, JsonValue>;
}

export function normalizeCreativeAssetKind(value: string): CreativeAssetKind {
  switch ((value || "").trim().toLowerCase()) {
    case "image":
      return "image";
    case "video":
      return "video";
    case "audio":
      return "audio";
    case "font":
      return "font";
    default:
      return "other";
  }
}

export function createRevisionSnapshot(
  document: CreativeDocument,
  sequence: number,
  changeSummary = "Updated creative",
): CreativeRevisionSnapshot {
  if (!Number.isInteger(sequence) || sequence < 1) {
    throw new Error("Revision sequence must be a positive integer");
  }
  const validation = validateCreativeDocument(document);
  if (!validation.valid) {
    throw new Error(`Cannot snapshot invalid CreativeDocument: ${validation.issues[0]?.message ?? "unknown validation error"}`);
  }

  const cloned = JSON.parse(JSON.stringify(document)) as CreativeDocument;
  return {
    sequence,
    changeSummary: changeSummary.trim().slice(0, 500) || "Updated creative",
    document: cloned,
  };
}
