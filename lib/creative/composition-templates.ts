import { createDefaultTransform } from "./defaults";
import type { CreativeDocument, CreativeElement, CreativeScene } from "./schema";

export const CREATIVE_COMPOSITION_TEMPLATES = ["hero", "split", "metric-grid"] as const;
export type CreativeCompositionTemplate = (typeof CREATIVE_COMPOSITION_TEMPLATES)[number];

function text(id: string, name: string, value: string, style: "heading" | "body", x: number, y: number, width: number, height: number, zIndex: number, tags: string[]): CreativeElement {
  return {
    id,
    name,
    alias: id,
    tags,
    type: "text",
    text: value,
    style: { token: style },
    transform: createDefaultTransform({ x, y, width, height, anchorX: 0, anchorY: 0, zIndex }),
  };
}

function plate(id: string, name: string, x: number, y: number, width: number, height: number, zIndex: number, tags: string[]): CreativeElement {
  return {
    id,
    name,
    alias: id,
    tags,
    type: "shape",
    shape: "rect",
    fill: { kind: "token", token: zIndex === 0 ? "background" : "muted" },
    borderRadius: 20,
    transform: createDefaultTransform({ x, y, width, height, anchorX: 0, anchorY: 0, zIndex, opacity: zIndex === 0 ? 1 : 0.2 }),
    ...(zIndex === 0 ? { role: "background" as const } : {}),
  };
}

export function buildCompositionTemplateScene(
  document: CreativeDocument,
  template: CreativeCompositionTemplate,
  sceneId: string,
  durationMs = 3000,
): CreativeScene {
  if (!sceneId.trim()) throw new Error("sceneId must be a non-empty string");
  if (!Number.isFinite(durationMs) || durationMs <= 0) throw new Error("durationMs must be positive");
  const { width, height } = document.canvas;
  const pad = Math.round(Math.min(width, height) * 0.07);
  const gap = Math.round(pad * 0.55);
  const id = (suffix: string) => `${sceneId}.${suffix}`;
  const elements: CreativeElement[] = [plate(id("background"), "Template background", 0, 0, width, height, 0, ["template", template, "background"])];

  if (template === "hero") {
    elements.push(
      text(id("title"), "Hero title", "TITLE", "heading", pad, Math.round(height * 0.16), width - pad * 2, Math.round(height * 0.16), 10, ["template", "hero", "title"]),
      text(id("subtitle"), "Hero subtitle", "Supporting copy", "body", pad, Math.round(height * 0.34), Math.round(width * 0.58), Math.round(height * 0.12), 10, ["template", "hero", "subtitle"]),
      plate(id("focal"), "Hero focal placeholder", Math.round(width * 0.56), Math.round(height * 0.48), Math.round(width * 0.34), Math.round(height * 0.32), 5, ["template", "hero", "focal"]),
    );
  } else if (template === "split") {
    const panelWidth = Math.floor((width - pad * 2 - gap) / 2);
    elements.push(
      text(id("title"), "Split title", "TITLE", "heading", pad, pad, width - pad * 2, Math.round(height * 0.12), 10, ["template", "split", "title"]),
      plate(id("left"), "Left panel", pad, Math.round(height * 0.24), panelWidth, Math.round(height * 0.62), 5, ["template", "split", "panel", "left"]),
      plate(id("right"), "Right panel", pad + panelWidth + gap, Math.round(height * 0.24), panelWidth, Math.round(height * 0.62), 5, ["template", "split", "panel", "right"]),
    );
  } else {
    const cardGap = gap;
    const cardWidth = Math.floor((width - pad * 2 - cardGap * 2) / 3);
    elements.push(text(id("title"), "Metric-grid title", "TITLE", "heading", pad, pad, width - pad * 2, Math.round(height * 0.12), 10, ["template", "metric-grid", "title"]));
    for (let index = 0; index < 3; index += 1) {
      const x = pad + index * (cardWidth + cardGap);
      elements.push(
        plate(id(`card-${index + 1}`), `Metric card ${index + 1}`, x, Math.round(height * 0.32), cardWidth, Math.round(height * 0.38), 5, ["template", "metric-grid", "card"]),
        text(id(`value-${index + 1}`), `Metric value ${index + 1}`, `${index + 1}×`, "heading", x + gap, Math.round(height * 0.42), cardWidth - gap * 2, Math.round(height * 0.12), 10, ["template", "metric-grid", "metric-value"]),
      );
    }
  }

  return {
    id: sceneId,
    name: `${template} template`,
    durationMs: Math.round(durationMs),
    background: { kind: "token", token: "background" },
    elements,
    groups: [],
  };
}
