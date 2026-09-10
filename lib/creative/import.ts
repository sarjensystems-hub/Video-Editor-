import { createDefaultTransform, createEmptyCreativeDocument } from "./defaults";
import type { CreativeDocument, CreativeElement, ColorValue } from "./schema";
import { validateCreativeDocument } from "./validate";

export type CreativeImportResult =
  | { ok: true; document: CreativeDocument; warnings: string[] }
  | { ok: false; error: string; warnings: string[] };

function clone<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}

export function importCreativeDocumentJson(raw: string): CreativeImportResult {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return { ok: false, error: "Invalid JSON", warnings: [] };
  }
  const validation = validateCreativeDocument(parsed);
  if (!validation.valid) {
    const issue = validation.issues[0];
    return { ok: false, error: issue ? `${issue.path}: ${issue.message}` : "Invalid CreativeDocument", warnings: [] };
  }
  return { ok: true, document: clone(parsed as CreativeDocument), warnings: [] };
}

function hashText(value: string): string {
  let hash = 2166136261;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return (hash >>> 0).toString(36);
}

function parseAttributes(raw: string): Record<string, string> {
  const attrs: Record<string, string> = {};
  const re = /([:\w-]+)\s*=\s*(?:"([^"]*)"|'([^']*)')/g;
  let match: RegExpExecArray | null;
  while ((match = re.exec(raw))) attrs[match[1]] = match[2] ?? match[3] ?? "";
  return attrs;
}

function finiteNumber(value: string | undefined, fallback = 0): number {
  if (value == null) return fallback;
  const parsed = Number.parseFloat(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function literalColor(value: string | undefined, fallback = "#111111"): ColorValue {
  const normalized = (value ?? "").trim();
  if (!normalized || normalized === "none") return { kind: "literal", value: "transparent" };
  return { kind: "literal", value: normalized || fallback };
}

function decodeEntities(value: string): string {
  return value
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&amp;/g, "&")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .trim();
}

function svgDimensions(svgAttrs: Record<string, string>) {
  const viewBox = (svgAttrs.viewBox ?? svgAttrs.viewbox ?? "").trim().split(/[\s,]+/).map(Number);
  const viewWidth = viewBox.length === 4 && Number.isFinite(viewBox[2]) ? viewBox[2] : 0;
  const viewHeight = viewBox.length === 4 && Number.isFinite(viewBox[3]) ? viewBox[3] : 0;
  const width = Math.round(finiteNumber(svgAttrs.width, viewWidth || 1080));
  const height = Math.round(finiteNumber(svgAttrs.height, viewHeight || 1080));
  return { width: Math.max(1, width), height: Math.max(1, height) };
}

export function importBasicSvg(raw: string, title = "Imported SVG"): CreativeImportResult {
  const svgMatch = raw.match(/<svg\b([^>]*)>/i);
  if (!svgMatch) return { ok: false, error: "SVG root element is required", warnings: [] };
  const svgAttrs = parseAttributes(svgMatch[1]);
  const { width, height } = svgDimensions(svgAttrs);
  const stable = hashText(raw);
  const document = createEmptyCreativeDocument({ id: `svg-${stable}`, title: title.trim() || "Imported SVG", width, height });
  const scene = document.scenes[0];
  scene.name = "Imported SVG";
  const elements: CreativeElement[] = [];
  const warnings: string[] = [];

  let ordinal = 0;
  const rectRe = /<rect\b([^>]*)\/?\s*>/gi;
  let rect: RegExpExecArray | null;
  while ((rect = rectRe.exec(raw))) {
    const attrs = parseAttributes(rect[1]);
    const w = finiteNumber(attrs.width);
    const h = finiteNumber(attrs.height);
    if (w <= 0 || h <= 0) {
      warnings.push("Skipped rect with non-positive dimensions.");
      continue;
    }
    elements.push({
      id: `svg-${stable}-rect-${ordinal++}`,
      name: attrs.id || "Rectangle",
      type: "shape",
      shape: "rect",
      fill: literalColor(attrs.fill),
      borderRadius: Math.max(0, finiteNumber(attrs.rx, finiteNumber(attrs.ry, 0))),
      transform: createDefaultTransform({ x: finiteNumber(attrs.x), y: finiteNumber(attrs.y), width: w, height: h, anchorX: 0, anchorY: 0, zIndex: elements.length }),
    });
  }

  const ellipseRe = /<(circle|ellipse)\b([^>]*)\/?\s*>/gi;
  let ellipse: RegExpExecArray | null;
  while ((ellipse = ellipseRe.exec(raw))) {
    const attrs = parseAttributes(ellipse[2]);
    const isCircle = ellipse[1].toLowerCase() === "circle";
    const rx = isCircle ? finiteNumber(attrs.r) : finiteNumber(attrs.rx);
    const ry = isCircle ? rx : finiteNumber(attrs.ry);
    if (rx <= 0 || ry <= 0) {
      warnings.push(`Skipped ${ellipse[1]} with non-positive radius.`);
      continue;
    }
    const cx = finiteNumber(attrs.cx);
    const cy = finiteNumber(attrs.cy);
    elements.push({
      id: `svg-${stable}-ellipse-${ordinal++}`,
      name: attrs.id || (isCircle ? "Circle" : "Ellipse"),
      type: "shape",
      shape: "ellipse",
      fill: literalColor(attrs.fill),
      transform: createDefaultTransform({ x: cx - rx, y: cy - ry, width: rx * 2, height: ry * 2, anchorX: 0, anchorY: 0, zIndex: elements.length }),
    });
  }

  const textRe = /<text\b([^>]*)>([\s\S]*?)<\/text>/gi;
  let text: RegExpExecArray | null;
  while ((text = textRe.exec(raw))) {
    const attrs = parseAttributes(text[1]);
    const content = decodeEntities(text[2].replace(/<[^>]+>/g, ""));
    if (!content) continue;
    const fontSize = Math.max(1, finiteNumber(attrs["font-size"], 48));
    const x = finiteNumber(attrs.x);
    const baselineY = finiteNumber(attrs.y, fontSize);
    elements.push({
      id: `svg-${stable}-text-${ordinal++}`,
      name: attrs.id || "Text",
      type: "text",
      text: content,
      style: {
        token: "body",
        overrides: {
          fontFamily: attrs["font-family"] || "Inter",
          fontSize,
          fontWeight: Math.max(100, finiteNumber(attrs["font-weight"], 400)),
          color: literalColor(attrs.fill, "#111111"),
        },
      },
      transform: createDefaultTransform({ x, y: baselineY - fontSize, width: Math.max(80, width - x), height: fontSize * 1.4, anchorX: 0, anchorY: 0, zIndex: elements.length }),
    });
  }

  const seenUnsupported = new Set<string>();
  const tags = raw.matchAll(/<\/?([a-zA-Z][\w:-]*)\b/g);
  const supported = new Set(["svg", "rect", "circle", "ellipse", "text"]);
  for (const match of tags) {
    const tag = match[1].toLowerCase();
    if (!supported.has(tag) && !seenUnsupported.has(tag)) {
      seenUnsupported.add(tag);
      warnings.push(`Unsupported SVG element <${tag}> was not imported.`);
    }
  }

  scene.elements = elements;
  const validation = validateCreativeDocument(document);
  if (!validation.valid) {
    const issue = validation.issues[0];
    return { ok: false, error: issue ? `${issue.path}: ${issue.message}` : "Imported SVG is invalid", warnings };
  }
  return { ok: true, document, warnings };
}
