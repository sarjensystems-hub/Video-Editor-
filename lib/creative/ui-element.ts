/**
 * Deterministic resolution of a `ui` element for rendering.
 *
 * Pure module. Given the document, the element and a scene-local time it
 * returns fully resolved geometry, colors and typography — every renderer
 * (Remotion final render, Remotion still preview, in-app scene preview)
 * consumes the same result, so the interface a reviewing agent sees in a
 * preview frame is the interface the final MP4 contains.
 *
 * The node tree is preserved rather than flattened so a renderer can honour
 * `clip` with real CSS overflow: a scrolling list clipped by its card is the
 * whole point of rendering product UI deterministically instead of asking a
 * generative video model to imagine it.
 */
import {
  applyCreativeEasing,
  evaluateAnimation,
  resolveColor,
  resolveTextStyle,
  type ResolvedTextStyle,
} from "./evaluate";
import type {
  CreativeDocument,
  CreativeElement,
  CreativeUiElement,
  CreativeUiNode,
  CreativeUiNodeKind,
  CreativeUiPointer,
  CreativeUiScroll,
  MediaFit,
} from "./schema";
import { resolveUiChildFrames } from "./ui-layout";

export interface ResolvedCreativeUiNode {
  id: string;
  kind: CreativeUiNodeKind;
  /** False when the node's timing window excludes this moment; skip it entirely. */
  visible: boolean;
  /** CSS transform for animated scale and rotation, or null when neither moves. */
  transform: string | null;
  /** Pivot for that transform. Always the node's own centre. */
  transformOrigin: string;
  x: number;
  y: number;
  width: number;
  height: number;
  opacity: number;
  borderRadius: number;
  clip: boolean;
  background: string | null;
  border: { width: number; color: string } | null;
  text: { value: string; style: ResolvedTextStyle } | null;
  image: { assetId: string; fit: MediaFit } | null;
  children: ResolvedCreativeUiNode[];
}

export interface ResolvedCreativeUiPointer {
  x: number;
  y: number;
  pressed: boolean;
  radius: number;
  color: string;
}

export interface ResolvedCreativeUiElement {
  viewport: { width: number; height: number };
  /** Independent axis scale that maps the fixed viewport onto the element box. */
  scaleX: number;
  scaleY: number;
  background: string | null;
  /** Vertical offset applied to the whole node canvas at this time. */
  scrollY: number;
  nodes: ResolvedCreativeUiNode[];
  pointer: ResolvedCreativeUiPointer | null;
}

export function isCreativeUiElement(element: CreativeElement): element is CreativeUiElement {
  return element.type === "ui";
}

/** Registered asset IDs referenced by a UI node tree, in first-seen order. */
export function collectCreativeUiAssetIds(element: CreativeUiElement): string[] {
  const ids: string[] = [];
  const walk = (nodes: CreativeUiNode[]) => {
    for (const node of nodes) {
      if (node.kind === "image") {
        if (!ids.includes(node.assetId)) ids.push(node.assetId);
      } else if (node.kind === "box" && node.children) {
        walk(node.children);
      }
    }
  };
  walk(element.nodes);
  return ids;
}

/** Total node count of a UI node tree, including nested children. */
export function countCreativeUiNodes(nodes: CreativeUiNode[]): number {
  return nodes.reduce(
    (total, node) => total + 1 + (node.kind === "box" && node.children ? countCreativeUiNodes(node.children) : 0),
    0,
  );
}

/**
 * Scroll offset at `timeMs`. Before the window the canvas sits at `fromY`,
 * after it at `toY`; in between it eases between them.
 */
export function resolveCreativeUiScrollY(scroll: CreativeUiScroll | undefined, timeMs: number): number {
  if (!scroll) return 0;
  if (timeMs <= scroll.startMs) return scroll.fromY;
  if (timeMs >= scroll.endMs) return scroll.toY;
  const raw = (timeMs - scroll.startMs) / (scroll.endMs - scroll.startMs);
  return scroll.fromY + (scroll.toY - scroll.fromY) * applyCreativeEasing(scroll.easing, raw);
}

/**
 * Pointer position at `timeMs`, linearly interpolated between keyframes.
 *
 * `pressed` is a discrete state, not an interpolated one: it is held from
 * the latest keyframe at or before `timeMs`, so a tap lands exactly on its
 * own keyframe instead of a frame later.
 */
export function resolveCreativeUiPointer(
  pointer: CreativeUiPointer | undefined,
  timeMs: number,
): { x: number; y: number; pressed: boolean } | null {
  if (!pointer || pointer.keyframes.length === 0) return null;
  const frames = pointer.keyframes;

  let pressed = frames[0].pressed;
  for (const keyframe of frames) {
    if (keyframe.timeMs > timeMs) break;
    pressed = keyframe.pressed;
  }

  const first = frames[0];
  if (timeMs <= first.timeMs) return { x: first.x, y: first.y, pressed };
  const last = frames[frames.length - 1];
  if (timeMs >= last.timeMs) return { x: last.x, y: last.y, pressed };

  for (let index = 0; index < frames.length - 1; index += 1) {
    const from = frames[index];
    const to = frames[index + 1];
    if (timeMs > to.timeMs) continue;
    const raw = (timeMs - from.timeMs) / (to.timeMs - from.timeMs);
    return {
      x: from.x + (to.x - from.x) * raw,
      y: from.y + (to.y - from.y) * raw,
      pressed,
    };
  }
  return { x: last.x, y: last.y, pressed };
}

/**
 * A node's animated state at a moment.
 *
 * Position and opacity fold into the node's own fields, because the renderers
 * already apply those. Scale and rotation become a CSS transform string here so
 * the renderers stay appliers rather than deciders — the same division that
 * keeps the preview and the export honest everywhere else.
 */
function resolveNodeMotion(node: CreativeUiNode, timeMs: number, frame = node.frame) {
  let x = frame.x;
  let y = frame.y;
  let opacity = node.opacity ?? 1;
  let scaleX = 1;
  let scaleY = 1;
  let rotation = 0;

  for (const animation of node.animations ?? []) {
    const value = evaluateAnimation(animation, timeMs);
    switch (animation.property) {
      case "x": x = value; break;
      case "y": y = value; break;
      case "opacity": opacity = Math.min(1, Math.max(0, value)); break;
      case "scaleX": scaleX = Math.max(0, value); break;
      case "scaleY": scaleY = Math.max(0, value); break;
      case "rotation": rotation = value; break;
      default: break;
    }
  }

  const moved = scaleX !== 1 || scaleY !== 1 || rotation !== 0;
  return {
    x,
    y,
    opacity,
    transform: moved ? `rotate(${rotation}deg) scale(${scaleX}, ${scaleY})` : null,
  };
}

function resolveNode(
  document: CreativeDocument,
  node: CreativeUiNode,
  timeMs: number,
  frame = node.frame,
): ResolvedCreativeUiNode {
  const motion = resolveNodeMotion(node, timeMs, frame);
  const base = {
    id: node.id,
    kind: node.kind,
    visible:
      !node.timing || (timeMs >= node.timing.startMs && timeMs < node.timing.endMs),
    transform: motion.transform,
    // The node's own centre, so a scaled row grows from its middle rather than
    // sliding off its top-left corner.
    transformOrigin: "50% 50%",
    x: motion.x,
    y: motion.y,
    width: frame.width,
    height: frame.height,
    opacity: motion.opacity,
    borderRadius: node.borderRadius ?? 0,
    clip: node.clip ?? false,
    background: null as string | null,
    border: null as { width: number; color: string } | null,
    text: null as { value: string; style: ResolvedTextStyle } | null,
    image: null as { assetId: string; fit: MediaFit } | null,
    children: [] as ResolvedCreativeUiNode[],
  };

  if (node.kind === "box") {
    const children = node.children ?? [];
    const frames = resolveUiChildFrames({ width: frame.width, height: frame.height }, children, node.layout);
    return {
      ...base,
      background: node.background ? resolveColor(document.designSystem, node.background) : null,
      border: node.border
        ? { width: node.border.width, color: resolveColor(document.designSystem, node.border.color) }
        : null,
      children: children.map((child, index) => resolveNode(document, child, timeMs, frames[index])),
    };
  }

  if (node.kind === "text") {
    return { ...base, text: { value: node.text, style: resolveTextStyle(document.designSystem, node.style) } };
  }

  return { ...base, image: { assetId: node.assetId, fit: node.fit } };
}

export function resolveCreativeUiElement(
  document: CreativeDocument,
  element: CreativeUiElement,
  timeMs: number,
): ResolvedCreativeUiElement {
  const pointer = resolveCreativeUiPointer(element.pointer, timeMs);
  return {
    viewport: { ...element.viewport },
    scaleX: element.transform.width / element.viewport.width,
    scaleY: element.transform.height / element.viewport.height,
    background: element.background ? resolveColor(document.designSystem, element.background) : null,
    scrollY: resolveCreativeUiScrollY(element.scroll, timeMs),
    nodes: (() => {
      const frames = resolveUiChildFrames(element.viewport, element.nodes);
      return element.nodes.map((node, index) => resolveNode(document, node, timeMs, frames[index]));
    })(),
    pointer:
      pointer && element.pointer
        ? {
            ...pointer,
            radius: element.pointer.radius,
            color: resolveColor(document.designSystem, element.pointer.color),
          }
        : null,
  };
}

/**
 * Replace one node inside a UI tree, by id, without disturbing anything else.
 *
 * Node ids are unique within their element, so the first match wins and the
 * walk stops descending it. Returns `found: false` rather than throwing so the
 * caller can report which id was missing — a silent no-op here would look like
 * an animation that simply did not work.
 */
export function patchCreativeUiNode(
  nodes: CreativeUiNode[],
  nodeId: string,
  patch: (node: CreativeUiNode) => CreativeUiNode,
): { nodes: CreativeUiNode[]; found: boolean } {
  let found = false;

  const walk = (list: CreativeUiNode[]): CreativeUiNode[] =>
    list.map((node) => {
      if (node.id === nodeId) {
        found = true;
        return patch(node);
      }
      if (node.kind === "box" && node.children?.length) {
        const children = walk(node.children);
        return children === node.children ? node : { ...node, children };
      }
      return node;
    });

  const next = walk(nodes);
  return { nodes: next, found };
}

/** Every node id in a tree, for validation and for error messages that can suggest one. */
export function collectCreativeUiNodeIds(nodes: CreativeUiNode[]): string[] {
  const ids: string[] = [];
  const walk = (list: CreativeUiNode[]) => {
    for (const node of list) {
      ids.push(node.id);
      if (node.kind === "box" && node.children?.length) walk(node.children);
    }
  };
  walk(nodes);
  return ids;
}
