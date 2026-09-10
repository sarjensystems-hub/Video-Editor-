import type {
  CreativeConnectorElement,
  CreativeDocument,
  CreativeHierarchyTransform,
  CreativeScene,
} from "./schema";
import { evaluateElementAtTime, type EvaluatedTransform } from "./evaluate";
import { findOwningGroup, resolveHierarchyTransform } from "./hierarchy";
import { resolveContinuedGroupTransform } from "./continuation";

export interface ConnectorPoint { x: number; y: number }
export interface ResolvedConnectorGeometry {
  from: ConnectorPoint;
  to: ConnectorPoint;
  path: string;
}

function rotate(x: number, y: number, degrees: number): ConnectorPoint {
  const radians = (degrees * Math.PI) / 180;
  const cos = Math.cos(radians);
  const sin = Math.sin(radians);
  return { x: x * cos - y * sin, y: x * sin + y * cos };
}

function transformedElementCenter(transform: EvaluatedTransform): ConnectorPoint {
  const pivotX = transform.x + transform.width * transform.anchorX;
  const pivotY = transform.y + transform.height * transform.anchorY;
  const centerX = transform.x + transform.width / 2;
  const centerY = transform.y + transform.height / 2;
  const scaledX = (centerX - pivotX) * transform.scaleX;
  const scaledY = (centerY - pivotY) * transform.scaleY;
  const turned = rotate(scaledX, scaledY, transform.rotation);
  return { x: pivotX + turned.x, y: pivotY + turned.y };
}

function applyHierarchy(
  point: ConnectorPoint,
  transform: CreativeHierarchyTransform,
  canvasWidth: number,
  canvasHeight: number,
): ConnectorPoint {
  const pivotX = transform.anchorX * canvasWidth;
  const pivotY = transform.anchorY * canvasHeight;
  const scaledX = (point.x - pivotX) * transform.scaleX;
  const scaledY = (point.y - pivotY) * transform.scaleY;
  const turned = rotate(scaledX, scaledY, transform.rotation);
  return { x: pivotX + turned.x + transform.x, y: pivotY + turned.y + transform.y };
}

function endpointPoint(
  document: CreativeDocument,
  scene: CreativeScene,
  elementId: string,
  timeMs: number,
): ConnectorPoint | null {
  const element = scene.elements.find((candidate) => candidate.id === elementId);
  if (!element || element.type === "connector") return null;

  // Hidden is any group holding this element, transform or not. findOwningGroup
  // answers a different question - which group's transform wraps it - and only
  // returns groups that carry one, so asking it about visibility let an edge
  // stay drawn to a node evaluateSceneAtTime had already removed from the
  // scene. That check must match the evaluator's, which reads group.hidden
  // alone.
  if (scene.groups.some((group) => group.hidden && group.elementIds.includes(elementId))) {
    return null;
  }

  const group = findOwningGroup(scene.groups, elementId);
  const evaluated = evaluateElementAtTime(document, scene, element, timeMs);
  if (!evaluated) return null;
  let point = transformedElementCenter(evaluated.transform);
  if (group?.transform) {
    const continued = resolveContinuedGroupTransform(document, scene, group.id, timeMs);
    const resolved = continued ?? resolveHierarchyTransform(group.transform, group.animations, timeMs);
    point = applyHierarchy(point, resolved, document.canvas.width, document.canvas.height);
  }
  return point;
}

function pathFor(curve: CreativeConnectorElement["curve"], from: ConnectorPoint, to: ConnectorPoint): string {
  if (curve === "straight") return `M ${from.x} ${from.y} L ${to.x} ${to.y}`;
  if (curve === "orthogonal") {
    const midX = (from.x + to.x) / 2;
    return `M ${from.x} ${from.y} L ${midX} ${from.y} L ${midX} ${to.y} L ${to.x} ${to.y}`;
  }
  const deltaX = to.x - from.x;
  const bend = Math.max(40, Math.min(320, Math.abs(deltaX) * 0.45));
  const direction = deltaX >= 0 ? 1 : -1;
  return `M ${from.x} ${from.y} C ${from.x + bend * direction} ${from.y}, ${to.x - bend * direction} ${to.y}, ${to.x} ${to.y}`;
}

export function resolveConnectorGeometry(
  document: CreativeDocument,
  connector: CreativeConnectorElement,
  timeMs: number,
): ResolvedConnectorGeometry | null {
  const scene = document.scenes.find((candidate) => candidate.elements.some((element) => element.id === connector.id));
  if (!scene) return null;
  const from = endpointPoint(document, scene, connector.fromElementId, timeMs);
  const to = endpointPoint(document, scene, connector.toElementId, timeMs);
  if (!from || !to) return null;
  return { from, to, path: pathFor(connector.curve, from, to) };
}
