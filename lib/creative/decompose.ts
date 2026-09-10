import { extractJson } from "../openrouter";

export const DECOMPOSITION_ROLES = ["subject", "product", "logo", "text", "foreground", "other"] as const;
export type DecompositionRole = (typeof DECOMPOSITION_ROLES)[number];

export interface NormalizedBox {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface DecompositionCandidate {
  role: DecompositionRole;
  label: string;
  confidence: number;
  box: NormalizedBox;
}

function finite(value: unknown): number | null {
  const number = typeof value === "number" ? value : Number(value);
  return Number.isFinite(number) ? number : null;
}

function clamp(value: number, min = 0, max = 1) {
  return Math.min(max, Math.max(min, value));
}

function stableDecimal(value: number): number {
  return Math.round(value * 1_000_000_000) / 1_000_000_000;
}

function normalizeBox(value: Record<string, unknown>): NormalizedBox | null {
  const x = finite(value.x);
  const y = finite(value.y);
  const width = finite(value.width);
  const height = finite(value.height);
  if (x == null || y == null || width == null || height == null || width <= 0 || height <= 0) return null;
  const left = clamp(x);
  const top = clamp(y);
  const right = clamp(x + width);
  const bottom = clamp(y + height);
  if (right <= left || bottom <= top) return null;
  return {
    x: stableDecimal(left),
    y: stableDecimal(top),
    width: stableDecimal(right - left),
    height: stableDecimal(bottom - top),
  };
}

export function parseDecompositionPlan(raw: string, minConfidence = 0.35): DecompositionCandidate[] {
  let parsed: unknown;
  try {
    parsed = JSON.parse(extractJson(raw));
  } catch {
    throw new Error("Decomposition model returned invalid JSON");
  }
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) throw new Error("Decomposition plan must be an object");
  const candidates = (parsed as Record<string, unknown>).candidates;
  if (!Array.isArray(candidates)) throw new Error("Decomposition plan must include candidates");
  const roles = new Set<string>(DECOMPOSITION_ROLES);
  const output: DecompositionCandidate[] = [];
  for (const candidate of candidates) {
    if (!candidate || typeof candidate !== "object" || Array.isArray(candidate)) continue;
    const item = candidate as Record<string, unknown>;
    const role = typeof item.role === "string" ? item.role : "";
    if (!roles.has(role)) throw new Error(`Unsupported decomposition role: ${role || "missing"}`);
    const confidence = finite(item.confidence);
    if (confidence == null || confidence < minConfidence) continue;
    const box = normalizeBox(item);
    if (!box) continue;
    output.push({
      role: role as DecompositionRole,
      label: typeof item.label === "string" && item.label.trim() ? item.label.trim().slice(0, 120) : role,
      confidence: clamp(confidence),
      box,
    });
  }
  return output.slice(0, 24);
}

export function pixelCropFromNormalized(box: NormalizedBox, imageWidth: number, imageHeight: number) {
  if (!Number.isInteger(imageWidth) || imageWidth <= 0 || !Number.isInteger(imageHeight) || imageHeight <= 0) {
    throw new Error("Image dimensions must be positive integers");
  }
  const left = Math.min(imageWidth - 1, Math.max(0, Math.floor(box.x * imageWidth)));
  const top = Math.min(imageHeight - 1, Math.max(0, Math.floor(box.y * imageHeight)));
  const requestedWidth = Math.max(1, Math.ceil(stableDecimal(box.width) * imageWidth));
  const requestedHeight = Math.max(1, Math.ceil(stableDecimal(box.height) * imageHeight));
  const width = Math.min(imageWidth - left, requestedWidth);
  const height = Math.min(imageHeight - top, requestedHeight);
  return { left, top, width, height };
}
