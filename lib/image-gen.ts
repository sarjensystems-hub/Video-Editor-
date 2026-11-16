/**
 * Image generation through OpenAI's GPT Image 2.5 Sunburst on OpenRouter,
 * billed to the requesting account's own key. Returns an `AIImageResult` for `uploadAIImage()` in
 * `lib/storage.ts` to persist.
 */

import { getOpenRouterKey } from "./openrouter-key";
import { appUrl } from "@/lib/app-url";
export const IMAGE_MODEL = "openai/gpt-image-2.5-sunburst";

type CanvasFmt = "landscape" | "square" | "portrait";

export type AIImageResult = { url: string } | { b64: string } | null;

const ASPECT_RATIOS: Record<CanvasFmt, string> = {
  landscape: "16:9",
  square:    "1:1",
  portrait:  "3:4",
};

interface CallOpts {
  prompt:          string;
  /** HTTP(S) or data: URLs, sent as input_references. */
  referenceImages: string[];
  aspectRatio:     string;
  logTag:          string;
  model?:          string;
}

/**
 * OpenRouter serves image-only models (GPT Image) from its Images API,
 * POST /api/v1/images; chat/completions now answers them with a 404. The
 * response carries the image bytes as base64 in data[].b64_json.
 *
 * Failures throw with OpenRouter's own message, so a caller sees why (a
 * refused model, a missing key, a content block) rather than "no image".
 */
async function callImageModel({ prompt, referenceImages, aspectRatio, logTag, model = IMAGE_MODEL }: CallOpts): Promise<AIImageResult> {
  const apiKey = await getOpenRouterKey();
  if (!apiKey) {
    throw new Error("Image generation needs an OpenRouter key: add one in Settings.");
  }

  const body: Record<string, unknown> = {
    model,
    prompt,
    aspect_ratio: aspectRatio,
    n:            1,
  };
  if (referenceImages.length > 0) {
    body.input_references = referenceImages.map((url) => ({ type: "image_url", image_url: { url } }));
  }

  const res = await fetch("https://openrouter.ai/api/v1/images", {
    method: "POST",
    headers: {
      "Content-Type":  "application/json",
      "Authorization": `Bearer ${apiKey}`,
      "HTTP-Referer":  appUrl(),
      "X-Title":       "Studio",
    },
    body: JSON.stringify(body),
  });

  if (!res.ok) {
    const text = await res.text().catch(() => "");
    console.error(`[${logTag}] OpenRouter ${res.status}:`, text.slice(0, 600));
    let message = text.slice(0, 300);
    try {
      message = JSON.parse(text)?.error?.message ?? message;
    } catch { /* not JSON: keep the raw text */ }
    throw new Error(`Image generation failed (OpenRouter ${res.status}): ${message || res.statusText}`);
  }

  const data = await res.json();
  const first = data?.data?.[0];
  if (typeof first?.b64_json === "string" && first.b64_json) return { b64: first.b64_json };
  if (typeof first?.url === "string" && first.url.startsWith("http")) return { url: first.url };

  console.error(`[${logTag}] No image in response:`, JSON.stringify(data).slice(0, 600));
  throw new Error("Image generation failed: OpenRouter answered without an image.");
}

/**
 * Generates one image from a prompt, with optional reference images placed
 * before it. Used by the Creative Studio image worker.
 */
export async function generateSocialImage(
  prompt:       string,
  canvasFormat: CanvasFmt = "landscape",
  refImages:    string[]  = [],
): Promise<AIImageResult> {
  if (!prompt) return null;

  return callImageModel({
    prompt,
    referenceImages: refImages,
    aspectRatio: ASPECT_RATIOS[canvasFormat],
    logTag:      "image-gen",
  });
}
