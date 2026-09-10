/**
 * Deterministic resolution of a `composite` element for rendering.
 *
 * Pure module, mirroring ui-element.ts's shape: given the document, the
 * owning scene, the element and a scene-local time, it resolves the
 * composite's local-to-box scale and every child's own resolved state.
 * Children are ordinary CreativeElements, so this reuses
 * `evaluateElementAtTime` (through `evaluateElementList`) exactly the way
 * `evaluateSceneAtTime` resolves a scene's own top-level elements - a chart,
 * text or shape child is resolved by the same code that resolves the same
 * element type at the top level, never a second copy of it. Both renderers
 * consume this and the shared evaluator; neither owns its own scale math or
 * its own child sort.
 */
import { evaluateElementList, type EvaluatedElement } from "./evaluate";
import { collectCreativeUiAssetIds } from "./ui-element";
import type { CreativeCompositeElement, CreativeDocument, CreativeElement, CreativeScene } from "./schema";

export function isCreativeCompositeElement(element: CreativeElement): element is CreativeCompositeElement {
  return element.type === "composite";
}

export interface ResolvedCreativeCompositeElement {
  viewport: { width: number; height: number };
  /** Independent axis scale mapping the fixed local viewport onto the element's box - same convention as resolveCreativeUiElement's scaleX/scaleY. */
  scaleX: number;
  scaleY: number;
  /**
   * Children resolved and z-sorted among themselves only - stacking inside
   * the composite's own box, never against anything outside it, because a
   * composite's children are never interleaved with the rest of the scene
   * (see the opacity design note on CreativeCompositeElement for why that is
   * exactly what lets a composite composite as one surface).
   */
  children: EvaluatedElement[];
}

/**
 * A composite's children, resolved on the scene's own clock and sorted by
 * their own zIndex - see `evaluateElementList` in evaluate.ts, the exact
 * function `evaluateSceneAtTime` uses for a scene's own top-level elements,
 * reused here rather than reimplemented so the sort cannot drift into two
 * different rules for what is the same operation.
 */
export function evaluateCompositeChildren(
  document: CreativeDocument,
  scene: CreativeScene,
  element: CreativeCompositeElement,
  timeMs: number,
): EvaluatedElement[] {
  return evaluateElementList(document, scene, element.children, timeMs, { followContinuations: false });
}

/** Resolved scale and children for one composite element at one moment. */
export function resolveCreativeCompositeElement(
  document: CreativeDocument,
  scene: CreativeScene,
  element: CreativeCompositeElement,
  timeMs: number,
): ResolvedCreativeCompositeElement {
  return {
    viewport: { ...element.viewport },
    scaleX: element.transform.width / element.viewport.width,
    scaleY: element.transform.height / element.viewport.height,
    children: evaluateCompositeChildren(document, scene, element, timeMs),
  };
}

/**
 * Registered asset ids referenced anywhere inside a composite's tree - an
 * image or video child directly, a `ui` child's own node tree, and any
 * nested composite's own children - so a card's imagery is fetched exactly
 * like a top-level element's, never silently missing because it happened to
 * be authored one level down. Mirrors `collectCreativeUiAssetIds`'s shape;
 * `getCreativeDocumentAssetIds` (remotion.ts) is the one caller, shared by
 * every render path (preview, still frame, contact sheet, MP4).
 */
export function collectCreativeCompositeAssetIds(element: CreativeCompositeElement): string[] {
  const ids: string[] = [];
  const add = (id: string) => {
    if (!ids.includes(id)) ids.push(id);
  };
  const walk = (children: CreativeElement[]) => {
    for (const child of children) {
      if (child.type === "image" || child.type === "video") add(child.assetId);
      else if (child.type === "ui") for (const id of collectCreativeUiAssetIds(child)) add(id);
      else if (child.type === "composite") walk(child.children);
    }
  };
  walk(element.children);
  return ids;
}

/**
 * Every descendant of a composite - children, grandchildren and so on -
 * flattened depth-first. Used by validate.ts for the total-descendant cap and
 * by document-summary.ts for the outline's lightweight children listing, so
 * the one walk is shared rather than re-written per caller.
 */
export function collectCreativeCompositeDescendants(element: CreativeCompositeElement): CreativeElement[] {
  const found: CreativeElement[] = [];
  const walk = (children: CreativeElement[]) => {
    for (const child of children) {
      found.push(child);
      if (child.type === "composite") walk(child.children);
    }
  };
  walk(element.children);
  return found;
}
