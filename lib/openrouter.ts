/**
 * OpenRouter API helper
 *
 * Uses Studio's own API key — users never need to provide one.
 * All AI calls go through this single function.
 *
 * Primary model: google/gemini-2.5-flash — fast, large context, high rate limits.
 * Fallback model: google/gemini-2.0-flash-lite-001 — used automatically on 429.
 */

const PRIMARY_MODEL  = "google/gemini-2.5-flash";
const FALLBACK_MODEL = "google/gemini-2.0-flash-lite-001";

async function callOpenRouter(
  model: string,
  content: unknown,
  maxTokens: number,
  jsonMode: boolean,
  apiKey: string,
  temperature?: number,
): Promise<Response> {
  const body: Record<string, unknown> = {
    model,
    messages:   [{ role: "user", content }],
    max_tokens: maxTokens,
  };
  if (jsonMode) body.response_format = { type: "json_object" };
  if (typeof temperature === "number") body.temperature = temperature;

  return fetch("https://openrouter.ai/api/v1/chat/completions", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization:  `Bearer ${apiKey}`,
      "HTTP-Referer": process.env.NEXT_PUBLIC_APP_URL ?? "https://studio.example.com",
      "X-Title":      "Studio",
    },
    body: JSON.stringify(body),
  });
}

/** Shared call + 429 fallback logic. `content` is either a string or an
 *  OpenAI-style content-part array (text + image_url parts for vision). */
async function runWithFallback(
  content: unknown,
  maxTokens: number,
  jsonMode: boolean,
  temperature?: number,
): Promise<string> {
  const apiKey = process.env.OPENROUTER_API_KEY;
  if (!apiKey) throw new Error("OPENROUTER_API_KEY is not configured. Add it to Vercel environment variables.");

  // Try primary model; on 429 wait 2 s and retry once; then fall back to secondary model
  const delays = [2000, 4000];
  let res: Response | null = null;

  for (let attempt = 0; attempt <= delays.length; attempt++) {
    const model = attempt < 2 ? PRIMARY_MODEL : FALLBACK_MODEL;
    res = await callOpenRouter(model, content, maxTokens, jsonMode, apiKey, temperature);

    if (res.status !== 429) break;

    if (attempt < delays.length) {
      console.warn(`[openrouter] 429 on attempt ${attempt + 1}, retrying in ${delays[attempt]}ms…`);
      await new Promise((r) => setTimeout(r, delays[attempt]));
    }
  }

  if (!res!.ok) {
    const errText = await res!.text().catch(() => "(could not read body)");
    const msg = `OpenRouter ${res!.status}: ${errText}`;
    console.error(msg);
    throw new Error(msg);
  }

  const data = await res!.json();
  const responseContent: string = data.choices?.[0]?.message?.content ?? "";

  if (!responseContent) {
    const detail = JSON.stringify(data);
    console.error("OpenRouter returned empty content:", detail);
    throw new Error(`Model returned empty response. Raw: ${detail.slice(0, 300)}`);
  }

  return responseContent;
}

export async function fetchAIResponse(
  prompt: string,
  maxTokens = 4500,
  jsonMode = false,
  temperature?: number,
): Promise<string> {
  return runWithFallback(prompt, maxTokens, jsonMode, temperature);
}

/**
 * Vision variant — sends one or more images alongside the text prompt so the
 * model can describe/reason about what it actually sees (e.g. a product photo).
 */
export async function fetchAIResponseWithImages(
  prompt: string,
  imageUrls: string[],
  maxTokens = 2000,
  jsonMode = false
): Promise<string> {
  const content = [
    ...imageUrls.map((url) => ({ type: "image_url" as const, image_url: { url } })),
    { type: "text" as const, text: prompt },
  ];
  return runWithFallback(content, maxTokens, jsonMode);
}

/**
 * Vision call targeting a specific model with no Gemini fallback.
 * Used for the Haiku vision pipeline (section screenshots → HTML).
 * On 429, retries the same model with backoff instead of switching models.
 *
 * content: OpenAI-style content-part array (text + image_url parts).
 */
export async function fetchVisionResponse(
  content: unknown,
  maxTokens = 8000,
  model = "anthropic/claude-haiku-4-5",
): Promise<string> {
  const apiKey = process.env.OPENROUTER_API_KEY;
  if (!apiKey) throw new Error("OPENROUTER_API_KEY is not configured. Add it to Vercel environment variables.");

  const delays = [2000, 4000, 8000];
  let res: Response | null = null;

  for (let attempt = 0; attempt <= delays.length; attempt++) {
    res = await callOpenRouter(model, content, maxTokens, false, apiKey);

    if (res.status !== 429) break;

    if (attempt < delays.length) {
      console.warn(`[openrouter:vision] 429 on attempt ${attempt + 1}, retrying in ${delays[attempt]}ms…`);
      await new Promise((r) => setTimeout(r, delays[attempt]));
    }
  }

  if (!res!.ok) {
    const errText = await res!.text().catch(() => "(could not read body)");
    const msg = `OpenRouter vision ${res!.status}: ${errText}`;
    console.error(msg);
    throw new Error(msg);
  }

  const data = await res!.json();
  const responseContent: string = data.choices?.[0]?.message?.content ?? "";

  if (!responseContent) {
    const detail = JSON.stringify(data);
    console.error("OpenRouter vision returned empty content:", detail);
    throw new Error(`Vision model returned empty response. Raw: ${detail.slice(0, 300)}`);
  }

  return responseContent;
}

/**
 * Extract a JSON object from a response that may be wrapped in markdown code fences.
 * Handles:  ```json … ```  |  ``` … ```  |  bare { … }
 *
 * Also repairs the most common model failure: literal newlines/tabs inside JSON strings
 * (which are invalid JSON — they must be escaped as \n, \t).
 */
export function extractJson(raw: string): string {
  // Strip markdown code fences
  const fenceMatch = raw.match(/```(?:json)?\s*([\s\S]*?)```/);
  const extracted = fenceMatch ? fenceMatch[1].trim() : (() => {
    const start = raw.indexOf("{");
    const end   = raw.lastIndexOf("}");
    return (start !== -1 && end > start) ? raw.slice(start, end + 1) : raw.trim();
  })();

  // Repair: escape any literal newlines/tabs/carriage-returns inside JSON string values
  return repairJsonStrings(extracted);
}

/**
 * Walk the JSON character-by-character and escape any literal control characters
 * that appear inside string values (the most common cause of JSON parse failures
 * when an AI generates HTML with newlines inside a JSON string field).
 */
function repairJsonStrings(str: string): string {
  let result = "";
  let inString = false;
  let escaped = false;

  for (let i = 0; i < str.length; i++) {
    const ch = str[i];

    if (escaped) {
      result += ch;
      escaped = false;
      continue;
    }

    if (ch === "\\") {
      result += ch;
      escaped = true;
      continue;
    }

    if (ch === '"') {
      result += ch;
      inString = !inString;
      continue;
    }

    if (inString) {
      if (ch === "\n") { result += "\\n";  continue; }
      if (ch === "\r") { result += "\\r";  continue; }
      if (ch === "\t") { result += "\\t";  continue; }
    }

    result += ch;
  }

  return result;
}
