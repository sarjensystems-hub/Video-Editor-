import * as base from "./transactions-base";
import type {
  CreativeDocument,
  CreativeElement,
  MotionPreset,
  SceneTransitionPreset,
  StrokeToken,
  TextStyleToken,
} from "./schema";
import { validateCreativeDocument } from "./validate";

export * from "./transactions-base";

type BaseOperation = base.CreativeTransactionOperation;
type BaseOperationWithoutDesignToken = Exclude<BaseOperation, { type: "set_design_token" }>;

export type CreativeTransactionOperation =
  | BaseOperationWithoutDesignToken
  | { type: "set_design_token"; namespace: "colors"; token: string; value: string }
  | { type: "set_design_token"; namespace: "spacing" | "radii"; token: string; value: number }
  | { type: "set_design_token"; namespace: "typography"; token: string; value: TextStyleToken }
  | { type: "set_design_token"; namespace: "strokes"; token: string; value: StrokeToken }
  | { type: "set_design_token"; namespace: "motionPresets"; token: string; value: MotionPreset }
  | { type: "set_design_token"; namespace: "sceneTransitions"; token: string; value: SceneTransitionPreset }
  | {
      type: "duplicate_group";
      sceneId: string;
      groupId: string;
      idPrefix: string;
      newGroupId?: string;
      name?: string;
      dx?: number;
      dy?: number;
    };

export interface CreativeTransaction {
  summary: string;
  operations: CreativeTransactionOperation[];
}

export type CreativeTransactionResult = base.CreativeTransactionResult;

const EXTENDED_NAMESPACES = new Set(["strokes", "motionPresets", "sceneTransitions"]);

function isExtendedOperation(operation: CreativeTransactionOperation): boolean {
  return operation.type === "duplicate_group"
    || (operation.type === "set_design_token" && EXTENDED_NAMESPACES.has(operation.namespace));
}

function clone<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}

function validateCandidate(document: CreativeDocument): { ok: true; document: CreativeDocument } | { ok: false; code: string; message: string } {
  const validation = validateCreativeDocument(document);
  if (validation.valid) return { ok: true, document };
  const issue = validation.issues[0];
  return {
    ok: false,
    code: issue?.code ?? "invalid_document",
    message: issue ? `${issue.path}: ${issue.message}` : "Operation produced an invalid document.",
  };
}

function applyExtendedOperation(
  document: CreativeDocument,
  operation: Extract<CreativeTransactionOperation, { type: "duplicate_group" | "set_design_token" }>,
): { ok: true; document: CreativeDocument } | { ok: false; code: string; message: string } {
  if (operation.type === "set_design_token") {
    if (!EXTENDED_NAMESPACES.has(operation.namespace)) {
      return { ok: false, code: "invalid_operation", message: `Unsupported extended design-token namespace ${operation.namespace}.` };
    }
    const next = clone(document);
    if (operation.namespace === "strokes") next.designSystem.strokes[operation.token] = clone(operation.value as StrokeToken);
    else if (operation.namespace === "motionPresets") next.designSystem.motion.presets[operation.token] = clone(operation.value as MotionPreset);
    else next.designSystem.motion.sceneTransitions[operation.token] = clone(operation.value as SceneTransitionPreset);
    return validateCandidate(next);
  }

  const sceneIndex = document.scenes.findIndex((scene) => scene.id === operation.sceneId);
  if (sceneIndex < 0) return { ok: false, code: "not_found", message: `Scene ${operation.sceneId} was not found.` };
  const scene = document.scenes[sceneIndex];
  const sourceGroup = scene.groups.find((group) => group.id === operation.groupId);
  if (!sourceGroup) return { ok: false, code: "not_found", message: `Group ${operation.groupId} was not found.` };
  const prefix = operation.idPrefix.trim();
  if (!prefix) return { ok: false, code: "invalid_operation", message: "duplicate_group idPrefix must not be empty." };

  const memberSet = new Set(sourceGroup.elementIds);
  const members = scene.elements.filter((element) => memberSet.has(element.id));
  if (members.length !== sourceGroup.elementIds.length) {
    return { ok: false, code: "invalid_group", message: `Group ${sourceGroup.id} contains an unresolved element reference.` };
  }
  const idMap = new Map(sourceGroup.elementIds.map((id) => [id, `${prefix}${id}`]));
  const existingIds = new Set(scene.elements.map((element) => element.id));
  for (const nextId of idMap.values()) {
    if (existingIds.has(nextId)) return { ok: false, code: "duplicate_id", message: `Element ${nextId} already exists.` };
  }
  const newGroupId = operation.newGroupId?.trim() || `${prefix}${sourceGroup.id}`;
  if (scene.groups.some((group) => group.id === newGroupId)) {
    return { ok: false, code: "duplicate_id", message: `Group ${newGroupId} already exists.` };
  }

  const dx = Number.isFinite(operation.dx) ? Number(operation.dx) : 0;
  const dy = Number.isFinite(operation.dy) ? Number(operation.dy) : 0;
  const duplicated = members.map((element) => {
    const next = clone(element) as CreativeElement;
    next.id = idMap.get(element.id)!;
    next.name = `${element.name} copy`;
    if (next.alias) next.alias = `${prefix}${next.alias}`;
    next.transform = { ...next.transform, x: next.transform.x + dx, y: next.transform.y + dy };
    if (next.type === "connector") {
      next.fromElementId = idMap.get(next.fromElementId) ?? next.fromElementId;
      next.toElementId = idMap.get(next.toElementId) ?? next.toElementId;
    }
    return next;
  });

  const next = clone(document);
  next.scenes[sceneIndex] = {
    ...next.scenes[sceneIndex],
    elements: [...next.scenes[sceneIndex].elements, ...duplicated],
    groups: [
      ...next.scenes[sceneIndex].groups,
      {
        ...clone(sourceGroup),
        id: newGroupId,
        name: operation.name?.trim() || `${sourceGroup.name} copy`,
        elementIds: sourceGroup.elementIds.map((id) => idMap.get(id)!),
      },
    ],
  };
  return validateCandidate(next);
}

/**
 * Existing transactions take the exact legacy engine path. Only transactions
 * that actually use a new consolidation operation enter the extension path,
 * so old atomic/repair semantics remain byte-for-byte unchanged.
 */
export function applyCreativeTransaction(
  document: CreativeDocument,
  transaction: CreativeTransaction,
): CreativeTransactionResult {
  if (!transaction.operations.some(isExtendedOperation)) {
    return base.applyCreativeTransaction(document, transaction as base.CreativeTransaction);
  }
  if (!transaction.summary.trim()) {
    return { ok: false, document, error: { code: "invalid_transaction", message: "Transaction summary is required." } };
  }
  if (!transaction.operations.length) {
    return { ok: false, document, error: { code: "invalid_transaction", message: "Transaction must contain at least one operation." } };
  }

  let candidate = document;
  let baseChunk: BaseOperation[] = [];
  let baseChunkStart = 0;
  const flushBase = (): { ok: true } | { ok: false; result: CreativeTransactionResult } => {
    if (!baseChunk.length) return { ok: true };
    const result = base.applyCreativeTransaction(candidate, { summary: transaction.summary, operations: baseChunk });
    const start = baseChunkStart;
    baseChunk = [];
    if (!result.ok) {
      return {
        ok: false,
        result: {
          ok: false,
          document,
          error: { ...result.error, operationIndex: start + (result.error.operationIndex ?? 0) },
        },
      };
    }
    candidate = result.document;
    return { ok: true };
  };

  for (let index = 0; index < transaction.operations.length; index += 1) {
    const operation = transaction.operations[index];
    if (!isExtendedOperation(operation)) {
      if (!baseChunk.length) baseChunkStart = index;
      baseChunk.push(operation as BaseOperation);
      continue;
    }
    const flushed = flushBase();
    if (!flushed.ok) return flushed.result;
    const result = applyExtendedOperation(candidate, operation as Extract<CreativeTransactionOperation, { type: "duplicate_group" | "set_design_token" }>);
    if (!result.ok) {
      return { ok: false, document, error: { code: result.code, message: result.message, operationIndex: index } };
    }
    candidate = result.document;
  }
  const flushed = flushBase();
  if (!flushed.ok) return flushed.result;

  return {
    ok: true,
    document: candidate,
    summary: transaction.summary.trim(),
    operationCount: transaction.operations.length,
  };
}
