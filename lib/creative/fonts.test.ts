import { describe, expect, it } from "vitest";
import {
  googleFontsUrlCandidates,
  parseFontStack,
  requiredFonts,
  webFontFamilyFromStack,
} from "./fonts";
import { createCanonicalCreativeFixture } from "./fixtures";
import type { CreativeDocument } from "./schema";

describe("reading a font stack", () => {
  it("splits and unquotes", () => {
    expect(parseFontStack('"Sora", Inter, sans-serif')).toEqual(["Sora", "Inter", "sans-serif"]);
    expect(parseFontStack("  Sora  ")).toEqual(["Sora"]);
  });

  it("takes the first family that needs downloading", () => {
    expect(webFontFamilyFromStack('"Sora", Inter, sans-serif')).toBe("Sora");
    // Only the first matters — the rest is a fallback chain we hope not to use.
    expect(webFontFamilyFromStack("Inter, Sora")).toBe("Inter");
  });

  it("never asks a font service for a generic or system family", () => {
    for (const stack of ["sans-serif", "system-ui", "Arial, sans-serif", "Helvetica Neue", "monospace"]) {
      expect(webFontFamilyFromStack(stack), stack).toBeNull();
    }
  });

  it("skips a family name that could not be put in a URL safely", () => {
    // Family names come from submitted documents; they reach a URL.
    expect(webFontFamilyFromStack('Sora"&family=Evil')).toBeNull();
    expect(webFontFamilyFromStack("../../etc/passwd")).toBeNull();
    expect(webFontFamilyFromStack("Bad<Name>, Sora")).toBe("Sora");
  });
});

describe("collecting what a document needs", () => {
  it("treats Inter as a download, because the renderer image has no Inter", () => {
    // This is the whole bug: the canonical fixture asks for Inter and the
    // sandbox has never had it, so every film so far rendered in a fallback
    // grotesque without anything reporting a problem.
    const fonts = requiredFonts(createCanonicalCreativeFixture());
    expect(fonts.map((font) => font.family)).toEqual(["Inter"]);
    expect(fonts[0].weights.length).toBeGreaterThan(1);
  });

  it("collects families and every weight actually rendered", () => {
    const document = createCanonicalCreativeFixture();
    document.designSystem.typography.heading.fontFamily = "Sora";
    document.designSystem.typography.heading.fontWeight = 700;
    const text = document.scenes[0].elements.find((element) => element.type === "text");
    if (!text || text.type !== "text") throw new Error("fixture has no text element");
    text.style = { token: "heading", overrides: { fontWeight: 860 } };

    // Both families are needed: Sora for headings, Inter still for body/caption.
    const fonts = requiredFonts(document);
    expect(fonts.map((font) => font.family)).toEqual(["Inter", "Sora"]);
    const sora = fonts.find((font) => font.family === "Sora")!;
    // Both the token weight and the override weight must be fetched.
    expect(sora.weights).toContain(700);
    expect(sora.weights).toContain(860);
  });

  it("finds a family an element override introduces on its own", () => {
    const document = createCanonicalCreativeFixture();
    const text = document.scenes[0].elements.find((element) => element.type === "text");
    if (!text || text.type !== "text") throw new Error("fixture has no text element");
    text.style = { token: "heading", overrides: { fontFamily: "Sora" } };

    expect(requiredFonts(document).map((font) => font.family)).toContain("Sora");
  });

  it("clamps a weight outside the CSS range", () => {
    const document = createCanonicalCreativeFixture();
    document.designSystem.typography.heading.fontFamily = "Sora";
    document.designSystem.typography.heading.fontWeight = 4000;
    const sora = requiredFonts(document).find((font) => font.family === "Sora")!;
    expect(sora.weights).toEqual([900]);
  });

  it("survives a document with no typography at all", () => {
    const broken = { designSystem: {}, scenes: [] } as unknown as CreativeDocument;
    expect(() => requiredFonts(broken)).not.toThrow();
    expect(requiredFonts(broken)).toEqual([]);
  });
});

describe("asking a font service", () => {
  it("degrades from exact weights to something every family has", () => {
    const urls = googleFontsUrlCandidates({ family: "Sora", weights: [400, 860] });
    expect(urls[0]).toContain("family=Sora:wght@400;860");
    expect(urls[1]).toContain("wght@400;700");
    expect(urls[2]).toBe("https://fonts.googleapis.com/css2?family=Sora&display=block");
  });

  it("blocks rather than swaps", () => {
    // display=swap would let one frame render in the fallback and the next in
    // the real face — two different films from one document.
    for (const url of googleFontsUrlCandidates({ family: "Sora", weights: [400] })) {
      expect(url).toContain("display=block");
      expect(url).not.toContain("display=swap");
    }
  });

  it("encodes a multi-word family", () => {
    expect(googleFontsUrlCandidates({ family: "Open Sans", weights: [400] })[0]).toContain(
      "family=Open+Sans",
    );
  });

  it("refuses to build a URL for an unsafe family", () => {
    expect(googleFontsUrlCandidates({ family: 'X"&family=Evil', weights: [400] })).toEqual([]);
  });
});
