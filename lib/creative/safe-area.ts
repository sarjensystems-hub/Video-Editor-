/**
 * Safe-area and overflow inspection.
 *
 * The  reel put UI outside the 9:16 action-safe area and let text run
 * past its own box. Both are mechanically detectable, so they should be
 * reported rather than discovered on playback.
 *
 * This module only ever *reports*. It never edits a document and never throws:
 * an editor that refuses a layout because a caption sits two pixels low is
 * worse than one that says so and lets the author decide. Nothing here is a
 * validation gate — `validateCreativeDocument` decides what may be stored,
 * this decides what is worth mentioning.
 *
 * Text overflow reuses the same estimate the renderer lays text out with, so
 * a warning always describes what actually rendered.
 */
import { estimateTextLayout } from "./text-animation";
import { resolveTextStyle } from "./evaluate";
import { findOwningGroup, resolveHierarchyTransform, type ResolvedHierarchyTransform } from "./hierarchy";
import type { CreativeDocument, CreativeElement, CreativeScene } from "./schema";

export interface SafeAreaPreset {
  /** Fractions of canvas width/height reserved at each edge. */
  top: number;
  bottom: number;
  left: number;
  right: number;
}

/**
 * Instagram Reels / TikTok style reservation. The bottom is much deeper than
 * the top because that is where the caption and action rail sit.
 */
export const REELS_SAFE_AREA: SafeAreaPreset = { top: 0.07, bottom: 0.2, left: 0.05, right: 0.05 };

/** Broadcast-style title-safe reservation: a flat margin on every edge. */
export const TITLE_SAFE_AREA: SafeAreaPreset = { top: 0.1, bottom: 0.1, left: 0.1, right: 0.1 };

/**
 * The preset a canvas of this shape should be judged against.
 *
 * Defaulting every project to the Reels reservation meant a 16:9 film was
 * measured against a vertical phone layout - a fifth of the frame reserved at
 * the bottom for a caption rail that does not exist there. The first run on a
 * landscape project returned dozens of warnings that were all noise, which is
 * worse than no check at all: an author who learns to ignore this tool will
 * ignore the real warning when it comes.
 *
 * Portrait and square keep Reels because that is where they are watched.
 */
export function defaultSafeAreaFor(canvas: { width: number; height: number }): SafeAreaPreset {
  return canvas.width > canvas.height ? TITLE_SAFE_AREA : REELS_SAFE_AREA;
}

export interface SafeAreaInsets {
  top: number;
  bottom: number;
  left: number;
  right: number;
}

export type SafeAreaWarningCode = "out_of_canvas" | "outside_safe_area" | "text_overflow";

export interface SafeAreaWarning {
  code: SafeAreaWarningCode;
  sceneId: string;
  elementId: string;
  message: string;
}

export function safeAreaInsetsFor(
  canvas: { width: number; height: number },
  preset: SafeAreaPreset,
): SafeAreaInsets {
  return {
    top: canvas.height * preset.top,
    bottom: canvas.height * preset.bottom,
    left: canvas.width * preset.left,
    right: canvas.width * preset.right,
  };
}

/**
 * The on-screen box of an element once its group and the scene camera have
 * been applied.
 *
 * Without this the inspector measured authored coordinates against the frame
 * and reported a scene that renders perfectly as broken. A film with a camera
 * pulled back to 0.82 had every element in the scene flagged, and the author's
 * only options were to ignore the tool or distort a correct layout to satisfy
 * it. Both are worse than no check.
 *
 * A camera can animate, so the box is the union of samples across the scene
 * rather than one reading: an element is outside the safe area if it is
 * outside at any point the audience sees it, not merely at time zero.
 */
function composedBox(
  document: CreativeDocument,
  scene: CreativeScene,
  element: CreativeElement,
): { x: number; y: number; right: number; bottom: number } {
  const { x, y, width: w, height: h } = element.transform;
  const plain = { x, y, right: x + w, bottom: y + h };

  const group = findOwningGroup(scene.groups, element.id);
  const camera = scene.camera;
  if (!group?.transform && !camera) return plain;

  const canvas = document.canvas;
  const apply = (
    box: { x: number; y: number; right: number; bottom: number },
    t: ResolvedHierarchyTransform,
  ) => {
    // The pivot is canvas-relative, exactly as the renderers place it.
    const pivotX = t.anchorX * canvas.width;
    const pivotY = t.anchorY * canvas.height;
    const radians = (t.rotation * Math.PI) / 180;
    const cos = Math.cos(radians);
    const sin = Math.sin(radians);
    const corners = [
      [box.x, box.y], [box.right, box.y], [box.right, box.bottom], [box.x, box.bottom],
    ].map(([cx, cy]) => {
      const dx = (cx - pivotX) * t.scaleX;
      const dy = (cy - pivotY) * t.scaleY;
      return [pivotX + dx * cos - dy * sin + t.x, pivotY + dx * sin + dy * cos + t.y];
    });
    const xs = corners.map((c) => c[0]);
    const ys = corners.map((c) => c[1]);
    return { x: Math.min(...xs), y: Math.min(...ys), right: Math.max(...xs), bottom: Math.max(...ys) };
  };

  // Start, middle and end catch a push-in, a pull-back and a drift alike. A
  // camera that leaves the frame between two samples would need the whole
  // curve; three readings is the honest trade for a static check.
  const samples = [0, scene.durationMs / 2, scene.durationMs];
  let union: { x: number; y: number; right: number; bottom: number } | null = null;

  for (const timeMs of samples) {
    let box = plain;
    if (group?.transform) box = apply(box, resolveHierarchyTransform(group.transform, group.animations, timeMs));
    if (camera) box = apply(box, resolveHierarchyTransform(camera.transform, camera.animations, timeMs));
    union = union
      ? {
          x: Math.min(union.x, box.x),
          y: Math.min(union.y, box.y),
          right: Math.max(union.right, box.right),
          bottom: Math.max(union.bottom, box.bottom),
        }
      : box;
  }
  return union ?? plain;
}

/**
 * Inspects every visible element in every scene.
 *
 * Pass a preset to also check the action-safe area; omit it to check only
 * that elements stay on the canvas and text fits its box.
 */
export function inspectCreativeSafeAreas(
  document: CreativeDocument,
  preset?: SafeAreaPreset,
): SafeAreaWarning[] {
  const warnings: SafeAreaWarning[] = [];
  const { width, height } = document.canvas;
  const insets = preset ? safeAreaInsetsFor(document.canvas, preset) : null;

  for (const scene of document.scenes) {
    for (const element of scene.elements) {
      if (element.hidden) continue;
      // Position is judged after the camera and group move it; the text-fit
      // check below deliberately uses the element's own box, because whether
      // text fits its container has nothing to do with where that container
      // ends up on screen.
      const { x, y, right, bottom } = composedBox(document, scene, element);
      const { width: w, height: h } = element.transform;

      // Scenery is meant to bleed. An element that covers the whole canvas is
      // a full-bleed plate whatever it calls itself, and one that declares
      // itself a background is taken at its word. Without this a film of eight
      // full-bleed scenes reports sixteen expected warnings, and a check that
      // is mostly noise stops being read.
      //
      // The inference only catches full-bleed plates. It deliberately does not
      // try to guess at partial scenery — a lower-third gradient scrim starts
      // partway down the frame, so widening the rule to reach it would also
      // stop reporting content that has drifted off an edge, which is the one
      // thing this check exists for. `role` is the mechanism for those, not a
      // fallback, so the warnings above name it.
      const coversCanvas = x <= 0 && y <= 0 && right >= width && bottom >= height;
      const isScenery = element.role === "background" || coversCanvas;

      if (isScenery) {
        // Still check text fit below: a background can hold text, and text
        // overflowing its own box is a defect wherever it sits.
      } else if (x < 0 || y < 0 || right > width || bottom > height) {
        warnings.push({
          code: "out_of_canvas",
          sceneId: scene.id,
          elementId: element.id,
          // Geometry cannot tell a deliberate bleed from a mistake: a
          // gradient scrim characteristically starts partway down the frame,
          // so it never covers the canvas and the inference below never fires
          // for it. The hint is here because this is where an author finds out.
          message:
            `Element extends outside the ${width}x${height} canvas. ` +
            `If it bleeds on purpose — a plate or a scrim — set role: "background" and this check will skip it.`,
        });
      } else if (
        insets &&
        (x < insets.left || y < insets.top || right > width - insets.right || bottom > height - insets.bottom)
      ) {
        warnings.push({
          code: "outside_safe_area",
          sceneId: scene.id,
          elementId: element.id,
          message:
            "Element sits outside the action-safe area and may be covered by platform UI. " +
            'If it is scenery rather than content, set role: "background".',
        });
      }

      if (element.type !== "text") continue;
      let layout;
      try {
        const style = resolveTextStyle(document.designSystem, element.style);
        layout = estimateTextLayout(
          element.text,
          {
            fontFamily: style.fontFamily,
            fontSize: style.fontSize,
            fontWeight: style.fontWeight,
            lineHeight: style.lineHeight,
            letterSpacing: style.letterSpacing,
          },
          { width: w, height: h },
          element.fit,
        );
      } catch {
        // A missing typography token is validate's problem, not inspection's.
        continue;
      }
      if (layout.overflows) {
        warnings.push({
          code: "text_overflow",
          sceneId: scene.id,
          elementId: element.id,
          message: `Text needs about ${Math.round(layout.heightPx)}px but its box is ${Math.round(h)}px tall.`,
        });
      }
    }
  }

  return warnings;
}
