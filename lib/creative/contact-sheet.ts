/**
 * Deterministic contact-sheet geometry.
 *
 * Pure module: given how many frames were rendered and the canvas shape,
 * it decides the grid, the tile size and every tile position. The renderer
 * only pastes bytes at the coordinates this module returns, so the sheet a
 * reviewing agent sees is reproducible from the inputs alone.
 *
 * Tiles are never upscaled past the source frame size — a contact sheet is
 * for judging composition and timing, not for inventing resolution.
 */

export const CONTACT_SHEET_MAX_WIDTH = 1920;
export const CONTACT_SHEET_GAP = 16;
export const CONTACT_SHEET_PADDING = 16;

export interface ContactSheetTile {
  index: number;
  column: number;
  row: number;
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface ContactSheetLayout {
  columns: number;
  rows: number;
  tileWidth: number;
  tileHeight: number;
  gap: number;
  padding: number;
  sheetWidth: number;
  sheetHeight: number;
  tiles: ContactSheetTile[];
}

export interface ContactSheetLayoutInput {
  frameCount: number;
  frameWidth: number;
  frameHeight: number;
  maxSheetWidth?: number;
  gap?: number;
  padding?: number;
}

/** Squarest grid that still fills rows left to right. */
export function contactSheetColumnCount(frameCount: number): number {
  return Math.max(1, Math.min(frameCount, Math.ceil(Math.sqrt(frameCount))));
}

export function planContactSheetLayout(input: ContactSheetLayoutInput): ContactSheetLayout {
  const { frameCount, frameWidth, frameHeight } = input;
  if (!Number.isInteger(frameCount) || frameCount < 1) {
    throw new Error("Contact sheet requires at least one frame");
  }
  if (!Number.isFinite(frameWidth) || frameWidth <= 0 || !Number.isFinite(frameHeight) || frameHeight <= 0) {
    throw new Error("Contact sheet requires positive frame dimensions");
  }

  const gap = input.gap ?? CONTACT_SHEET_GAP;
  const padding = input.padding ?? CONTACT_SHEET_PADDING;
  const maxSheetWidth = input.maxSheetWidth ?? CONTACT_SHEET_MAX_WIDTH;

  const columns = contactSheetColumnCount(frameCount);
  const rows = Math.ceil(frameCount / columns);

  const available = maxSheetWidth - padding * 2 - gap * (columns - 1);
  const tileWidth = Math.max(1, Math.min(Math.floor(frameWidth), Math.floor(available / columns)));
  const tileHeight = Math.max(1, Math.round((tileWidth * frameHeight) / frameWidth));

  const tiles: ContactSheetTile[] = [];
  for (let index = 0; index < frameCount; index += 1) {
    const column = index % columns;
    const row = Math.floor(index / columns);
    tiles.push({
      index,
      column,
      row,
      x: padding + column * (tileWidth + gap),
      y: padding + row * (tileHeight + gap),
      width: tileWidth,
      height: tileHeight,
    });
  }

  return {
    columns,
    rows,
    tileWidth,
    tileHeight,
    gap,
    padding,
    sheetWidth: padding * 2 + columns * tileWidth + gap * (columns - 1),
    sheetHeight: padding * 2 + rows * tileHeight + gap * (rows - 1),
    tiles,
  };
}
