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

/* OpenAI-style content-part array used for vision / multi-image requests. */
type ContentPart =
  | { type: "text"; text: string }
  | { type: "image_url"; image_url: { url: string } };

interface CallOpts {
  /** A plain string OR an OpenAI content-part array. */
  content:     string | ContentPart[];
  aspectRatio: string;
  logTag:      string;
  model?:      string;
}

async function callImageModel({ content, aspectRatio, logTag, model = IMAGE_MODEL }: CallOpts): Promise<AIImageResult> {
  const apiKey = await getOpenRouterKey();
  if (!apiKey) {
    console.warn(`[${logTag}] No OpenRouter key for this request — the account has not added one`);
    return null;
  }

  try {
    const res = await fetch("https://openrouter.ai/api/v1/chat/completions", {
      method: "POST",
      headers: {
        "Content-Type":  "application/json",
        "Authorization": `Bearer ${apiKey}`,
        "HTTP-Referer":  appUrl(),
        "X-Title":       "Studio",
      },
      body: JSON.stringify({
        model,
        messages:   [{ role: "user", content }],
        // GPT Image outputs images only; asking for text too is rejected.
        modalities:   ["image"],
        image_config: { aspect_ratio: aspectRatio },
      }),
    });

    if (!res.ok) {
      const text = await res.text().catch(() => "");
      console.error(`[${logTag}] OpenRouter ${res.status}:`, text.slice(0, 600));
      return null;
    }

    const data    = await res.json();
    const message = data?.choices?.[0]?.message;
    const first   = message?.images?.[0];
    const imgUrl  = first?.image_url?.url ?? first?.url;

    if (typeof imgUrl === "string") {
      if (imgUrl.startsWith("data:")) {
        const b64 = imgUrl.split(",")[1];
        if (b64) return { b64 };
      }
      if (imgUrl.startsWith("http")) return { url: imgUrl };
    }
    if (typeof message?.content === "string" && message.content.startsWith("data:")) {
      const b64 = message.content.split(",")[1];
      if (b64) return { b64 };
    }

    console.error(`[${logTag}] No image in response:`, JSON.stringify(data).slice(0, 600));
    return null;
  } catch (e) {
    console.error(`[${logTag}] Exception:`, e);
    return null;
  }
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

  const content: string | ContentPart[] = refImages.length
    ? [
        ...refImages.map((url) => ({ type: "image_url" as const, image_url: { url } })),
        { type: "text" as const, text: prompt },
      ]
    : prompt;

  return callImageModel({
    content,
    aspectRatio: ASPECT_RATIOS[canvasFormat],
    logTag:      "image-gen",
  });
}
