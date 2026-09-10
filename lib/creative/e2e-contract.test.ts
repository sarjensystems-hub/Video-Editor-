import { describe, expect, it } from "vitest";
import { createCanonicalCreativeFixture } from "./fixtures";
import { applyCreativeTransaction } from "./transactions";
import { parseCreativeDirectorTransaction } from "./director";
import { importBasicSvg } from "./import";
import { parseDecompositionPlan, pixelCropFromNormalized } from "./decompose";
import { getCreativeCompositionMetadata } from "./remotion";
import { validateCreativeDocument } from "./validate";

describe("Creative Studio end-to-end domain contract", () => {
  it("keeps manual edits, agent edits, imports, decomposition and rendering on compatible contracts", () => {
    const original = createCanonicalCreativeFixture();

    const manual = applyCreativeTransaction(original, {
      summary: "Manual editor pass",
      operations: [
        { type: "set_text", sceneId: "scene-1", elementId: "headline", text: "FIND THE RIGHT PEOPLE FOR YOUR CAR." },
        { type: "move_element", sceneId: "scene-1", elementId: "headline", x: 96, y: 760 },
        { type: "set_design_token", namespace: "colors", token: "accent", value: "#D71920" },
      ],
    });
    expect(manual.ok).toBe(true);
    if (!manual.ok) return;
    const originalHeadline = original.scenes[0].elements.find((element) => element.id === "headline");
    expect(originalHeadline?.type === "text" ? originalHeadline.text : undefined).toBe("STOP GUESSING.");

    const agentTransaction = parseCreativeDirectorTransaction(
      manual.document,
      JSON.stringify({
        summary: "Agent motion refinement",
        operations: [
          { type: "set_transition", sceneId: "scene-1", transition: { kind: "fade", durationMs: 180, easing: "ease-in-out" } },
          { type: "set_locked", sceneId: "scene-1", elementId: "brand-logo", locked: true },
        ],
      }),
    );
    const agent = applyCreativeTransaction(manual.document, agentTransaction);
    expect(agent.ok).toBe(true);
    if (!agent.ok) return;
    expect(validateCreativeDocument(agent.document).valid).toBe(true);
    expect(agent.document.scenes[0].elements.find((element) => element.id === "brand-logo")?.locked).toBe(true);

    const imported = importBasicSvg(
      '<svg width="1080" height="1080"><rect id="panel" x="80" y="80" width="920" height="920" fill="#111111"/><text id="copy" x="140" y="540" font-size="72" fill="#ffffff">CAR CARE</text></svg>',
      "Imported card",
    );
    expect(imported.ok).toBe(true);
    if (!imported.ok) return;
    expect(imported.document.scenes[0].elements.map((element) => element.type)).toEqual(["shape", "text"]);
    expect(validateCreativeDocument(imported.document).valid).toBe(true);

    const candidates = parseDecompositionPlan(JSON.stringify({
      candidates: [
        { role: "subject", label: "vehicle", confidence: 0.97, x: 0.08, y: 0.2, width: 0.8, height: 0.55 },
      ],
    }));
    expect(candidates).toHaveLength(1);
    expect(pixelCropFromNormalized(candidates[0].box, 1080, 1350)).toEqual({
      left: 86,
      top: 270,
      width: 864,
      height: 743,
    });

    const metadata = getCreativeCompositionMetadata(agent.document);
    expect(metadata.width).toBe(agent.document.canvas.width);
    expect(metadata.height).toBe(agent.document.canvas.height);
    expect(metadata.fps).toBe(agent.document.canvas.fps);
    expect(metadata.durationMs).toBe(agent.document.scenes[0].durationMs);
    expect(metadata.durationInFrames).toBe(Math.ceil((metadata.durationMs / 1000) * metadata.fps));
  });
});