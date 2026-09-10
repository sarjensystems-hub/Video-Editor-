import type { CreativeDocument, JsonValue } from "./schema";

export type CreativeProjectAttachmentKind = "reference" | "brand";
export interface CreativeProjectAttachment { id: string; kind: CreativeProjectAttachmentKind; assetId: string; label?: string; }
const KEY = "projectAttachments";

function attachmentJson(item: CreativeProjectAttachment): JsonValue {
  return {
    id: item.id,
    kind: item.kind,
    assetId: item.assetId,
    ...(item.label ? { label: item.label } : {}),
  };
}

export function creativeProjectAttachments(document: CreativeDocument): CreativeProjectAttachment[] {
  const raw = document.metadata?.[KEY];
  if (!Array.isArray(raw)) return [];
  return raw.flatMap((item) => {
    if (!item || typeof item !== "object" || Array.isArray(item)) return [];
    const value = item as Record<string, unknown>;
    if (typeof value.id !== "string" || !value.id.trim()) return [];
    if (value.kind !== "reference" && value.kind !== "brand") return [];
    if (typeof value.assetId !== "string" || !value.assetId.trim()) return [];
    return [{ id: value.id, kind: value.kind, assetId: value.assetId, ...(typeof value.label === "string" && value.label.trim() ? { label: value.label } : {}) }];
  });
}

export function setCreativeProjectAttachment(document: CreativeDocument, attachment: CreativeProjectAttachment): CreativeDocument {
  if (!attachment.id.trim()) throw new Error("Attachment id must be non-empty");
  if (!attachment.assetId.trim()) throw new Error("Attachment assetId must be non-empty");
  const attachments = creativeProjectAttachments(document).filter((item) => item.id !== attachment.id);
  attachments.push({ ...attachment, id: attachment.id.trim(), assetId: attachment.assetId.trim(), ...(attachment.label?.trim() ? { label: attachment.label.trim() } : {}) });
  return { ...document, metadata: { ...(document.metadata ?? {}), [KEY]: attachments.map(attachmentJson) } };
}

export function removeCreativeProjectAttachment(document: CreativeDocument, attachmentId: string): CreativeDocument {
  const id = attachmentId.trim();
  if (!id) throw new Error("Attachment id must be non-empty");
  return { ...document, metadata: { ...(document.metadata ?? {}), [KEY]: creativeProjectAttachments(document).filter((item) => item.id !== id).map(attachmentJson) } };
}
