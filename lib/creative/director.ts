import { extractJson, fetchAIResponse } from "../openrouter";
import { getCreativeDurationMs } from "./evaluate";
import type { CreativeDocument } from "./schema";
import {
  applyCreativeTransaction,
  type CreativeTransaction,
  type CreativeTransactionOperation,
} from "./transactions";

export const CREATIVE_DIRECTOR_MAX_TOKENS = 12_000;
export const CREATIVE_DIRECTOR_REPAIR_ATTEMPTS = 2;

const DIRECTOR_OPERATION_TYPES = new Set([
  "set_canvas",
  "add_element", "update_element", "remove_element", "reorder_element", "move_element", "resize_element",
  "set_text", "set_hidden", "set_locked", "set_timing", "set_animation", "apply_motion_preset",
  "add_scene", "update_scene", "remove_scene", "reorder_scene", "set_transition",
  "create_group", "update_group", "ungroup", "set_design_token",
]);

const OPERATION_FIELD_GUIDE = `Exact operation field shapes (camelCase is required):
set_canvas: {type,width?,height?,fps?}
add_element: {type,sceneId,element,index?}
update_element: {type,sceneId,elementId,patch}
remove_element: {type,sceneId,elementId}
reorder_element: {type,sceneId,elementId,toIndex}
move_element: {type,sceneId,elementId,x,y}
resize_element: {type,sceneId,elementId,width,height}
set_text: {type,sceneId,elementId,text}
set_hidden: {type,sceneId,elementId,hidden}
set_locked: {type,sceneId,elementId,locked}
set_timing: {type,sceneId,elementId,timing}
set_animation: {type,sceneId,elementId,animations}
apply_motion_preset: {type,sceneId,elementId,presetName,startMs}
add_scene: {type,scene,index?}
update_scene: {type,sceneId,patch} — patch must not contain elements or groups; use dedicated layer operations
remove_scene: {type,sceneId}
reorder_scene: {type,sceneId,toIndex}
set_transition: {type,sceneId,transition}
create_group: {type,sceneId,group}
update_group: {type,sceneId,groupId,patch}
ungroup: {type,sceneId,groupId}
set_design_token: {type,namespace,token,value}`;

const TRANSFORM_GUIDE = `Transform invariants are strict:
- x, y and rotation must be finite numbers.
- width and height must be positive numbers.
- opacity must be between 0 and 1 inclusive.
- anchorX and anchorY must each be between 0 and 1 inclusive. They are normalized anchor fractions, not pixel coordinates.
- zIndex must be an integer.
- When patching transform, preserve existing transform fields you do not intend to change.`;

const TEMPORAL_GUIDE = `Temporal invariants are strict:
- Every scene durationMs must stay positive.
- Every element timing must satisfy 0 <= startMs < endMs <= its scene durationMs.
- Every animation keyframe timeMs must be ordered and remain inside that element's visible timing window when one exists, otherwise inside the scene duration.
- If you change an element's timing window, also update every existing animation keyframe on that element so all keyframes remain inside the new visible window, or leave that element timing unchanged.
- The transaction is validated atomically against the final candidate CreativeDocument. Intermediate steps may be temporarily invalid at the document level only when later operations in the same transaction repair them before the transaction ends. Local operation constraints such as missing IDs, invalid types, out-of-range indexes and motion presets outside a visible window still fail immediately.
- When timing and animations on the same element must change together, keep the coupled edits in the same transaction. A single update_element operation with both timing and animations inside patch is often the clearest option, but paired set_timing and set_animation operations are valid when their final combined state satisfies all temporal invariants.
- If you shorten a scene, you must also update every affected element timing and keyframe in the same transaction. Prefer changing playbackRate, stagger, animation keyframe timing, or perceived motion speed instead of shortening a scene when the user asks for faster pacing.
- Scene transitions overlap adjacent scenes in the rendered timeline. Overall rendered duration is the sum of each non-final scene's durationMs minus its transitionOut durationMs, plus the final scene durationMs.
- currentTotalDurationMs in the document summary is this transition-overlap-aware rendered duration, not the raw sum of scene durationMs values.
- If the user asks to preserve total duration without an explicit target duration, the final overlap-aware rendered duration must equal currentTotalDurationMs exactly.
- If the user gives an explicit target duration such as 15 seconds, the final overlap-aware rendered duration must equal that target even if the current document differs.
- Changing a transition duration also changes overall rendered duration; compensate with scene durations or other transition timing in the same transaction when a duration constraint applies.`;

function sceneSummary(document: CreativeDocument) {
  return document.scenes.map((scene, sceneIndex) => ({
    index: sceneIndex,
    id: scene.id,
    name: scene.name,
    durationMs: scene.durationMs,
    transitionOut: scene.transitionOut ?? null,
    groups: scene.groups.map((group) => ({ id: group.id, name: group.name, elementIds: group.elementIds })),
    elements: scene.elements.map((element, elementIndex) => ({
      index: elementIndex,
      id: element.id,
      name: element.name,
      type: element.type,
      hidden: Boolean(element.hidden),
      locked: Boolean(element.locked),
      transform: element.transform,
      timing: element.timing ?? null,
      text: element.type === "text" ? element.text : undefined,
      assetId: element.type === "image" || element.type === "video" ? element.assetId : undefined,
      animations: element.animations ?? [],
      sourceStartMs: element.type === "video" ? element.sourceStartMs : undefined,
      sourceEndMs: element.type === "video" ? element.sourceEndMs : undefined,
      playbackRate: element.type === "video" ? element.playbackRate : undefined,
    })),
  }));
}

function documentView(document: CreativeDocument) {
  return {
    id: document.id,
    title: document.title,
    canvas: document.canvas,
    currentTotalDurationMs: getCreativeDurationMs(document),
    colors: document.designSystem.colors,
    typography: document.designSystem.typography,
    motionPresets: Object.keys(document.designSystem.motion.presets),
    scenes: sceneSummary(document),
  };
}

function buildInitialDurationBlock(document: CreativeDocument, intent: string): string {
  const durationConstraint = resolvedDurationConstraint(document, intent);
  return durationConstraint
    ? `\n\nRESOLVED DURATION CONSTRAINT:\n${JSON.stringify(durationConstraint)}\nWhen explicitTarget is true, the explicit target wins over preserve/keep wording. The final overlap-aware rendered duration must equal requiredRenderedDurationMs exactly. Apply the requiredDeltaMs to scene durations and/or transition overlaps while keeping all affected element timing valid.`
    : "";
}

function buildCreativeDirectorPromptBody(document: CreativeDocument, intent: string, durationBlock: string): string {
  return `You are the planning layer for Studio Creative Studio. Convert the user's creative direction into a CreativeDocument transaction.\n\nUSER INTENT:\n${intent.trim()}\n\nCURRENT CREATIVE DOCUMENT SUMMARY:\n${JSON.stringify(documentView(document))}${durationBlock}\n\nReturn JSON only in this exact top-level shape:\n{"summary":"short human-readable revision summary","operations":[...]}.\n\nAllowed operation types only:\nset_canvas, add_element, update_element, remove_element, reorder_element, move_element, resize_element, set_text, set_hidden, set_locked, set_timing, set_animation, apply_motion_preset, add_scene, update_scene, remove_scene, reorder_scene, set_transition, create_group, update_group, ungroup, set_design_token.\n\n${OPERATION_FIELD_GUIDE}\n\n${TRANSFORM_GUIDE}\n\n${TEMPORAL_GUIDE}\n\nFor set_canvas, include only dimensions or fps the user explicitly asks to change. For update_scene and update_element, put changes inside patch. update_scene is scene-level only and must not replace elements or groups; preserve native layers and use the dedicated element, timing, animation, reorder, and group operations for layer edits. For set_timing, put {startMs,endMs} inside timing. Never use snake_case field names such as scene_id or element_id.\n\nUse exact existing scene IDs, element IDs, group IDs and design tokens when referring to existing objects. Never invent an ID for an existing object. New objects must have unique IDs. Return only document operations, never framework code, compositor commands, shell commands, prose outside JSON, or renderer implementation details. Prefer a small coherent set of edits. Keep text native rather than baking typography into images. Do not mutate locked layers unless the user's intent explicitly asks to unlock or change them.`;
}

export function buildCreativeDirectorPrompt(document: CreativeDocument, intent: string): string {
  return buildCreativeDirectorPromptBody(document, intent, buildInitialDurationBlock(document, intent));
}

function buildRepairContext(document: CreativeDocument, intent: string, previousRaw: string) {
  try {
    const previousTransaction = parseCreativeDirectorTransaction(document, previousRaw);
    const previousCandidate = applyCreativeTransaction(document, previousTransaction);
    if (!previousCandidate.ok) return null;
    const requiredRenderedDurationMs = requestedDurationMs(document, intent);
    const previousCandidateRenderedDurationMs = getCreativeDurationMs(previousCandidate.document);
    return {
      candidateDocument: previousCandidate.document,
      durationState: requiredRenderedDurationMs === null ? null : {
        previousCandidateRenderedDurationMs,
        requiredRenderedDurationMs,
        requiredRemainingDeltaMs: requiredRenderedDurationMs - previousCandidateRenderedDurationMs,
      },
    };
  } catch {
    return null;
  }
}

export function buildCreativeDirectorRepairPrompt(
  document: CreativeDocument,
  intent: string,
  previousRaw: string,
  validationError: string,
): string {
  const repairContext = buildRepairContext(document, intent, previousRaw);
  const basePrompt = repairContext
    ? buildCreativeDirectorPromptBody(document, intent, "")
    : buildCreativeDirectorPrompt(document, intent);
  const candidateBlock = repairContext
    ? `\n\nPREVIOUS CANDIDATE DOCUMENT SUMMARY:\n${JSON.stringify(documentView(repairContext.candidateDocument))}`
    : "";
  const repairDurationBlock = repairContext?.durationState
    ? `\n\nREPAIR DURATION STATE:\n${JSON.stringify(repairContext.durationState)}\nFor this repair, requiredRemainingDeltaMs is the exact overlap-aware delta from the previous candidate to the required rendered duration. Preserve the valid previous edits and change that candidate by exactly this remaining delta. The corrected transaction is still a complete transaction evaluated against CURRENT CREATIVE DOCUMENT SUMMARY, so do not apply requiredRemainingDeltaMs directly to the original document or discard valid operations from PREVIOUS MODEL OUTPUT.`
    : "";
  return `${basePrompt}${candidateBlock}${repairDurationBlock}\n\nYour previous proposed transaction failed CreativeDocument or requested-duration validation and was NOT applied. Repair the transaction rather than explaining the error. The Operation N prefix is the zero-based failing operation index in PREVIOUS MODEL OUTPUT when the validator can attribute the failure to a specific operation. You must repair or remove that indexed operation and any coupled operations; do not return the same failing operation unchanged. For timing and animation coupling, keep every required correction in the same transaction so the final candidate is valid. For a set_timing validation failure involving animation keyframes outside the visible window, either keep the element's current timing, use one update_element operation whose patch contains both corrected timing and animations, or pair set_timing with set_animation so every final keyframe is inside the final visible window. For duration failures, recompute the final overlap-aware value before returning: sum(scene.durationMs) minus the sum of every non-final transitionOut.durationMs must equal the required rendered duration. If validation reports expected X but produced Y, correct the exact X - Y delta while keeping every affected element timing valid. Do not target the raw scene-duration sum.\n\nVALIDATION ERROR:\n${validationError}\n\nPREVIOUS MODEL OUTPUT:\n${previousRaw}\n\nReturn a complete corrected transaction JSON only. Preserve the user's intent, exact IDs, generated footage, and any requested total-duration constraint.`;
}

function objectValue(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("Creative director response must be an object");
  return value as Record<string, unknown>;
}

function requiredOperationField(operation: Record<string, unknown>, key: string) {
  if (operation[key] === undefined || operation[key] === null || operation[key] === "") {
    throw new Error(`Creative director operation ${String(operation.type)} requires ${key}`);
  }
}

function isFiniteNumber(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value);
}

function validateUpdateElementTransformPatch(operation: Record<string, unknown>) {
  if (operation.type !== "update_element") return;
  const patch = operation.patch;
  if (!patch || typeof patch !== "object" || Array.isArray(patch)) return;
  const transform = (patch as Record<string, unknown>).transform;
  if (transform === undefined) return;
  if (!transform || typeof transform !== "object" || Array.isArray(transform)) {
    throw new Error("Creative director operation update_element patch.transform must be an object");
  }
  const values = transform as Record<string, unknown>;
  for (const key of ["x", "y", "width", "height", "rotation", "opacity", "anchorX", "anchorY"] as const) {
    if (values[key] !== undefined && !isFiniteNumber(values[key])) {
      throw new Error(`Creative director operation update_element patch.transform.${key} must be a finite number`);
    }
  }
  for (const key of ["width", "height"] as const) {
    if (values[key] !== undefined && (values[key] as number) <= 0) {
      throw new Error(`Creative director operation update_element patch.transform.${key} must be positive`);
    }
  }
  if (values.opacity !== undefined && ((values.opacity as number) < 0 || (values.opacity as number) > 1)) {
    throw new Error("Creative director operation update_element patch.transform.opacity must be between zero and one");
  }
  for (const key of ["anchorX", "anchorY"] as const) {
    if (values[key] !== undefined && ((values[key] as number) < 0 || (values[key] as number) > 1)) {
      throw new Error(`Creative director operation update_element patch.transform.${key} must be between zero and one`);
    }
  }
  if (values.zIndex !== undefined && (!isFiniteNumber(values.zIndex) || !Number.isInteger(values.zIndex))) {
    throw new Error("Creative director operation update_element patch.transform.zIndex must be an integer");
  }
}

function validateUpdateScenePatch(operation: Record<string, unknown>) {
  if (operation.type !== "update_scene") return;
  const patch = operation.patch;
  if (!patch || typeof patch !== "object" || Array.isArray(patch)) {
    throw new Error("Creative director operation update_scene patch must be an object");
  }
  const values = patch as Record<string, unknown>;
  if ("elements" in values) {
    throw new Error("Creative director operation update_scene patch.elements is not allowed; use dedicated element operations instead");
  }
  if ("groups" in values) {
    throw new Error("Creative director operation update_scene patch.groups is not allowed; use dedicated group operations instead");
  }
}

function validateOperationFields(operation: Record<string, unknown>) {
  const type = String(operation.type);
  if (["add_element", "update_element", "remove_element", "reorder_element", "move_element", "resize_element", "set_text", "set_hidden", "set_locked", "set_timing", "set_animation", "apply_motion_preset", "update_scene", "remove_scene", "reorder_scene", "set_transition", "create_group", "update_group", "ungroup"].includes(type)) {
    requiredOperationField(operation, "sceneId");
  }
  if (["update_element", "remove_element", "reorder_element", "move_element", "resize_element", "set_text", "set_hidden", "set_locked", "set_timing", "set_animation", "apply_motion_preset"].includes(type)) {
    requiredOperationField(operation, "elementId");
  }
  if (["update_element", "update_scene", "update_group"].includes(type)) requiredOperationField(operation, "patch");
  if (type === "add_element") requiredOperationField(operation, "element");
  if (type === "add_scene") requiredOperationField(operation, "scene");
  if (type === "set_text") requiredOperationField(operation, "text");
  if (type === "set_timing") requiredOperationField(operation, "timing");
  if (type === "set_animation") requiredOperationField(operation, "animations");
  if (type === "apply_motion_preset") {
    requiredOperationField(operation, "presetName");
    requiredOperationField(operation, "startMs");
  }
  if (["update_group", "ungroup"].includes(type)) requiredOperationField(operation, "groupId");
  if (type === "create_group") requiredOperationField(operation, "group");
  validateUpdateScenePatch(operation);
  validateUpdateElementTransformPatch(operation);
}

function invalidJsonDiagnostics(raw: string, error: unknown): string {
  const trimmed = raw.trim();
  const parseError = (error instanceof Error ? error.message : String(error))
    .replace(/\s+/g, " ")
    .slice(0, 180);
  return [
    `length=${raw.length}`,
    `startsWithObject=${trimmed.startsWith("{")}`,
    `endsWithObject=${trimmed.endsWith("}")}`,
    `startsWithFence=${trimmed.startsWith("```")}`,
    `parseError=${parseError}`,
  ].join(", ");
}

function explicitRequestedDurationMs(intent: string): number | null {
  const normalized = intent.replace(/[–—]/g, "-");
  const explicitPatterns = [
    /\b(\d+(?:\.\d+)?)\s*-\s*seconds?\s+(?:overall\s+)?(?:duration|runtime)\b/i,
    /\b(\d+(?:\.\d+)?)\s+seconds?\s+(?:overall\s+)?(?:duration|runtime)\b/i,
    /\b(?:overall|total|target|rendered)\s+(?:duration|runtime)\b[^.\n]{0,48}?\b(\d+(?:\.\d+)?)\s*seconds?\b/i,
    /\b(?:exactly|target(?:ing)?|make it)\s+(\d+(?:\.\d+)?)\s*seconds?\b/i,
  ];
  for (const pattern of explicitPatterns) {
    const match = normalized.match(pattern);
    if (match) return Math.round(Number(match[1]) * 1000);
  }
  return null;
}

function preservesDurationRequest(intent: string): boolean {
  const normalized = intent.replace(/[–—]/g, "-");
  return /\b(?:preserve|keep|maintain)\b[^.\n]{0,100}\b(?:duration|runtime)\b/i.test(normalized)
    || /\b(?:duration|runtime)\b[^.\n]{0,100}\b(?:preserve|keep|maintain)\b/i.test(normalized);
}

function resolvedDurationConstraint(document: CreativeDocument, intent: string) {
  const currentRenderedDurationMs = getCreativeDurationMs(document);
  const explicit = explicitRequestedDurationMs(intent);
  if (explicit !== null) {
    return {
      currentRenderedDurationMs,
      requiredRenderedDurationMs: explicit,
      requiredDeltaMs: explicit - currentRenderedDurationMs,
      explicitTarget: true,
    };
  }
  if (preservesDurationRequest(intent)) {
    return {
      currentRenderedDurationMs,
      requiredRenderedDurationMs: currentRenderedDurationMs,
      requiredDeltaMs: 0,
      explicitTarget: false,
    };
  }
  return null;
}

function requestedDurationMs(document: CreativeDocument, intent: string): number | null {
  return resolvedDurationConstraint(document, intent)?.requiredRenderedDurationMs ?? null;
}

export function validateCreativeDirectorDurationConstraint(
  document: CreativeDocument,
  transaction: CreativeTransaction,
  intent: string,
): void {
  const expectedDurationMs = requestedDurationMs(document, intent);
  if (expectedDurationMs === null) return;
  const result = applyCreativeTransaction(document, transaction);
  if (!result.ok) {
    throw new Error(`Creative director transaction could not be evaluated for duration: ${result.error.message}`);
  }
  const actualDurationMs = getCreativeDurationMs(result.document);
  if (actualDurationMs !== expectedDurationMs) {
    throw new Error(
      `Creative director duration constraint failed: expected rendered duration ${expectedDurationMs}ms but transaction produced ${actualDurationMs}ms. `
      + `Scene transitions overlap; compensate scene durations and/or transition durations so the overlap-aware rendered duration is exactly ${expectedDurationMs}ms.`,
    );
  }
}

export function parseCreativeDirectorTransaction(document: CreativeDocument, raw: string): CreativeTransaction {
  let parsed: unknown;
  try {
    parsed = JSON.parse(extractJson(raw));
  } catch (error) {
    throw new Error(`Creative director returned invalid JSON (${invalidJsonDiagnostics(raw, error)})`);
  }
  const root = objectValue(parsed);
  const summary = typeof root.summary === "string" ? root.summary.trim() : "";
  if (!summary) throw new Error("Creative director transaction summary is required");
  if (!Array.isArray(root.operations) || root.operations.length === 0) throw new Error("Creative director transaction operations are required");
  if (root.operations.length > 100) throw new Error("Creative director transaction exceeds 100 operations");
  for (const rawOperation of root.operations) {
    const operation = objectValue(rawOperation);
    if (typeof operation.type !== "string" || !DIRECTOR_OPERATION_TYPES.has(operation.type)) {
      throw new Error(`Unsupported creative director operation: ${String(operation.type)}`);
    }
    validateOperationFields(operation);
  }
  const transaction: CreativeTransaction = {
    summary,
    operations: root.operations as CreativeTransactionOperation[],
  };
  const validation = applyCreativeTransaction(document, transaction);
  if (!validation.ok) throw new Error(`Operation ${validation.error.operationIndex ?? 0}: ${validation.error.message}`);
  return transaction;
}

function parseAndValidateCreativeDirectorTransaction(document: CreativeDocument, raw: string, intent: string): CreativeTransaction {
  const transaction = parseCreativeDirectorTransaction(document, raw);
  validateCreativeDirectorDurationConstraint(document, transaction, intent);
  return transaction;
}

export async function planCreativeTransaction(document: CreativeDocument, intent: string): Promise<CreativeTransaction> {
  const cleanIntent = intent.trim();
  if (!cleanIntent) throw new Error("Creative direction is required");

  let raw = await fetchAIResponse(
    buildCreativeDirectorPrompt(document, cleanIntent),
    CREATIVE_DIRECTOR_MAX_TOKENS,
    true,
    0.2,
  );
  let validationError = "";

  for (let attempt = 0; attempt <= CREATIVE_DIRECTOR_REPAIR_ATTEMPTS; attempt += 1) {
    try {
      return parseAndValidateCreativeDirectorTransaction(document, raw, cleanIntent);
    } catch (error) {
      validationError = error instanceof Error ? error.message : String(error);
      if (attempt === CREATIVE_DIRECTOR_REPAIR_ATTEMPTS) break;
      raw = await fetchAIResponse(
        buildCreativeDirectorRepairPrompt(document, cleanIntent, raw, validationError),
        CREATIVE_DIRECTOR_MAX_TOKENS,
        true,
        0.15,
      );
    }
  }

  throw new Error(
    `Creative director failed after ${CREATIVE_DIRECTOR_REPAIR_ATTEMPTS} repair attempts: ${validationError}`,
  );
}
