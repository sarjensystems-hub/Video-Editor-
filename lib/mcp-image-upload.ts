import { randomUUID } from "node:crypto";
import type { McpUserContext } from "./mcp-oauth";
import { uploadAnyBytes } from "./storage";
import {
  MAX_MCP_FILE_IMAGE_BYTES,
  assertPublicHttpsDownloadUrl,
  buildMcpImageStoragePath,
  detectMcpImageContentType,
  parseMcpFileImageInput,
  type SupportedMcpImageType,
} from "./mcp-image-upload-core";

const MAX_REDIRECTS = 3;

async function downloadChatGptFile(downloadUrl: string): Promise<Uint8Array> {
  let currentUrl = assertPublicHttpsDownloadUrl(downloadUrl);

  for (let redirectCount = 0; redirectCount <= MAX_REDIRECTS; redirectCount += 1) {
    const response = await fetch(currentUrl, {
      redirect: "manual",
      signal: AbortSignal.timeout(20_000),
    });

    if (response.status >= 300 && response.status < 400) {
      const location = response.headers.get("location");
      if (!location) throw new Error("ChatGPT file redirect did not include a location.");
      if (redirectCount === MAX_REDIRECTS) {
        throw new Error("ChatGPT file exceeded the maximum redirect count.");
      }
      currentUrl = assertPublicHttpsDownloadUrl(new URL(location, currentUrl).toString());
      continue;
    }

    if (!response.ok) {
      throw new Error(`ChatGPT file download failed with HTTP ${response.status}.`);
    }

    const declaredLength = Number(response.headers.get("content-length") ?? "0");
    if (Number.isFinite(declaredLength) && declaredLength > MAX_MCP_FILE_IMAGE_BYTES) {
      throw new Error(
        `Image file is too large. Maximum size is ${MAX_MCP_FILE_IMAGE_BYTES} bytes.`,
      );
    }

    const arrayBuffer = await response.arrayBuffer();
    if (arrayBuffer.byteLength === 0) throw new Error("ChatGPT image file is empty.");
    if (arrayBuffer.byteLength > MAX_MCP_FILE_IMAGE_BYTES) {
      throw new Error(
        `Image file is too large. Maximum size is ${MAX_MCP_FILE_IMAGE_BYTES} bytes.`,
      );
    }

    return new Uint8Array(arrayBuffer);
  }

  throw new Error("ChatGPT file download failed.");
}

export async function uploadMcpUserImage(
  context: McpUserContext,
  input: unknown,
): Promise<{
  asset_id: string;
  url: string;
  content_type: SupportedMcpImageType;
  size_bytes: number;
}> {
  const file = parseMcpFileImageInput(input);
  const bytes = await downloadChatGptFile(file.downloadUrl);
  const contentType = detectMcpImageContentType(bytes);

  const assetId = randomUUID();
  const storagePath = buildMcpImageStoragePath(context.user.id, assetId, contentType);

  const url = await uploadAnyBytes(bytes, storagePath, contentType);
  if (!url) throw new Error("Studio image storage upload failed.");

  let storedUrl: URL;
  try {
    storedUrl = new URL(url);
  } catch {
    throw new Error("Studio storage returned an invalid image URL.");
  }
  if (storedUrl.protocol !== "https:") {
    throw new Error("Studio storage must return a durable HTTPS image URL.");
  }

  return {
    asset_id: assetId,
    url: storedUrl.toString(),
    content_type: contentType,
    size_bytes: bytes.byteLength,
  };
}
