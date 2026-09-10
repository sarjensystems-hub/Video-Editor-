import type { CreativeDocument } from "./schema";

const KEY = "assetAliases";

export function creativeAssetAliases(document: CreativeDocument): Record<string, string> {
  const raw = document.metadata?.[KEY];
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return {};
  const aliases: Record<string, string> = {};
  for (const [alias, id] of Object.entries(raw)) {
    if (alias.trim() && typeof id === "string" && id.trim()) aliases[alias] = id;
  }
  return aliases;
}

export function resolveCreativeAssetId(document: CreativeDocument, reference: string): string {
  return creativeAssetAliases(document)[reference] ?? reference;
}

export function setCreativeAssetAlias(
  document: CreativeDocument,
  alias: string,
  assetId?: string,
): CreativeDocument {
  const normalized = alias.trim();
  if (!normalized) throw new Error("Asset alias must be a non-empty string");
  if (normalized.length > 80) throw new Error("Asset alias must be 80 characters or fewer");
  if (!/^[a-zA-Z0-9][a-zA-Z0-9._-]*$/.test(normalized)) {
    throw new Error("Asset alias may contain letters, numbers, dot, underscore and hyphen only");
  }
  const aliases = creativeAssetAliases(document);
  if (assetId === undefined) delete aliases[normalized];
  else {
    const id = assetId.trim();
    if (!id) throw new Error("assetId must be a non-empty string when setting an alias");
    aliases[normalized] = id;
  }
  return {
    ...document,
    metadata: {
      ...(document.metadata ?? {}),
      [KEY]: aliases,
    },
  };
}
