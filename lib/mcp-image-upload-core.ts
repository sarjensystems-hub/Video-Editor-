import { isIP } from "node:net";

export const MAX_MCP_FILE_IMAGE_BYTES = 10 * 1024 * 1024;

export const SUPPORTED_MCP_IMAGE_TYPES = ["image/png", "image/jpeg", "image/webp"] as const;
export type SupportedMcpImageType = (typeof SUPPORTED_MCP_IMAGE_TYPES)[number];

export type ParsedMcpFileImageInput = {
  downloadUrl: string;
  fileId: string;
  mimeType?: string;
  fileName?: string;
};

function isPrivateIpv4(address: string): boolean {
  const octets = address.split(".").map(Number);
  if (
    octets.length !== 4 ||
    octets.some((value) => !Number.isInteger(value) || value < 0 || value > 255)
  ) {
    return true;
  }

  const [a, b] = octets;
  return (
    a === 0 ||
    a === 10 ||
    a === 127 ||
    (a === 100 && b >= 64 && b <= 127) ||
    (a === 169 && b === 254) ||
    (a === 172 && b >= 16 && b <= 31) ||
    (a === 192 && b === 0) ||
    (a === 192 && b === 168) ||
    (a === 198 && (b === 18 || b === 19)) ||
    a >= 224
  );
}

function isPrivateIpv6(address: string): boolean {
  const normalized = address.toLowerCase().replace(/^\[|\]$/g, "");
  if (normalized === "::" || normalized === "::1") return true;
  if (normalized.startsWith("fc") || normalized.startsWith("fd")) return true;
  if (/^fe[89ab]/.test(normalized)) return true;

  const mapped = normalized.match(/::ffff:(\d+\.\d+\.\d+\.\d+)$/);
  return mapped ? isPrivateIpv4(mapped[1]) : false;
}

export function assertPublicHttpsDownloadUrl(value: string): string {
  let parsed: URL;
  try {
    parsed = new URL(value);
  } catch {
    throw new Error("file.download_url must be a valid public HTTPS URL.");
  }

  if (parsed.protocol !== "https:") {
    throw new Error("file.download_url must use HTTPS.");
  }
  if (parsed.username || parsed.password) {
    throw new Error("file.download_url must not contain URL credentials.");
  }

  const host = parsed.hostname.toLowerCase().replace(/\.$/, "");
  if (
    !host ||
    host === "localhost" ||
    host.endsWith(".localhost") ||
    host.endsWith(".local") ||
    host.endsWith(".internal") ||
    host.endsWith(".lan")
  ) {
    throw new Error("file.download_url must point to a public host.");
  }

  const ipHost = host.replace(/^\[|\]$/g, "");
  const ipVersion = isIP(ipHost);
  if (ipVersion === 4 && isPrivateIpv4(ipHost)) {
    throw new Error("file.download_url must point to a public host.");
  }
  if (ipVersion === 6 && isPrivateIpv6(ipHost)) {
    throw new Error("file.download_url must point to a public host.");
  }

  return parsed.toString();
}

export function parseMcpFileImageInput(input: unknown): ParsedMcpFileImageInput {
  if (!input || typeof input !== "object" || Array.isArray(input)) {
    throw new Error("Image upload input must be an object.");
  }

  const file = (input as Record<string, unknown>).file;
  if (!file || typeof file !== "object" || Array.isArray(file)) {
    throw new Error("file is required and must be a ChatGPT file handoff object.");
  }

  const record = file as Record<string, unknown>;
  const downloadUrl =
    typeof record.download_url === "string" ? record.download_url.trim() : "";
  const fileId = typeof record.file_id === "string" ? record.file_id.trim() : "";
  const mimeType = typeof record.mime_type === "string" ? record.mime_type.trim() : "";
  const fileName = typeof record.file_name === "string" ? record.file_name.trim() : "";

  if (!downloadUrl) throw new Error("file.download_url is required.");
  if (!fileId) throw new Error("file.file_id is required.");

  return {
    downloadUrl: assertPublicHttpsDownloadUrl(downloadUrl),
    fileId,
    ...(mimeType ? { mimeType } : {}),
    ...(fileName ? { fileName } : {}),
  };
}

function bytesEqualAt(bytes: Uint8Array, expected: readonly number[], offset = 0): boolean {
  if (bytes.byteLength < offset + expected.length) return false;
  return expected.every((value, index) => bytes[offset + index] === value);
}

export function detectMcpImageContentType(bytes: Uint8Array): SupportedMcpImageType {
  if (bytesEqualAt(bytes, [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])) {
    return "image/png";
  }
  if (bytesEqualAt(bytes, [0xff, 0xd8, 0xff])) {
    return "image/jpeg";
  }
  if (
    bytesEqualAt(bytes, [0x52, 0x49, 0x46, 0x46]) &&
    bytesEqualAt(bytes, [0x57, 0x45, 0x42, 0x50], 8)
  ) {
    return "image/webp";
  }
  throw new Error("Downloaded file is not a supported image (PNG, JPEG, or WebP).");
}

export function imageExtensionForContentType(contentType: SupportedMcpImageType): string {
  if (contentType === "image/jpeg") return "jpg";
  if (contentType === "image/webp") return "webp";
  return "png";
}

export function buildMcpImageStoragePath(
  userId: string,
  assetId: string,
  contentType: SupportedMcpImageType,
  now = new Date(),
): string {
  const year = String(now.getUTCFullYear());
  const month = String(now.getUTCMonth() + 1).padStart(2, "0");
  return `${userId}/mcp/images/${year}/${month}/${assetId}.${imageExtensionForContentType(contentType)}`;
}
