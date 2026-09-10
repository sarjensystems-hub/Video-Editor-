/**
 * One element becoming another across a scene boundary.
 *
 * This is what stops a film reading as slides. An orb becomes an integration
 * hub, a graph point becomes a network node, a tiny interface grows into the
 * next composition — the eye tracks one object through the cut instead of
 * seeing two compositions swapped.
 *
 * The mechanism is deliberately the simple direction. The *incoming* element
 * is the one that continues: for the first `durationMs` of its scene it is
 * drawn interpolating from where the outgoing element finished toward where it
 * belongs. At progress zero it sits exactly on the outgoing element, so the
 * handoff is invisible; at progress one it is itself. The outgoing element is
 * left completely alone — it is still on screen through the scenes' overlap and
 * is already fading under the transition.
 *
 * Doing it the other way round — dragging the outgoing element toward the
 * incoming one — would mean editing an element in a scene that is ending, whose
 * own animations are still running, and fighting them for the same properties.
 *
 * The hard part was never the interpolation. It is that scenes overlap by their
 * transition duration and the continuation has to fit inside that overlap, or
 * the two elements are never on screen together and the morph is a cut with
 * extra steps. That is a validation rule, not a rendering one, and it lives in
 * `validate.ts` so a document cannot describe a continuation that cannot happen.
 */
import type {
  CreativeContinuation,
  CreativeDocument,
  CreativeGroupContinuation,
  CreativeScene,
  EasingSpec,
} from "./schema";
import {
  resolveHierarchyTransform,
  type ResolvedHierarchyTransform,
} from "./hierarchy";
import { applyCreativeEasing } from "./evaluate";
import type { EvaluatedTransform } from "./evaluate";

/** The continuation feeding an element, if one does. */
export function findContinuationInto(
  document: CreativeDocument,
  sceneId: string,
  elementId: string,
): CreativeContinuation | undefined {
  return document.continuations?.find(
    (entry) => entry.toSceneId === sceneId && entry.toElementId === elementId,
  );
}

/**
 * How far through the handoff, or null when this moment is not inside one.
 *
 * Progress runs over the head of the incoming scene, so a continuation always
 * begins at that scene's first frame. Starting it anywhere else would leave the
 * incoming element sitting in the wrong place until the continuation began,
 * which is a jump — exactly what this exists to remove.
 */
export function continuationProgress(
  // Only the window matters, so element and group continuations share this
  // rather than one of them casting itself into the other's shape.
  continuation: { durationMs: number; easing?: EasingSpec },
  localMs: number,
): number | null {
  if (continuation.durationMs <= 0) return null;
  if (localMs < 0 || localMs >= continuation.durationMs) return null;
  const raw = localMs / continuation.durationMs;
  return applyCreativeEasing(continuation.easing ?? "ease-out", raw);
}

const lerp = (from: number, to: number, progress: number) => from + (to - from) * progress;

/**
 * Blend the incoming element's own transform back toward where the outgoing one
 * finished.
 *
 * Every geometric property is interpolated. `zIndex` is not: stacking is a
 * discrete decision and a half-way z-index is meaningless, so the incoming
 * element keeps its own from the first frame.
 */
export function blendContinuedTransform(
  fromTransform: EvaluatedTransform,
  ownTransform: EvaluatedTransform,
  progress: number,
): EvaluatedTransform {
  return {
    ...ownTransform,
    x: lerp(fromTransform.x, ownTransform.x, progress),
    y: lerp(fromTransform.y, ownTransform.y, progress),
    width: lerp(fromTransform.width, ownTransform.width, progress),
    height: lerp(fromTransform.height, ownTransform.height, progress),
    rotation: lerp(fromTransform.rotation, ownTransform.rotation, progress),
    opacity: lerp(fromTransform.opacity, ownTransform.opacity, progress),
    scaleX: lerp(fromTransform.scaleX, ownTransform.scaleX, progress),
    scaleY: lerp(fromTransform.scaleY, ownTransform.scaleY, progress),
    anchorX: lerp(fromTransform.anchorX, ownTransform.anchorX, progress),
    anchorY: lerp(fromTransform.anchorY, ownTransform.anchorY, progress),
  };
}

/**
 * How much overlap a pair of scenes has, which is what a continuation must fit
 * inside.
 *
 * A scene overlaps the next by its own `transitionOut` duration. Without a
 * transition there is no overlap at all, so a continuation across that boundary
 * has no window to happen in.
 */
export function sceneOverlapMs(document: CreativeDocument, fromSceneId: string): number {
  const index = document.scenes.findIndex((scene) => scene.id === fromSceneId);
  if (index < 0 || index === document.scenes.length - 1) return 0;
  return document.scenes[index].transitionOut?.durationMs ?? 0;
}

export interface ContinuationIssue {
  continuationId: string;
  message: string;
}

/**
 * Everything wrong with a document's continuations, in terms an author can act
 * on. Each message names the fix rather than only the fault, because the most
 * common mistake — no transition to morph inside — is invisible in a contact
 * sheet and reads as "the morph did not work".
 */
export function inspectContinuations(document: CreativeDocument): ContinuationIssue[] {
  const issues: ContinuationIssue[] = [];
  const sceneIndex = new Map(document.scenes.map((scene, index) => [scene.id, index]));

  for (const entry of document.continuations ?? []) {
    const from = sceneIndex.get(entry.fromSceneId);
    const to = sceneIndex.get(entry.toSceneId);

    if (from === undefined || to === undefined) {
      issues.push({ continuationId: entry.id, message: "Continuation names a scene that does not exist." });
      continue;
    }
    if (to !== from + 1) {
      issues.push({
        continuationId: entry.id,
        message: "A continuation must run from one scene into the one immediately after it.",
      });
      continue;
    }

    const fromScene = document.scenes[from];
    const toScene = document.scenes[to];
    if (!fromScene.elements.some((element) => element.id === entry.fromElementId)) {
      issues.push({ continuationId: entry.id, message: `Element ${entry.fromElementId} is not in ${entry.fromSceneId}.` });
      continue;
    }
    if (!toScene.elements.some((element) => element.id === entry.toElementId)) {
      issues.push({ continuationId: entry.id, message: `Element ${entry.toElementId} is not in ${entry.toSceneId}.` });
      continue;
    }

    if (entry.durationMs <= 0) {
      issues.push({ continuationId: entry.id, message: "Continuation durationMs must be greater than zero." });
      continue;
    }
    if (entry.durationMs > toScene.durationMs) {
      issues.push({
        continuationId: entry.id,
        message: `Continuation runs ${entry.durationMs}ms but ${entry.toSceneId} is only ${toScene.durationMs}ms long.`,
      });
      continue;
    }

    const overlap = sceneOverlapMs(document, entry.fromSceneId);
    if (overlap < entry.durationMs) {
      issues.push({
        continuationId: entry.id,
        message:
          `Continuation needs ${entry.durationMs}ms of overlap but ${entry.fromSceneId} overlaps ` +
          `${entry.toSceneId} by ${overlap}ms. Both elements have to be on screen together for the ` +
          `handoff to be invisible — lengthen ${entry.fromSceneId}'s transitionOut to at least ` +
          `${entry.durationMs}ms, or shorten the continuation.`,
      });
    }
  }

  return issues;
}

export type { EasingSpec };


/**
 * Group continuation: a cluster becoming another cluster.
 *
 * `continue_element` moves one object through a cut. Continuing a disc while
 * its label remained a separate element left both labels legible at once during
 * the handoff — the incoming one faded up beside the thing it was replacing.
 *
 * So a group hands off in two parts. Its transform interpolates from where the
 * outgoing group's finished, which carries every child as one composited
 * object. And any incoming child with no mapped counterpart is held back until
 * the handoff completes, because a child with no predecessor has nothing to
 * hand off *from* — showing it early is the doubling, not the morph.
 *
 * v1 stopped there: `childMapping` decided visibility only, and a cluster that
 * genuinely rearranges — not just translates as one block — needed a second,
 * separately authored `continue_element` per child that should move. v2 folds
 * that into the mapping itself: a pair with `morphGeometry` also carries that
 * child's own position/size/rotation/opacity from its predecessor toward its
 * own, on the group's own window, so the cluster can rearrange through the cut
 * without an author hand-writing one continuation per moving child.
 */

export function findGroupContinuationInto(
  document: CreativeDocument,
  sceneId: string,
  groupId: string,
): CreativeGroupContinuation | undefined {
  return document.groupContinuations?.find(
    (entry) => entry.toSceneId === sceneId && entry.toGroupId === groupId,
  );
}

/** Blend two hierarchy transforms; the pivot travels too, so the motion arcs rather than snapping. */
export function blendHierarchyTransform(
  from: ResolvedHierarchyTransform,
  own: ResolvedHierarchyTransform,
  progress: number,
): ResolvedHierarchyTransform {
  const at = (a: number, b: number) => a + (b - a) * progress;
  return {
    x: at(from.x, own.x),
    y: at(from.y, own.y),
    scaleX: at(from.scaleX, own.scaleX),
    scaleY: at(from.scaleY, own.scaleY),
    rotation: at(from.rotation, own.rotation),
    opacity: at(from.opacity, own.opacity),
    anchorX: at(from.anchorX, own.anchorX),
    anchorY: at(from.anchorY, own.anchorY),
    blurPx: at(from.blurPx ?? 0, own.blurPx ?? 0),
  };
}

/**
 * The incoming group's transform at a moment, blended back toward the outgoing
 * group's final one. Undefined when this group is not continuing, or the moment
 * is past the handoff — in which case the caller resolves it normally.
 */
export function resolveContinuedGroupTransform(
  document: CreativeDocument,
  scene: CreativeScene,
  groupId: string,
  localMs: number,
): ResolvedHierarchyTransform | undefined {
  const continuation = findGroupContinuationInto(document, scene.id, groupId);
  if (!continuation) return undefined;

  const progress = continuationProgress(continuation, localMs);
  if (progress === null) return undefined;

  const group = scene.groups.find((candidate) => candidate.id === groupId);
  const fromScene = document.scenes.find((candidate) => candidate.id === continuation.fromSceneId);
  const fromGroup = fromScene?.groups.find((candidate) => candidate.id === continuation.fromGroupId);
  if (!group?.transform || !fromScene || !fromGroup?.transform) return undefined;

  const source = resolveHierarchyTransform(
    fromGroup.transform,
    fromGroup.animations,
    Math.max(0, fromScene.durationMs - 1),
  );
  const own = resolveHierarchyTransform(group.transform, group.animations, localMs);
  return blendHierarchyTransform(source, own, progress);
}

/**
 * Whether an incoming element should be held back through a group handoff.
 *
 * True only for a child of a continuing group that has no mapped counterpart:
 * it has nothing to hand off from, so showing it during the handoff puts it on
 * screen beside the element it replaces. Mapped children stay visible, and
 * everything outside a continuing group is unaffected.
 */
export function isHeldBackByGroupContinuation(
  document: CreativeDocument,
  scene: CreativeScene,
  elementId: string,
  localMs: number,
): boolean {
  const groups = scene.groups.filter((group) => group.elementIds.includes(elementId));
  for (const group of groups) {
    const continuation = findGroupContinuationInto(document, scene.id, group.id);
    if (!continuation) continue;

    const progress = continuationProgress(continuation, localMs);
    if (progress === null) continue;

    const mapped = continuation.childMapping?.some((pair) => pair.toElementId === elementId);
    if (!mapped) return true;
  }
  return false;
}

/**
 * v2: the source to blend a mapped child's own geometry from, when its pair
 * opted into `morphGeometry` and this moment is inside the group's handoff.
 *
 * Deliberately a sibling of `isHeldBackByGroupContinuation` rather than a
 * shared refactor of it: that function's loop only ever answers "is there a
 * pair at all", and folding this one more condition into it would risk
 * changing what it returns for every document that predates this field. Two
 * small independent scans cost nothing; a subtly different
 * isHeldBackByGroupContinuation costs v1 films their old behaviour.
 *
 * Returns fromSceneId/fromElementId/progress rather than a resolved
 * transform, because resolving the source means evaluating it — animations
 * and all — which is `evaluate.ts`'s job, not this module's. That is also
 * exactly what `continue_element` needs to blend a whole element, so the
 * caller feeds both cases through the one blend function instead of this
 * module growing a second copy of it.
 */
export function findGroupChildMorphSource(
  document: CreativeDocument,
  scene: CreativeScene,
  elementId: string,
  localMs: number,
): { fromSceneId: string; fromElementId: string; progress: number } | undefined {
  const groups = scene.groups.filter((group) => group.elementIds.includes(elementId));
  for (const group of groups) {
    const continuation = findGroupContinuationInto(document, scene.id, group.id);
    if (!continuation) continue;

    const progress = continuationProgress(continuation, localMs);
    if (progress === null) continue;

    const pair = continuation.childMapping?.find((candidate) => candidate.toElementId === elementId);
    if (!pair?.morphGeometry) continue;

    return { fromSceneId: continuation.fromSceneId, fromElementId: pair.fromElementId, progress };
  }
  return undefined;
}

/** Everything wrong with a document's group continuations, in terms an author can act on. */
export function inspectGroupContinuations(document: CreativeDocument): ContinuationIssue[] {
  const issues: ContinuationIssue[] = [];
  const sceneIndex = new Map(document.scenes.map((scene, index) => [scene.id, index]));

  for (const entry of document.groupContinuations ?? []) {
    const from = sceneIndex.get(entry.fromSceneId);
    const to = sceneIndex.get(entry.toSceneId);

    if (from === undefined || to === undefined) {
      issues.push({ continuationId: entry.id, message: "Group continuation names a scene that does not exist." });
      continue;
    }
    if (to !== from + 1) {
      issues.push({
        continuationId: entry.id,
        message: "A group continuation must run from one scene into the one immediately after it.",
      });
      continue;
    }

    const fromScene = document.scenes[from];
    const toScene = document.scenes[to];
    const fromGroup = fromScene.groups.find((group) => group.id === entry.fromGroupId);
    const toGroup = toScene.groups.find((group) => group.id === entry.toGroupId);

    if (!fromGroup) {
      issues.push({ continuationId: entry.id, message: `Group ${entry.fromGroupId} is not in ${entry.fromSceneId}.` });
      continue;
    }
    if (!toGroup) {
      issues.push({ continuationId: entry.id, message: `Group ${entry.toGroupId} is not in ${entry.toSceneId}.` });
      continue;
    }

    // Both ends need a transform, because the transform is what carries the
    // motion. Two organisational groups have nothing to interpolate.
    if (!fromGroup.transform || !toGroup.transform) {
      issues.push({
        continuationId: entry.id,
        message:
          `Both groups need a transform for the handoff to carry motion. ` +
          `Set one with set_group_transform on ` +
          `${!fromGroup.transform ? entry.fromGroupId : entry.toGroupId}.`,
      });
      continue;
    }

    for (const pair of entry.childMapping ?? []) {
      if (!fromGroup.elementIds.includes(pair.fromElementId)) {
        issues.push({ continuationId: entry.id, message: `Mapped child ${pair.fromElementId} is not in group ${entry.fromGroupId}.` });
      }
      if (!toGroup.elementIds.includes(pair.toElementId)) {
        issues.push({ continuationId: entry.id, message: `Mapped child ${pair.toElementId} is not in group ${entry.toGroupId}.` });
      }
    }

    if (entry.durationMs <= 0) {
      issues.push({ continuationId: entry.id, message: "Group continuation durationMs must be greater than zero." });
      continue;
    }
    if (entry.durationMs > toScene.durationMs) {
      issues.push({
        continuationId: entry.id,
        message: `Group continuation runs ${entry.durationMs}ms but ${entry.toSceneId} is only ${toScene.durationMs}ms long.`,
      });
      continue;
    }

    const overlap = sceneOverlapMs(document, entry.fromSceneId);
    if (overlap < entry.durationMs) {
      issues.push({
        continuationId: entry.id,
        message:
          `Group continuation needs ${entry.durationMs}ms of overlap but ${entry.fromSceneId} overlaps ` +
          `${entry.toSceneId} by ${overlap}ms. Lengthen ${entry.fromSceneId}'s transitionOut to at least ` +
          `${entry.durationMs}ms, or shorten the continuation.`,
      });
    }
  }

  return issues;
}
