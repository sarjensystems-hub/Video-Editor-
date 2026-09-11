/**
 * Image generation — two-tier Gemini via OpenRouter.
 *
 *   DEFAULT_MODEL  → cheaper, used for batch generation: article hero +
 *                    body, initial landing-page sections. ~$0.039/image.
 *   PREMIUM_MODEL  → newer, higher fidelity, multimodal-aware: used for
 *                    user-initiated "regenerate" actions, social post
 *                    illustrations, and product compositing. ~$0.067/image.
 *
 * All four exports share one low-level `callGeminiImage()` helper and
 * return the same `AIImageResult` shape so callers can route the output
 * through `uploadAIImage()` from `lib/storage.ts`.
 */

import { getOpenRouterKey } from "./openrouter-key";
import { appUrl } from "@/lib/app-url";
const DEFAULT_MODEL = "google/gemini-2.5-flash-image";
const PREMIUM_MODEL = "google/gemini-3.1-flash-image-preview";

type Style     = "editorial" | "lifestyle" | "product" | "technical" | "minimal";
type CanvasFmt = "landscape" | "square" | "portrait";

export type AIImageResult = { url: string } | { b64: string } | null;

const ASPECT_RATIOS: Record<CanvasFmt, string> = {
  landscape: "16:9",
  square:    "1:1",
  portrait:  "3:4",
};

const STYLE_DESCRIPTORS: Record<Style, string> = {
  editorial: "premium editorial photography, cinematic lighting, sharp focus, photorealistic",
  lifestyle: "warm lifestyle photography, natural light, authentic, vibrant",
  product:   "clean product photography, studio lighting, commercial quality",
  technical: "professional technical photography, clean modern aesthetic, sharp focus",
  minimal:   "minimalist photography, soft natural light, uncluttered, refined",
};

const NO_TEXT_INSTRUCTION =
  "No text, letters, numbers, watermarks, captions, logos, or UI elements in the image.";

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

async function callGeminiImage({ content, aspectRatio, logTag, model = DEFAULT_MODEL }: CallOpts): Promise<AIImageResult> {
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
        modalities: ["image", "text"],
        extra_body: { imageConfig: { aspectRatio } },
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
 * Generate an article hero or in-body image — batch path, uses the
 * cheaper default model. Called by `/api/ai/draft`, `/api/ai/draft-only`,
 * and the landing-page image slots in `/api/ai/landing-page/from-capture`.
 */
export async function generateImage(
  prompt:     string | null | undefined,
  imageStyle: string = "editorial",
  imageType:  "hero" | "internal" = "internal",
): Promise<AIImageResult> {
  if (!prompt) return null;

  const styleKey   = (STYLE_DESCRIPTORS[imageStyle as Style] ? imageStyle : "editorial") as Style;
  const emphasis   = imageType === "hero" ? "Hero composition — striking, vibrant, attention-grabbing. " : "";
  const fullPrompt = `${emphasis}${prompt}. Style: ${STYLE_DESCRIPTORS[styleKey]}. ${NO_TEXT_INSTRUCTION}`;

  return callGeminiImage({
    content:     fullPrompt,
    aspectRatio: ASPECT_RATIOS.landscape,
    logTag:      "image-gen",
    model:       DEFAULT_MODEL,
  });
}

/**
 * Generate a landing-page section image on the user-initiated "regenerate"
 * path (canvas editor "Generate image" action). Routes through the
 * premium model since this is a paid one-off, not a batch.
 */
export async function generateLandingImage(prompt: string): Promise<AIImageResult> {
  if (!prompt) return null;
  return callGeminiImage({
    content:     `Wide landscape composition. ${prompt}. ${NO_TEXT_INSTRUCTION}`,
    aspectRatio: ASPECT_RATIOS.landscape,
    logTag:      "landing-image",
    model:       PREMIUM_MODEL,
  });
}

/**
 * Generate a social media creative. Optionally accepts brand reference
 * images (logo, homepage screenshot) attached before the prompt. Uses
 * the premium model — social posts are single-shot, multimodal-aware,
 * and text-edge quality matters for the composited result.
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

  return callGeminiImage({
    content,
    aspectRatio: ASPECT_RATIOS[canvasFormat],
    logTag:      "social-image",
    model:       PREMIUM_MODEL,
  });
}

/**
 * Generate a product creative. The first attached image is the product
 * photo; Gemini removes its background and composites it into the
 * described scene in one shot.
 */
export async function generateProductImage(
  productImageUrl: string,
  scenePrompt:     string,
  canvasFormat:    CanvasFmt = "square",
  refImages:       string[]  = [],
): Promise<AIImageResult> {
  if (!productImageUrl) return null;

  const canvasDirective = {
    square:    "Square 1:1 composition. Fill the entire square canvas edge-to-edge.",
    portrait:  "Tall portrait 3:4 composition. Fill the entire vertical canvas edge-to-edge.",
    landscape: "Wide landscape 16:9 composition. Fill the entire horizontal canvas edge-to-edge.",
  }[canvasFormat];

  const content: ContentPart[] = [
    { type: "image_url", image_url: { url: productImageUrl } },
    ...refImages.map((url) => ({ type: "image_url" as const, image_url: { url } })),
    {
      type: "text",
      text:
        `${canvasDirective} The first image is the product.` +
        (refImages.length
          ? " The other images are brand references — match their visual style and reproduce the brand logo accurately."
          : "") +
        ` Remove the product's background and place it in this scene: ${scenePrompt}.` +
        ` Commercial photography, studio lighting, professional.` +
        (refImages.length ? "" : " No added text, no logos, no watermarks."),
    },
  ];

  return callGeminiImage({
    content,
    aspectRatio: ASPECT_RATIOS[canvasFormat],
    logTag:      "product-image",
    model:       PREMIUM_MODEL,
  });
}
