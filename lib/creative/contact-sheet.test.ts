import { describe, expect, it } from "vitest";
import { contactSheetColumnCount, planContactSheetLayout } from "./contact-sheet";

describe("contact sheet layout", () => {
  it("chooses the squarest grid that fills rows left to right", () => {
    expect(contactSheetColumnCount(1)).toBe(1);
    expect(contactSheetColumnCount(2)).toBe(2);
    expect(contactSheetColumnCount(3)).toBe(2);
    expect(contactSheetColumnCount(4)).toBe(2);
    expect(contactSheetColumnCount(5)).toBe(3);
    expect(contactSheetColumnCount(9)).toBe(3);
    expect(contactSheetColumnCount(12)).toBe(4);
  });

  it("lays a single portrait frame out without upscaling it", () => {
    const layout = planContactSheetLayout({ frameCount: 1, frameWidth: 1080, frameHeight: 1350 });
    expect(layout.columns).toBe(1);
    expect(layout.rows).toBe(1);
    expect(layout.tileWidth).toBe(1080);
    expect(layout.tileHeight).toBe(1350);
    expect(layout.sheetWidth).toBe(1080 + 32);
    expect(layout.sheetHeight).toBe(1350 + 32);
    expect(layout.tiles).toEqual([
      { index: 0, column: 0, row: 0, x: 16, y: 16, width: 1080, height: 1350 },
    ]);
  });

  it("packs four frames into a two by two grid inside the max sheet width", () => {
    const layout = planContactSheetLayout({ frameCount: 4, frameWidth: 1080, frameHeight: 1920 });
    expect(layout.columns).toBe(2);
    expect(layout.rows).toBe(2);
    // (1920 - 32 padding - 16 gap) / 2 = 936
    expect(layout.tileWidth).toBe(936);
    expect(layout.tileHeight).toBe(1664);
    expect(layout.sheetWidth).toBeLessThanOrEqual(1920);
    expect(layout.tiles.map((tile) => [tile.column, tile.row])).toEqual([
      [0, 0],
      [1, 0],
      [0, 1],
      [1, 1],
    ]);
    expect(layout.tiles[3].x).toBe(16 + 936 + 16);
    expect(layout.tiles[3].y).toBe(16 + 1664 + 16);
  });

  it("leaves a ragged final row when the count does not fill the grid", () => {
    const layout = planContactSheetLayout({ frameCount: 5, frameWidth: 1920, frameHeight: 1080 });
    expect(layout.columns).toBe(3);
    expect(layout.rows).toBe(2);
    expect(layout.tiles).toHaveLength(5);
    expect(layout.tiles[4]).toMatchObject({ column: 1, row: 1 });
  });

  it("preserves the source aspect ratio in every tile", () => {
    const layout = planContactSheetLayout({ frameCount: 6, frameWidth: 1080, frameHeight: 1350 });
    expect(layout.tileHeight / layout.tileWidth).toBeCloseTo(1350 / 1080, 2);
  });

  it("rejects impossible geometry instead of guessing", () => {
    expect(() => planContactSheetLayout({ frameCount: 0, frameWidth: 100, frameHeight: 100 })).toThrow(/at least one frame/i);
    expect(() => planContactSheetLayout({ frameCount: 2.5, frameWidth: 100, frameHeight: 100 })).toThrow(/at least one frame/i);
    expect(() => planContactSheetLayout({ frameCount: 2, frameWidth: 0, frameHeight: 100 })).toThrow(/positive frame dimensions/i);
  });
});
