import type {
  AnimationProperty,
  CreativeDocument,
  CreativeElement,
  CreativeGroup,
  CreativeScene,
  CreativeTextElement,
  EasingSpec,
  MotionValueMode,
  TextAnimationGranularity,
} from "./schema";
import { resolveTextStyle } from "./evaluate";
import { groupTextUnitsByLine, splitTextUnits } from "./text-animation";

export type AuthoringPrimitiveErrorCode = "not_found" | "invalid_operation" | "duplicate_id";
export type AuthoringPrimitiveResult =
  | { ok: true; document: CreativeDocument }
  | { ok: false; code: AuthoringPrimitiveErrorCode; message: string };

export interface StaggerGroupSpec {
  sceneId: string;
  groupId: string;
  elementIds?: string[];
  property: AnimationProperty;
  from: number;
  to: number;
  mode?: MotionValueMode;
  startMs: number;
  durationMs: number;
  staggerMs: number;
  easing: EasingSpec;
}

export interface OrbitGroupSpec {
  sceneId: string;
  groupId: string;
  itemIds?: string[];
  centerElementId?: string;
  centerX?: number;
  centerY?: number;
  radius: number;
  startAngleDeg?: number;
  radiusTo?: number;
  rotateByDeg?: number;
  startMs?: number;
  endMs?: number;
  easing?: EasingSpec;
}

export interface ExplodeTextSpec {
  sceneId: string;
  elementId: string;
  granularity: Extract<TextAnimationGranularity, "word" | "character">;
  groupId?: string;
}

function fail(code: AuthoringPrimitiveErrorCode, message: string): AuthoringPrimitiveResult {
  return { ok: false, code, message };
}

function sceneAndGroup(
  document: CreativeDocument,
  sceneId: string,
  groupId: string,
): { scene: CreativeScene; group: CreativeGroup; sceneIndex: number } | AuthoringPrimitiveResult {
  const sceneIndex = document.scenes.findIndex((scene) => scene.id === sceneId);
  if (sceneIndex < 0) return fail("not_found", `Scene ${sceneId} was not found.`);
  const scene = document.scenes[sceneIndex];
  const group = scene.groups.find((candidate) => candidate.id === groupId);
  if (!group) return fail("not_found", `Group ${groupId} was not found in ${sceneId}.`);
  return { scene, group, sceneIndex };
}

function withScene(document: CreativeDocument, sceneIndex: number, scene: CreativeScene): CreativeDocument {
  const scenes = [...document.scenes];
  scenes[sceneIndex] = scene;
  return { ...document, scenes };
}

function elementBaseValue(element: CreativeElement, property: AnimationProperty): number {
  switch (property) {
    case "x": return element.transform.x;
    case "y": return element.transform.y;
    case "rotation": return element.transform.rotation;
    case "z": return element.transform.z ?? 0;
    case "rotationX": return element.transform.rotationX ?? 0;
    case "rotationY": return element.transform.rotationY ?? 0;
    case "opacity": return element.transform.opacity;
    case "scaleX":
    case "scaleY": return 1;
    case "blurPx": return element.adjustments?.blurPx ?? 0;
    case "drawProgress": return element.type === "chart" || element.type === "connector" ? element.drawProgress ?? 1 : 1;
    case "fillProgress": return element.type === "chart" ? element.fillProgress ?? element.drawProgress ?? 1 : 1;
    case "cropX": return element.type === "image" || element.type === "video" ? element.crop?.x ?? 0 : 0;
    case "cropY": return element.type === "image" || element.type === "video" ? element.crop?.y ?? 0 : 0;
    case "cropWidth": return element.type === "image" || element.type === "video" ? element.crop?.width ?? 1 : 1;
    case "cropHeight": return element.type === "image" || element.type === "video" ? element.crop?.height ?? 1 : 1;
  }
}

function motionValue(base: number, value: number, mode: MotionValueMode): number {
  if (mode === "absolute") return value;
  if (mode === "delta") return base + value;
  return base * value;
}

export function applyGroupStagger(document: CreativeDocument, spec: StaggerGroupSpec): AuthoringPrimitiveResult {
  const found = sceneAndGroup(document, spec.sceneId, spec.groupId);
  if ("ok" in found) return found;
  const { scene, group, sceneIndex } = found;
  if (!Number.isFinite(spec.durationMs) || spec.durationMs <= 0 || !Number.isFinite(spec.staggerMs) || spec.staggerMs < 0) {
    return fail("invalid_operation", "stagger_group durationMs must be positive and staggerMs must be non-negative.");
  }
  const ids = spec.elementIds?.length ? spec.elementIds : group.elementIds;
  if (!ids.length) return fail("invalid_operation", `Group ${group.id} has no children to stagger.`);
  const membership = new Set(group.elementIds);
  const missingMembership = ids.find((id) => !membership.has(id));
  if (missingMembership) return fail("invalid_operation", `Element ${missingMembership} is not a child of group ${group.id}.`);
  const byId = new Map(scene.elements.map((element) => [element.id, element] as const));
  const missing = ids.find((id) => !byId.has(id));
  if (missing) return fail("not_found", `Element ${missing} was not found in ${scene.id}.`);

  const mode = spec.mode ?? "absolute";
  const replacements = new Map<string, CreativeElement>();
  for (let index = 0; index < ids.length; index += 1) {
    const id = ids[index];
    const element = byId.get(id)!;
    const startMs = spec.startMs + index * spec.staggerMs;
    const endMs = startMs + spec.durationMs;
    const visibleStart = element.timing?.startMs ?? 0;
    const visibleEnd = element.timing?.endMs ?? scene.durationMs;
    if (startMs < visibleStart || endMs > visibleEnd) {
      return fail(
        "invalid_operation",
        `stagger_group puts ${id} at ${startMs}-${endMs}ms outside its visible ${visibleStart}-${visibleEnd}ms window.`,
      );
    }
    const base = elementBaseValue(element, spec.property);
    const preserved = (element.animations ?? []).filter((animation) => animation.property !== spec.property);
    replacements.set(id, {
      ...element,
      animations: [
        ...preserved,
        {
          id: `stagger:${group.id}:${spec.property}`,
          property: spec.property,
          keyframes: [
            { timeMs: startMs, value: motionValue(base, spec.from, mode), easing: spec.easing },
            { timeMs: endMs, value: motionValue(base, spec.to, mode), easing: spec.easing },
          ],
        },
      ],
    });
  }
  const elements = scene.elements.map((element) => replacements.get(element.id) ?? element);
  return { ok: true, document: withScene(document, sceneIndex, { ...scene, elements }) };
}

function orbitPosition(
  element: CreativeElement,
  centerX: number,
  centerY: number,
  radius: number,
  angleDeg: number,
): { x: number; y: number } {
  const angle = (angleDeg * Math.PI) / 180;
  return {
    x: centerX + Math.cos(angle) * radius - element.transform.width / 2,
    y: centerY + Math.sin(angle) * radius - element.transform.height / 2,
  };
}

export function applyOrbitGroup(document: CreativeDocument, spec: OrbitGroupSpec): AuthoringPrimitiveResult {
  const found = sceneAndGroup(document, spec.sceneId, spec.groupId);
  if ("ok" in found) return found;
  const { scene, group, sceneIndex } = found;
  if (!Number.isFinite(spec.radius) || spec.radius < 0 || (spec.radiusTo !== undefined && (!Number.isFinite(spec.radiusTo) || spec.radiusTo < 0))) {
    return fail("invalid_operation", "orbit_group radius and radiusTo must be non-negative finite numbers.");
  }
  const byId = new Map(scene.elements.map((element) => [element.id, element] as const));
  let centerX: number;
  let centerY: number;
  if (spec.centerElementId) {
    const center = byId.get(spec.centerElementId);
    if (!center) return fail("not_found", `Orbit center element ${spec.centerElementId} was not found in ${scene.id}.`);
    centerX = center.transform.x + center.transform.width / 2;
    centerY = center.transform.y + center.transform.height / 2;
  } else {
    if (!Number.isFinite(spec.centerX) || !Number.isFinite(spec.centerY)) {
      return fail("invalid_operation", "orbit_group requires centerElementId or finite centerX and centerY.");
    }
    centerX = spec.centerX!;
    centerY = spec.centerY!;
  }

  const defaultIds = group.elementIds.filter((id) => id !== spec.centerElementId);
  const ids = spec.itemIds?.length ? spec.itemIds : defaultIds;
  if (!ids.length) return fail("invalid_operation", `Group ${group.id} has no orbit items.`);
  const membership = new Set(group.elementIds);
  const bad = ids.find((id) => !membership.has(id));
  if (bad) return fail("invalid_operation", `Orbit item ${bad} is not a child of group ${group.id}.`);
  const missing = ids.find((id) => !byId.has(id));
  if (missing) return fail("not_found", `Orbit item ${missing} was not found in ${scene.id}.`);

  const animated = spec.startMs !== undefined || spec.endMs !== undefined || spec.radiusTo !== undefined || spec.rotateByDeg !== undefined;
  if (animated && (!Number.isFinite(spec.startMs) || !Number.isFinite(spec.endMs) || spec.endMs! <= spec.startMs!)) {
    return fail("invalid_operation", "Animated orbit_group requires finite startMs < endMs.");
  }
  const easing = spec.easing ?? "ease-in-out";
  const startAngle = spec.startAngleDeg ?? -90;
  const radiusTo = spec.radiusTo ?? spec.radius;
  const rotateBy = spec.rotateByDeg ?? 0;

  if (animated) {
    for (const id of ids) {
      const element = byId.get(id)!;
      const visibleStart = element.timing?.startMs ?? 0;
      const visibleEnd = element.timing?.endMs ?? scene.durationMs;
      if (spec.startMs! < visibleStart || spec.endMs! > visibleEnd) {
        return fail(
          "invalid_operation",
          `orbit_group puts ${id} at ${spec.startMs}-${spec.endMs}ms outside its visible ${visibleStart}-${visibleEnd}ms window.`,
        );
      }
    }
  }

  const replacements = new Map<string, CreativeElement>();
  for (let index = 0; index < ids.length; index += 1) {
    const id = ids[index];
    const element = byId.get(id)!;
    const angle = startAngle + (360 * index) / ids.length;
    const start = orbitPosition(element, centerX, centerY, spec.radius, angle);
    const end = orbitPosition(element, centerX, centerY, radiusTo, angle + rotateBy);
    if (!animated) {
      replacements.set(id, { ...element, transform: { ...element.transform, x: start.x, y: start.y } });
      continue;
    }
    const preserved = (element.animations ?? []).filter((animation) => animation.property !== "x" && animation.property !== "y");
    replacements.set(id, {
      ...element,
      transform: { ...element.transform, x: end.x, y: end.y },
      animations: [
        ...preserved,
        { id: `orbit:${group.id}:x`, property: "x", keyframes: [
          { timeMs: spec.startMs!, value: start.x, easing },
          { timeMs: spec.endMs!, value: end.x, easing },
        ] },
        { id: `orbit:${group.id}:y`, property: "y", keyframes: [
          { timeMs: spec.startMs!, value: start.y, easing },
          { timeMs: spec.endMs!, value: end.y, easing },
        ] },
      ],
    });
  }

  const elements = scene.elements.map((element) => replacements.get(element.id) ?? element);
  return { ok: true, document: withScene(document, sceneIndex, { ...scene, elements }) };
}

const AVERAGE_GLYPH_RATIO = 0.52;

function unitWidth(text: string, fontSize: number, letterSpacing: number): number {
  if (!text) return Math.max(1, fontSize * 0.25);
  return Math.max(1, text.length * (fontSize * AVERAGE_GLYPH_RATIO + letterSpacing));
}

export function explodeTextElement(document: CreativeDocument, spec: ExplodeTextSpec): AuthoringPrimitiveResult {
  const sceneIndex = document.scenes.findIndex((scene) => scene.id === spec.sceneId);
  if (sceneIndex < 0) return fail("not_found", `Scene ${spec.sceneId} was not found.`);
  const scene = document.scenes[sceneIndex];
  const elementIndex = scene.elements.findIndex((element) => element.id === spec.elementId);
  if (elementIndex < 0) return fail("not_found", `Element ${spec.elementId} was not found.`);
  const element = scene.elements[elementIndex];
  if (element.type !== "text") return fail("invalid_operation", `Element ${spec.elementId} is not text.`);
  if (element.transform.rotation !== 0) {
    return fail("invalid_operation", "explode_text currently requires an unrotated source; rotate the generated group afterwards instead.");
  }
  const groupId = spec.groupId ?? `${element.id}--exploded`;
  if (scene.groups.some((group) => group.id === groupId)) return fail("duplicate_id", `Group ${groupId} already exists.`);
  const units = splitTextUnits(element.text, spec.granularity);
  if (!units.length) return fail("invalid_operation", `Text element ${element.id} has no units to explode.`);

  let style;
  try {
    style = resolveTextStyle(document.designSystem, element.style);
  } catch (error) {
    return fail("invalid_operation", error instanceof Error ? error.message : String(error));
  }
  const lines = groupTextUnitsByLine(units);
  const lineHeightPx = style.fontSize * style.lineHeight;
  const generated: CreativeTextElement[] = [];

  lines.forEach((line, lineIndex) => {
    const widths = line.map((unit) => unitWidth(unit.text, style.fontSize, style.letterSpacing));
    const space = spec.granularity === "word" ? style.fontSize * AVERAGE_GLYPH_RATIO : 0;
    const total = widths.reduce((sum, width) => sum + width, 0) + Math.max(0, line.length - 1) * space;
    const alignOffset = style.align === "center" ? (element.transform.width - total) / 2 : style.align === "right" ? element.transform.width - total : 0;
    let cursor = alignOffset;
    line.forEach((unit, unitIndex) => {
      const width = widths[unitIndex];
      generated.push({
        ...element,
        id: `${element.id}--${spec.granularity}-${unit.index}`,
        name: `${element.name} ${unit.index + 1}`,
        text: unit.text,
        animation: undefined,
        fit: undefined,
        // Otherwise every exploded unit would keep the source element's live
        // counter and each independently render the same running number
        // instead of its own static word or character.
        counter: undefined,
        transform: {
          ...element.transform,
          x: element.transform.x + cursor,
          y: element.transform.y + lineIndex * lineHeightPx,
          width,
          height: lineHeightPx,
          anchorX: 0.5,
          anchorY: 0.5,
        },
      });
      cursor += width + space;
    });
  });

  const existingIds = new Set(scene.elements.map((item) => item.id));
  const collision = generated.find((item) => existingIds.has(item.id));
  if (collision) return fail("duplicate_id", `Generated text element ${collision.id} already exists.`);
  const elements = [...scene.elements];
  elements.splice(elementIndex, 1, ...generated);
  const groups = [...scene.groups, { id: groupId, name: `${element.name} exploded`, elementIds: generated.map((item) => item.id) }];
  return { ok: true, document: withScene(document, sceneIndex, { ...scene, elements, groups }) };
}
