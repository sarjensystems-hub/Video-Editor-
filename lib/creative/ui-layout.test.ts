import { describe, expect, it } from "vitest";
import { resolveUiChildFrames } from "./ui-layout";
import type { CreativeUiNode } from "./schema";
import { createCanonicalCreativeFixture } from "./fixtures";
import { validateCreativeDocument } from "./validate";
import { CREATIVE_ELEMENT_EXAMPLES } from "./schema-guide";
import type { CreativeElement } from "./schema";

const child = (id: string, width: number, height: number, extra: Partial<CreativeUiNode> = {}): CreativeUiNode => ({
  id, kind: "box", frame: { x: 0, y: 0, width, height }, ...extra,
} as CreativeUiNode);

describe("constraint and responsive UI layout", () => {
  it("stretches anchored nodes without mutating their fallback frame", () => {
    const node = child("panel", 100, 80, { constraints: { left: 20, right: 30, top: 10 } } as Partial<CreativeUiNode>);
    expect(resolveUiChildFrames({ width: 500, height: 300 }, [node])[0]).toEqual({ x: 20, y: 10, width: 450, height: 80 });
    expect(node.frame).toEqual({ x: 0, y: 0, width: 100, height: 80 });
  });

  it("lays out flex children with growth, gaps and alignment", () => {
    const nodes = [child("a", 100, 40, { layoutItem: { grow: 1 } } as Partial<CreativeUiNode>), child("b", 100, 60, { layoutItem: { grow: 2 } } as Partial<CreativeUiNode>)];
    const frames = resolveUiChildFrames({ width: 500, height: 120 }, nodes, { mode: "flex", direction: "row", gap: 20, padding: 10, align: "center" });
    expect(frames[0]).toMatchObject({ x: 10, y: 40, height: 40 });
    expect(frames[0].width).toBeCloseTo(186.6667, 4);
    expect(frames[1].x).toBeCloseTo(216.6667, 4);
  });

  it("builds a repeatable grid with column spans", () => {
    const frames = resolveUiChildFrames({ width: 420, height: 300 }, [
      child("wide", 10, 70, { layoutItem: { columnSpan: 2 } } as Partial<CreativeUiNode>), child("small", 10, 70),
    ], { mode: "grid", columns: 3, gap: 10, padding: 10, rowHeight: 70 });
    expect(frames[0].width).toBeCloseTo(263.3333, 4);
    expect(frames[1].x).toBeCloseTo(283.3333, 4);
  });

  it("implements start/end offsets on both constraint axes", () => {
    const start = child("start", 100, 50, { constraints: { horizontal: "start", left: 12, vertical: "start", top: 14 } } as Partial<CreativeUiNode>);
    const end = child("end", 100, 50, { constraints: { horizontal: "end", right: 12, vertical: "end", bottom: 14 } } as Partial<CreativeUiNode>);
    expect(resolveUiChildFrames({ width: 500, height: 300 }, [start, end])).toEqual([
      { x: 12, y: 14, width: 100, height: 50 },
      { x: 388, y: 236, width: 100, height: 50 },
    ]);
  });

  it("honours grid self-alignment without stretching authored height", () => {
    const frames = resolveUiChildFrames({ width: 220, height: 200 }, [
      child("center", 20, 30, { layoutItem: { alignSelf: "center" } } as Partial<CreativeUiNode>),
      child("end", 20, 40, { layoutItem: { alignSelf: "end" } } as Partial<CreativeUiNode>),
    ], { mode: "grid", columns: 2, padding: 10, gap: 10, rowHeight: 100 });
    expect(frames[0]).toMatchObject({ y: 45, height: 30 });
    expect(frames[1]).toMatchObject({ y: 70, height: 40 });
  });

  it("rejects malformed layout values and constraints mixed with parent layout", () => {
    const document = createCanonicalCreativeFixture();
    document.scenes[0].elements.push(structuredClone(CREATIVE_ELEMENT_EXAMPLES.ui) as unknown as CreativeElement);
    const ui = document.scenes[0].elements.find((element) => element.type === "ui");
    expect(ui?.type).toBe("ui");
    if (!ui || ui.type !== "ui" || ui.nodes[0]?.kind !== "box") return;
    ui.nodes[0].constraints = { horizontal: "center", left: 8 };
    ui.nodes[0].layout = { mode: "flex", direction: "diagonal", gap: -1 } as never;
    ui.nodes[0].children![0].constraints = { horizontal: "center" };
    const result = validateCreativeDocument(document);
    expect(result.valid).toBe(false);
    expect(result.issues.map((issue) => issue.path)).toEqual(expect.arrayContaining([
      expect.stringContaining("layout.direction"),
      expect.stringContaining("layout.gap"),
      expect.stringContaining("constraints"),
    ]));
    expect(result.issues).toEqual(expect.arrayContaining([
      expect.objectContaining({ path: expect.stringContaining("constraints.horizontal"), message: expect.stringMatching(/cannot be combined/i) }),
    ]));
  });
});
