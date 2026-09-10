import type { CreativeDocument, CreativeElement, CreativeScene } from "./schema";

export interface CreativeDocumentDiff {
  changedSceneIds: string[];
  changedElementIds: string[];
  addedElementIds: string[];
  removedElementIds: string[];
  designSystemChanged: boolean;
  audioChanged: boolean;
  markersChanged: boolean;
  continuationsChanged: boolean;
  metadataChanged: boolean;
  durationBeforeMs: number;
  durationAfterMs: number;
}

function stable(value: unknown): string {
  if (value === undefined) return "undefined";
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(stable).join(",")}]`;
  return `{${Object.entries(value as Record<string, unknown>)
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([key, item]) => `${JSON.stringify(key)}:${stable(item)}`)
    .join(",")}}`;
}

function renderedDurationMs(document: CreativeDocument): number {
  if (!document.scenes.length) return 0;
  let total = 0;
  document.scenes.forEach((scene, index) => {
    total += scene.durationMs;
    if (index < document.scenes.length - 1) total -= Math.max(0, scene.transitionOut?.durationMs ?? 0);
  });
  return Math.max(0, total);
}

function elementMap(scene: CreativeScene | undefined): Map<string, CreativeElement> {
  return new Map((scene?.elements ?? []).map((element) => [element.id, element]));
}

export function diffCreativeDocuments(before: CreativeDocument, after: CreativeDocument): CreativeDocumentDiff {
  const beforeScenes = new Map(before.scenes.map((scene) => [scene.id, scene]));
  const afterScenes = new Map(after.scenes.map((scene) => [scene.id, scene]));
  const sceneIds = new Set([...beforeScenes.keys(), ...afterScenes.keys()]);
  const changedSceneIds: string[] = [];
  const changedElementIds = new Set<string>();
  const addedElementIds: string[] = [];
  const removedElementIds: string[] = [];

  for (const sceneId of sceneIds) {
    const from = beforeScenes.get(sceneId);
    const to = afterScenes.get(sceneId);
    if (stable(from) !== stable(to)) changedSceneIds.push(sceneId);
    const fromElements = elementMap(from);
    const toElements = elementMap(to);
    const ids = new Set([...fromElements.keys(), ...toElements.keys()]);
    for (const id of ids) {
      const oldElement = fromElements.get(id);
      const newElement = toElements.get(id);
      if (!oldElement && newElement) addedElementIds.push(id);
      else if (oldElement && !newElement) removedElementIds.push(id);
      if (stable(oldElement) !== stable(newElement)) changedElementIds.add(id);
    }
  }

  return {
    changedSceneIds,
    changedElementIds: [...changedElementIds],
    addedElementIds,
    removedElementIds,
    designSystemChanged: stable(before.designSystem) !== stable(after.designSystem),
    audioChanged: stable(before.audio ?? []) !== stable(after.audio ?? []),
    markersChanged: stable(before.markers ?? []) !== stable(after.markers ?? []),
    continuationsChanged:
      stable(before.continuations ?? []) !== stable(after.continuations ?? []) ||
      stable(before.groupContinuations ?? []) !== stable(after.groupContinuations ?? []),
    metadataChanged: stable(before.metadata ?? {}) !== stable(after.metadata ?? {}),
    durationBeforeMs: renderedDurationMs(before),
    durationAfterMs: renderedDurationMs(after),
  };
}

export function changedDocumentPayload(after: CreativeDocument, diff: CreativeDocumentDiff) {
  const sceneSet = new Set(diff.changedSceneIds);
  const elementSet = new Set(diff.changedElementIds);
  return {
    partial: true as const,
    scenes: after.scenes
      .filter((scene) => sceneSet.has(scene.id))
      .map((scene) => ({
        ...scene,
        elements: scene.elements.filter((element) => elementSet.has(element.id)),
      })),
    ...(diff.designSystemChanged ? { design_system: after.designSystem } : {}),
    ...(diff.audioChanged ? { audio: after.audio ?? [] } : {}),
    ...(diff.markersChanged ? { markers: after.markers ?? [] } : {}),
    ...(diff.continuationsChanged
      ? { continuations: after.continuations ?? [], group_continuations: after.groupContinuations ?? [] }
      : {}),
    ...(diff.metadataChanged ? { metadata: after.metadata ?? {} } : {}),
  };
}
