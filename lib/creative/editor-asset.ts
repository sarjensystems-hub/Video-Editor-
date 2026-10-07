/**
 * The slice of an asset row the editor works with, and the one mapping from
 * a database row to it — the page loader, the upload form and the automation
 * panel all receive rows and must agree on what they become.
 */

import { defaultAssetClass } from "./asset-class";

export interface EditorAsset {
  id: string;
  kind: string;
  /** What the asset is for; see lib/creative/asset-class.ts. */
  assetClass: string;
  url: string;
  filename?: string | null;
  mimeType?: string | null;
  durationMs?: number | null;
  /** The note the uploader left for the assistant, if any. */
  description?: string | null;
}

export function toEditorAsset(row: Record<string, unknown>): EditorAsset {
  const kind = String(row.kind ?? "other");
  const metadata = (row.metadata && typeof row.metadata === "object" ? row.metadata : {}) as Record<string, unknown>;
  const duration = Number(row.duration_ms);
  return {
    id: String(row.id),
    kind,
    assetClass: typeof row.asset_class === "string" && row.asset_class ? row.asset_class : defaultAssetClass(kind),
    url: String(row.url),
    filename: row.filename == null ? null : String(row.filename),
    mimeType: row.mime_type == null ? null : String(row.mime_type),
    durationMs: Number.isFinite(duration) && duration > 0 ? duration : null,
    description: typeof metadata.description === "string" ? metadata.description : null,
  };
}
