import type { CreativeValidationIssue } from "./validate";

export function suggestCreativeValidationFix(issue: CreativeValidationIssue): string {
  const path = issue.path || "document";
  const message = issue.message.toLowerCase();
  if (issue.code === "unsupported_version") return "Set document.version to the currently supported CreativeDocument version before retrying.";
  if (issue.code === "duplicate_id") return `Choose a unique id/alias for ${path}; ids and element aliases must not collide in the project.`;
  if (issue.code === "missing_reference") return `Read the project and replace ${path} with an existing referenced id, or create/register the referenced object first.`;
  if (issue.code === "invalid_design_token") return `Use a defined design-system token or a valid literal value at ${path}; do not send an undefined token name.`;
  if (issue.code === "invalid_canvas") return "Use positive canvas width/height and an fps between 1 and 120.";
  if (issue.code === "invalid_timing") return `Keep ${path} inside its scene/clip duration with start before end; lengthen the owning scene if the intended timing needs more room.`;
  if (issue.code === "invalid_animation") return `Use supported animation properties/keyframes at ${path}, keep times ordered inside the visible interval, and use a named easing or cubic-bezier object.`;
  if (issue.code === "invalid_transition") return "Reduce the transition/continuation duration or lengthen the outgoing scene so the whole handoff fits inside the real scene overlap.";
  if (issue.code === "invalid_group") return `Make ${path} reference existing elements only, keep an element in at most one group, and give continued groups the transforms they need.`;
  if (issue.code === "invalid_transform") return `Use finite transform numbers at ${path}, positive width/height, normalized anchors, and a finite zIndex.`;
  if (issue.code === "invalid_element") {
    if (message.includes("polygon")) return "For a polygon mask, provide at least three normalized 0..1 points; polygon masks are hard-edged in V1.";
    if (message.includes("color") || message.includes("colour")) return `Use the advertised ColorValue object shape at ${path}, for example { kind: \"literal\", value: \"#ffffff\" } or a valid token reference.`;
    return `Read the element schema for ${path} and resend only fields valid for that element type; keep additional properties out.`;
  }
  if (issue.code === "invalid_scene") return `Read the scene at ${path}, keep duration positive, and ensure every group/element reference resolves inside that scene.`;
  return `Correct the value at ${path} according to the canonical CreativeDocument schema, then dry-run the edit before saving it.`;
}

/**
 * Operation/parser errors do not always originate as CreativeValidationIssue.
 * Keep those errors actionable too, using the same deterministic vocabulary.
 */
export function suggestCreativeOperationFix(code: string | undefined, message: string): string {
  const normalized = message.toLowerCase();
  if (normalized.includes("not found") || code === "not_found") return "Read the current project/scene first and retry with an existing id or alias; do not guess opaque ids.";
  if (normalized.includes("required")) return "Read the advertised operation schema and resend the missing required field; keep the rest of the transaction unchanged.";
  if (normalized.includes("unsupported operation")) return "Refresh the live Creative edit schema and use an operation type it currently advertises.";
  if (normalized.includes("namespace") || normalized.includes("design token")) return "Use a supported design-token namespace and send a value matching that token family; dry-run before saving.";
  if (normalized.includes("color") || normalized.includes("colour")) return "Use a ColorValue object such as { kind: \"literal\", value: \"#ffffff\" } or a valid token reference, not a bare color string where the schema advertises ColorValue.";
  if (normalized.includes("timing") || normalized.includes("duration") || normalized.includes("overlap")) return "Inspect duration_breakdown/timeline state, keep the edit inside the owning scene, and lengthen the scene before retrying if more overlap is required.";
  if (normalized.includes("selector") || normalized.includes("matched no")) return "Read semantic aliases/tags first, narrow the selector to known values, then dry-run the same patch.";
  return "Dry-run the transaction, read the current target state, and resend only fields accepted by the canonical Creative operation schema.";
}

export function validationIssueWithSuggestedFix(issue: CreativeValidationIssue) {
  return { ...issue, suggested_fix: suggestCreativeValidationFix(issue) };
}

export interface CreativeTransactionErrorLike {
  code: string;
  message: string;
  operationIndex?: number;
  operation_index?: number | null;
}

/** Preserve the original error evidence and attach one deterministic repair. */
export function transactionErrorWithSuggestedFix<T extends CreativeTransactionErrorLike>(error: T): T & { suggested_fix: string } {
  return {
    ...error,
    suggested_fix: suggestCreativeOperationFix(error.code, error.message),
  };
}
