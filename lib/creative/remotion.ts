import { getCreativeDurationMs } from "./evaluate";
import type { CreativeDocument } from "./schema";
import { collectCreativeUiAssetIds } from "./ui-element";
import { collectCreativeCompositeAssetIds } from "./composite";

export const CREATIVE_REMOTION_COMPOSITION_ID = "StudioCreative";

export interface CreativeRemotionAssetInput {
  url: string;
  mimeType?: string | null;
}

export type CreativeRemotionAssetMap = Record<string, CreativeRemotionAssetInput>;

export interface CreativeRemotionInputProps {
  document: CreativeDocument;
  assets: CreativeRemotionAssetMap;
}

export interface CreativeCompositionMetadata {
  width: number;
  height: number;
  fps: number;
  durationInFrames: number;
  durationMs: number;
}

export interface CreativeSceneTimelineEntry {
  sceneIndex: number;
  sceneId: string;
  startMs: number;
  endMs: number;
  durationMs: number;
  transitionOutMs: number;
}

export function getCreativeCompositionMetadata(document: CreativeDocument): CreativeCompositionMetadata {
  const durationMs = getCreativeDurationMs(document);
  return {
    width: document.canvas.width,
    height: document.canvas.height,
    fps: document.canvas.fps,
    durationInFrames: Math.max(1, Math.ceil((durationMs / 1000) * document.canvas.fps)),
    durationMs,
  };
}

export function getCreativeSceneTimeline(document: CreativeDocument): CreativeSceneTimelineEntry[] {
  let cursor = 0;
  return document.scenes.map((scene, index) => {
    const transitionOutMs = index === document.scenes.length - 1 ? 0 : scene.transitionOut?.durationMs ?? 0;
    const entry: CreativeSceneTimelineEntry = {
      sceneIndex: index,
      sceneId: scene.id,
      startMs: cursor,
      endMs: cursor + scene.durationMs,
      durationMs: scene.durationMs,
      transitionOutMs,
    };
    cursor += scene.durationMs - transitionOutMs;
    return entry;
  });
}

/**
 * Every registered asset ID a document references, including the image
 * nodes inside `ui` elements and every image/video/ui/nested-composite child
 * inside a `composite` element's own tree.
 *
 * Preview, MP4 rendering and the in-app render route all resolve assets
 * through this, so a UI panel's or a card's imagery cannot silently go
 * missing from one path while appearing in another.
 */
export function getCreativeDocumentAssetIds(document: CreativeDocument): string[] {
  const ids = new Set<string>();
  for (const scene of document.scenes) {
    for (const element of scene.elements) {
      if (element.type === "image" || element.type === "video") {
        ids.add(element.assetId);
        continue;
      }
      if (element.type === "ui") {
        for (const assetId of collectCreativeUiAssetIds(element)) ids.add(assetId);
      }
      if (element.type === "composite") {
        for (const assetId of collectCreativeCompositeAssetIds(element)) ids.add(assetId);
      }
    }
  }
  for (const clip of document.audio ?? []) ids.add(clip.assetId);
  return [...ids];
}

export function getCreativeInputAssetMap(
  assets: Array<{ id: string; url: string; mimeType?: string | null }>,
): CreativeRemotionAssetMap {
  return Object.fromEntries(
    assets.map((asset) => [asset.id, { url: asset.url, mimeType: asset.mimeType ?? null }]),
  );
}
