import { describe, expect, it } from "vitest";
import { createCanonicalCreativeFixture } from "./fixtures";
import { importCreativeDocumentJson, importBasicSvg } from "./import";

describe("structured creative import", () => {
  it("imports an existing valid CreativeDocument JSON", () => {
    const source = createCanonicalCreativeFixture();
    const result = importCreativeDocumentJson(JSON.stringify(source));
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.document.title).toBe(source.title);
    expect(result.document).not.toBe(source);
  });

  it("rejects invalid CreativeDocument JSON", () => {
    expect(importCreativeDocumentJson("not-json").ok).toBe(false);
    expect(importCreativeDocumentJson(JSON.stringify({ version: 1 })).ok).toBe(false);
  });

  it("imports a deterministic basic SVG subset", () => {
    const svg = `<svg width="1080" height="1080" viewBox="0 0 1080 1080">
      <rect x="40" y="50" width="500" height="240" rx="20" fill="#111111" />
      <circle cx="760" cy="250" r="100" fill="#ef4444" />
      <text x="80" y="600" font-size="72" font-weight="700" fill="#ffffff">BETTER CAR CARE</text>
    </svg>`;
    const first = importBasicSvg(svg, "Imported SVG");
    const second = importBasicSvg(svg, "Imported SVG");
    expect(first.ok).toBe(true);
    expect(second.ok).toBe(true);
    if (!first.ok || !second.ok) return;
    expect(first.document.canvas.width).toBe(1080);
    expect(first.document.scenes[0].elements.map((item) => item.type)).toEqual(["shape", "shape", "text"]);
    expect(first.document.scenes[0].elements.map((item) => item.id)).toEqual(second.document.scenes[0].elements.map((item) => item.id));
  });

  it("reports unsupported SVG nodes instead of inventing them", () => {
    const result = importBasicSvg(`<svg viewBox="0 0 400 400"><path d="M0 0 L10 10"/><image href="x.png"/></svg>`, "Unsupported");
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.warnings.join(" ")).toMatch(/path/i);
    expect(result.warnings.join(" ")).toMatch(/image/i);
  });
});