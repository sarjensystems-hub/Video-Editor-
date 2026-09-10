/**
 * Group and camera transforms: moving many elements as one.
 *
 * Faking a push-in by animating every element's x, y and scale in lockstep is
 * both expensive to author and easy to get subtly out of sync — twenty
 * keyframe tracks that must agree exactly or the composition shears. A camera
 * is one track that cannot disagree with itself.
 *
 * This module decides; the renderers apply. Both the editor preview and the
 * Remotion composition wrap a group's children in one canvas-sized box carrying
 * the CSS resolved here, so a group composes the same way in both, and nesting
 * a camera over a group is just two boxes.
 *
 * Why a real wrapper rather than folding the parent transform into each child:
 * CSS places an element at its box then rotates and scales about that element's
 * own anchor. Folding a parent scale into a child has a clean closed form —
 * `x' = Sx + (1 - S)(P - o)` — but a parent rotation combined with a
 * non-uniform scale composes to a general 2x2 matrix, which cannot be written
 * as a single rotate plus scale at all. Analytic folding would therefore be
 * exact only for uniform scale and silently wrong elsewhere. A nested box is
 * exact for every case and composes to any depth.
 */
import type {
  CreativeCamera,
  CreativeGroup,
  CreativeHierarchyTransform,
  ElementAnimation,
} from "./schema";
import { evaluateAnimation } from "./evaluate";

export interface ResolvedHierarchyTransform {
  x: number;
  y: number;
  scaleX: number;
  scaleY: number;
  rotation: number;
  opacity: number;
  anchorX: number;
  anchorY: number;
  blurPx?: number;
}

export interface HierarchyCss {
  transformOrigin: string;
  transform: string;
  opacity: number;
  filter?: string;
  perspective?: string;
  perspectiveOrigin?: string;
  transformStyle?: "preserve-3d";
}

export const NEUTRAL_HIERARCHY_TRANSFORM: CreativeHierarchyTransform = {
  x: 0,
  y: 0,
  scaleX: 1,
  scaleY: 1,
  rotation: 0,
  opacity: 1,
  anchorX: 0.5,
  anchorY: 0.5,
};

export function createNeutralHierarchyTransform(): CreativeHierarchyTransform {
  return { ...NEUTRAL_HIERARCHY_TRANSFORM };
}

const clamp01 = (value: number) => Math.min(1, Math.max(0, value));

/**
 * The transform at a moment, after its animations.
 *
 * Only the properties a hierarchy transform actually has are read; a keyframe
 * track for something it does not own (a crop, say) is ignored rather than
 * failing, because the animation vocabulary is shared with elements and an
 * agent reusing a preset should not be punished for a track that cannot apply.
 */
export function resolveHierarchyTransform(
  base: CreativeHierarchyTransform,
  animations: ElementAnimation[] | undefined,
  timeMs: number,
): ResolvedHierarchyTransform {
  const resolved: ResolvedHierarchyTransform = { ...base };

  for (const animation of animations ?? []) {
    const value = evaluateAnimation(animation, timeMs);
    switch (animation.property) {
      case "x":
        resolved.x = value;
        break;
      case "y":
        resolved.y = value;
        break;
      case "scaleX":
        resolved.scaleX = Math.max(0, value);
        break;
      case "scaleY":
        resolved.scaleY = Math.max(0, value);
        break;
      case "rotation":
        resolved.rotation = value;
        break;
      case "opacity":
        resolved.opacity = clamp01(value);
        break;
      case "blurPx":
        resolved.blurPx = Math.max(0, value);
        break;
      default:
        break;
    }
  }

  return resolved;
}

/** A transform that would change nothing, and so needs no wrapper at all. */
export function isNeutralHierarchyTransform(transform: ResolvedHierarchyTransform): boolean {
  return (
    transform.x === 0 &&
    transform.y === 0 &&
    transform.scaleX === 1 &&
    transform.scaleY === 1 &&
    transform.rotation === 0 &&
    transform.opacity === 1 &&
    (transform.blurPx ?? 0) === 0
  );
}

/**
 * CSS for the wrapper box, or undefined when there is nothing to apply.
 *
 * The wrapper covers the whole canvas and children are positioned inside it in
 * canvas percentages, so the pivot expressed here is canvas-relative exactly as
 * the schema documents.
 *
 * Operation order is scale, then rotate, then translate. CSS applies transform
 * functions right to left, so the string reads translate-rotate-scale — the
 * conventional TRS order, and the one that makes a translated push-in behave
 * the way a camera operator expects rather than translating in scaled units.
 */
export function hierarchyTransformCss(
  transform: ResolvedHierarchyTransform,
): HierarchyCss | undefined {
  if (isNeutralHierarchyTransform(transform)) return undefined;
  return {
    transformOrigin: `${clamp01(transform.anchorX) * 100}% ${clamp01(transform.anchorY) * 100}%`,
    transform: `translate(${transform.x}px, ${transform.y}px) rotate(${transform.rotation}deg) scale(${transform.scaleX}, ${transform.scaleY})`,
    opacity: clamp01(transform.opacity),
    filter: (transform.blurPx ?? 0) > 0 ? `blur(${transform.blurPx}px)` : undefined,
  };
}

export function creativeElementTransformCss(transform: {
  rotation: number;
  scaleX: number;
  scaleY: number;
  z?: number;
  rotationX?: number;
  rotationY?: number;
}): Pick<HierarchyCss, "transform" | "transformStyle"> {
  const z = transform.z ?? 0;
  const rotationX = transform.rotationX ?? 0;
  const rotationY = transform.rotationY ?? 0;
  if (z === 0 && rotationX === 0 && rotationY === 0) {
    return { transform: `rotate(${transform.rotation}deg) scale(${transform.scaleX}, ${transform.scaleY})` };
  }
  return {
    transform: `translateZ(${z}px) rotateX(${rotationX}deg) rotateY(${rotationY}deg) rotateZ(${transform.rotation}deg) scale(${transform.scaleX}, ${transform.scaleY})`,
    transformStyle: "preserve-3d",
  };
}

/** Prevent an intermediate transformed group from flattening a 3D child. */
export function preserveHierarchyDepth(css: HierarchyCss | undefined): HierarchyCss | undefined {
  return css ? { ...css, transformStyle: "preserve-3d" } : css;
}

/** Resolved CSS for a scene camera, or undefined when there is no camera to apply. */
export function resolveCameraCss(
  camera: CreativeCamera | undefined,
  timeMs: number,
): HierarchyCss | undefined {
  if (!camera) return undefined;
  const transform = hierarchyTransformCss(resolveHierarchyTransform(camera.transform, camera.animations, timeMs));
  if (!camera.perspectivePx || camera.perspectivePx <= 0) return transform;
  return {
    ...(transform ?? { transformOrigin: "50% 50%", transform: "none", opacity: 1 }),
    perspective: `${camera.perspectivePx}px`,
    perspectiveOrigin: `${clamp01(camera.perspectiveOriginX ?? 0.5) * 100}% ${clamp01(camera.perspectiveOriginY ?? 0.5) * 100}%`,
    transformStyle: "preserve-3d",
  };
}

/** Resolved CSS for a group, or undefined when the group is organisational only. */
export function resolveGroupCss(group: CreativeGroup, timeMs: number): HierarchyCss | undefined {
  if (!group.transform) return undefined;
  return hierarchyTransformCss(
    resolveHierarchyTransform(group.transform, group.animations, timeMs),
  );
}

/**
 * Which group, if any, owns an element.
 *
 * Membership is single: an element in two transformed groups has no defined
 * composition, and the validator rejects it. This returns the first match so
 * the renderers stay total even on a document that predates that rule.
 */
export function findOwningGroup(
  groups: CreativeGroup[],
  elementId: string,
): CreativeGroup | undefined {
  return groups.find((group) => group.transform && group.elementIds.includes(elementId));
}

/**
 * Groups that actually transform, in document order, each with the ids it owns.
 *
 * Renderers iterate this to build one wrapper per transforming group and leave
 * every other element where it is — so a document with no group transforms
 * renders exactly the markup it rendered before this feature existed.
 */
export function transformingGroups(groups: CreativeGroup[]): CreativeGroup[] {
  return groups.filter((group) => group.transform && !group.hidden);
}
