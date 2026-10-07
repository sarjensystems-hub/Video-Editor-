"use client";

import { useState } from "react";
import {
  ChevronDown,
  ChevronUp,
  Eye,
  EyeOff,
  Lock,
  LockOpen,
  Music,
  Plus,
  Square,
  Tag,
  Type,
  Video,
} from "lucide-react";
import { Button, IconButton } from "@/components/ui/Button";
import { EmptyNote, Panel } from "@/components/ui/Panel";
import { cn } from "@/components/ui/cn";
import { createDefaultTransform } from "@/lib/creative/defaults";
import type { CreativeDocument } from "@/lib/creative/schema";
import type { CreativeTransaction } from "@/lib/creative/transactions";
import type { EditorAsset } from "@/lib/creative/editor-asset";
import {
  CREATIVE_ASSET_CLASSES,
  audioClipKindForClass,
  type CreativeAssetClass,
} from "@/lib/creative/asset-class";
import { getCreativeDurationMs } from "@/lib/creative/evaluate";
import { getCreativeSceneTimeline } from "@/lib/creative/remotion";

/** The asset shelf's filter tabs, each a family of classes. */
const SHELVES: Array<{ id: string; label: string; classes: CreativeAssetClass[]; uploadAs?: CreativeAssetClass }> = [
  { id: "all", label: "All", classes: [] },
  { id: "video", label: "Video", classes: ["footage", "render"], uploadAs: "footage" },
  { id: "images", label: "Images", classes: ["image", "product", "logo", "character", "background"], uploadAs: "image" },
  { id: "narration", label: "Narration", classes: ["narration"], uploadAs: "narration" },
  { id: "music", label: "Music & SFX", classes: ["music", "sfx"], uploadAs: "music" },
];

export type { EditorAsset } from "@/lib/creative/editor-asset";

export default function CreativeLayersPanel({
  document: doc,
  sceneId,
  selectedIds,
  assets,
  onSelect,
  onTransaction,
  onOpenAssetForm,
  onNotice,
  bare,
}: {
  document: CreativeDocument;
  sceneId: string;
  selectedIds: string[];
  assets: EditorAsset[];
  onSelect: (ids: string[]) => void;
  onTransaction: (transaction: CreativeTransaction) => void;
  /** Opens the upload form, or the details of an existing asset. */
  onOpenAssetForm: (asset: EditorAsset | null, initialClass: CreativeAssetClass | null) => void;
  onNotice: (message: string) => void;
  /** Set inside a bottom sheet, where the surrounding surface is the sheet. */
  bare?: boolean;
}) {
  const scene = doc.scenes.find((item) => item.id === sceneId) ?? doc.scenes[0];
  const [shelf, setShelf] = useState("all");
  const activeShelf = SHELVES.find((item) => item.id === shelf) ?? SHELVES[0];
  const shelved = activeShelf.classes.length
    ? assets.filter((asset) => (activeShelf.classes as string[]).includes(asset.assetClass))
    : assets;
  // Topmost layer first, matching what the eye sees on the canvas.
  const stack = [...scene.elements].sort((a, b) => b.transform.zIndex - a.transform.zIndex);

  const addText = () => {
    const id = `text-${crypto.randomUUID().slice(0, 8)}`;
    onTransaction({
      summary: "Add text layer",
      operations: [
        {
          type: "add_element",
          sceneId: scene.id,
          element: {
            id,
            name: "Text",
            type: "text",
            text: "New text",
            style: { token: "heading" },
            transform: createDefaultTransform({
              x: 90,
              y: 180,
              width: Math.min(820, doc.canvas.width - 180),
              height: 140,
              anchorX: 0,
              anchorY: 0,
              zIndex: scene.elements.length + 2,
            }),
          },
        },
      ],
    });
    onSelect([id]);
  };

  const addShape = () => {
    const id = `shape-${crypto.randomUUID().slice(0, 8)}`;
    onTransaction({
      summary: "Add shape layer",
      operations: [
        {
          type: "add_element",
          sceneId: scene.id,
          element: {
            id,
            name: "Shape",
            type: "shape",
            shape: "rect",
            fill: { kind: "token", token: "accent" },
            borderRadius: 16,
            transform: createDefaultTransform({
              x: 120,
              y: 420,
              width: 360,
              height: 180,
              anchorX: 0,
              anchorY: 0,
              zIndex: scene.elements.length + 2,
            }),
          },
        },
      ],
    });
    onSelect([id]);
  };

  /**
   * Audio goes on the film's timeline, not into a scene. Narration and sound
   * effects start where the current scene does; music starts at the top and
   * ducks under any voice, since a bed is for the whole film.
   */
  const addAudio = (asset: EditorAsset) => {
    const filmMs = getCreativeDurationMs(doc);
    const kind = audioClipKindForClass(asset.assetClass);
    const startMs = kind === "music" ? 0 : getCreativeSceneTimeline(doc).find((entry) => entry.sceneId === scene.id)?.startMs ?? 0;
    const lengthMs = asset.durationMs ?? (kind === "music" ? filmMs : scene.durationMs);
    const endMs = Math.min(filmMs, startMs + lengthMs);
    if (endMs - startMs < 50) {
      onNotice("There is no room left on the timeline for this clip.");
      return;
    }
    onTransaction({
      summary: `Add ${CREATIVE_ASSET_CLASSES[asset.assetClass as CreativeAssetClass]?.label ?? "audio"}`,
      operations: [
        {
          type: "add_audio_clip",
          clip: {
            id: `${kind}-${crypto.randomUUID().slice(0, 8)}`,
            name: asset.filename || CREATIVE_ASSET_CLASSES[asset.assetClass as CreativeAssetClass]?.label || "Audio",
            assetId: asset.id,
            kind,
            startMs,
            endMs,
            sourceStartMs: 0,
            gain: kind === "music" ? 0.6 : 1,
            fadeOutMs: kind === "music" ? Math.min(1500, endMs - startMs) : 0,
            ...(kind === "music" ? { duckUnderVoice: true, duckToGain: 0.2 } : {}),
          },
        },
      ],
    });
    onNotice(`${asset.filename || "Audio"} added to the timeline at ${(startMs / 1000).toFixed(1)}s`);
  };

  const addAsset = (asset: EditorAsset) => {
    if (asset.kind === "audio") return addAudio(asset);
    if (asset.kind !== "image" && asset.kind !== "video") {
      onNotice("This file type cannot be placed on the canvas.");
      return;
    }
    const id = `${asset.kind}-${crypto.randomUUID().slice(0, 8)}`;
    const width = Math.min(doc.canvas.width * 0.78, 840);
    const height = Math.min(doc.canvas.height * 0.55, 650);
    const base = {
      id,
      name: asset.filename || (asset.kind === "video" ? "Video" : "Image"),
      assetId: asset.id,
      fit: "cover" as const,
      transform: createDefaultTransform({
        x: (doc.canvas.width - width) / 2,
        y: (doc.canvas.height - height) / 2,
        width,
        height,
        anchorX: 0,
        anchorY: 0,
        zIndex: scene.elements.length + 2,
      }),
    };
    const element =
      asset.kind === "video"
        ? { ...base, type: "video" as const, sourceStartMs: 0, volume: 1, playbackRate: 1 }
        : { ...base, type: "image" as const };
    onTransaction({ summary: `Add ${asset.kind} asset`, operations: [{ type: "add_element", sceneId: scene.id, element }] });
    onSelect([id]);
  };

  return (
    <div className="grid content-start gap-4">
      <Panel title="Add" bare={bare}>
        <div className="grid grid-cols-2 gap-2">
          <Button variant="subtle" size="sm" onClick={addText} className="flex-col gap-1 !h-auto py-2.5">
            <Type className="h-4 w-4" /> Text
          </Button>
          <Button variant="subtle" size="sm" onClick={addShape} className="flex-col gap-1 !h-auto py-2.5">
            <Square className="h-4 w-4" /> Shape
          </Button>
        </div>
      </Panel>

      <Panel title={`Layers · ${scene.name}`} bare={bare}>
        <ul className="grid gap-1">
          {stack.map((element) => {
            const selected = selectedIds.includes(element.id);
            const index = scene.elements.findIndex((item) => item.id === element.id);
            return (
              <li
                key={element.id}
                className={cn(
                  "rounded-xl border transition-colors",
                  selected ? "border-select/40 bg-select-wash" : "border-transparent hover:bg-canvas-subtle",
                )}
              >
                <div className="flex items-center gap-1 pr-1">
                  <button
                    type="button"
                    onClick={(event) =>
                      onSelect(
                        event.shiftKey
                          ? selected
                            ? selectedIds.filter((id) => id !== element.id)
                            : [...selectedIds, element.id]
                          : [element.id],
                      )
                    }
                    className="min-w-0 flex-1 rounded-l-xl px-3 py-2.5 text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-fire/40"
                  >
                    <span className="block truncate text-xs font-semibold text-ink">{element.name}</span>
                    <span className="block truncate text-[10px] text-ink-faint">
                      {element.type} · z{element.transform.zIndex}
                    </span>
                    {/* When this layer is on screen within the scene. It rides
                        the layer row rather than a timeline strip, because on a
                        phone that strip would come out of the artwork's share
                        of the screen. */}
                    <span className="mt-1.5 block h-1 overflow-hidden rounded-full bg-canvas-muted">
                      <span
                        style={{
                          marginLeft: `${((element.timing?.startMs ?? 0) / scene.durationMs) * 100}%`,
                          width: `${Math.max(
                            1,
                            (((element.timing?.endMs ?? scene.durationMs) - (element.timing?.startMs ?? 0)) /
                              scene.durationMs) *
                              100,
                          )}%`,
                        }}
                        className={cn("block h-full rounded-full", selected ? "bg-select" : "bg-ink-faint")}
                      />
                    </span>
                  </button>
                  <IconButton
                    label={element.hidden ? "Show layer" : "Hide layer"}
                    size="sm"
                    variant="subtle"
                    className="!bg-transparent"
                    onClick={() =>
                      onTransaction({
                        summary: element.hidden ? "Show layer" : "Hide layer",
                        operations: [{ type: "set_hidden", sceneId: scene.id, elementId: element.id, hidden: !element.hidden }],
                      })
                    }
                  >
                    {element.hidden ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                  </IconButton>
                  <IconButton
                    label={element.locked ? "Unlock layer" : "Lock layer"}
                    size="sm"
                    variant="subtle"
                    className="!bg-transparent"
                    onClick={() =>
                      onTransaction({
                        summary: element.locked ? "Unlock layer" : "Lock layer",
                        operations: [{ type: "set_locked", sceneId: scene.id, elementId: element.id, locked: !element.locked }],
                      })
                    }
                  >
                    {element.locked ? <Lock className="h-4 w-4" /> : <LockOpen className="h-4 w-4" />}
                  </IconButton>
                </div>

                {selected && (
                  <div className="flex gap-1.5 px-2 pb-2">
                    <Button
                      size="sm"
                      variant="ghost"
                      className="flex-1"
                      disabled={index >= scene.elements.length - 1}
                      onClick={() =>
                        onTransaction({
                          summary: "Move layer forward",
                          operations: [
                            {
                              type: "reorder_element",
                              sceneId: scene.id,
                              elementId: element.id,
                              toIndex: Math.min(scene.elements.length - 1, index + 1),
                            },
                          ],
                        })
                      }
                    >
                      <ChevronUp className="h-3.5 w-3.5" /> Forward
                    </Button>
                    <Button
                      size="sm"
                      variant="ghost"
                      className="flex-1"
                      disabled={index <= 0}
                      onClick={() =>
                        onTransaction({
                          summary: "Move layer backward",
                          operations: [
                            { type: "reorder_element", sceneId: scene.id, elementId: element.id, toIndex: Math.max(0, index - 1) },
                          ],
                        })
                      }
                    >
                      <ChevronDown className="h-3.5 w-3.5" /> Back
                    </Button>
                  </div>
                )}
              </li>
            );
          })}
        </ul>
      </Panel>

      <Panel
        title="Assets"
        bare={bare}
        actions={<span className="text-[10px] tabular-nums text-ink-faint">{assets.length}</span>}
      >
        <div className="-mx-1 mb-3 flex gap-1 overflow-x-auto px-1 pb-1">
          {SHELVES.map((item) => {
            const count = item.classes.length
              ? assets.filter((asset) => (item.classes as string[]).includes(asset.assetClass)).length
              : assets.length;
            return (
              <button
                key={item.id}
                type="button"
                onClick={() => setShelf(item.id)}
                aria-pressed={shelf === item.id}
                className={cn(
                  "shrink-0 rounded-full border px-2.5 py-1 text-[11px] font-semibold transition-colors",
                  "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-fire/40",
                  shelf === item.id
                    ? "border-fire/60 bg-fire-wash text-ink"
                    : "border-edge text-ink-muted hover:bg-canvas-subtle",
                )}
              >
                {item.label}
                <span className="ml-1 tabular-nums text-ink-faint">{count}</span>
              </button>
            );
          })}
        </div>

        {shelved.length === 0 ? (
          <div className="grid gap-2">
            <EmptyNote>
              {activeShelf.uploadAs
                ? `No ${activeShelf.label.toLowerCase()} yet. Upload one, or ask your assistant to make it.`
                : "Upload video, narration, music or images, or let your assistant generate them."}
            </EmptyNote>
          </div>
        ) : (
          <div className="grid max-h-80 grid-cols-3 gap-2 overflow-y-auto sm:grid-cols-2">
            {shelved.map((asset) => {
              const info = CREATIVE_ASSET_CLASSES[asset.assetClass as CreativeAssetClass];
              return (
                <div
                  key={asset.id}
                  className="group relative overflow-hidden rounded-xl border border-edge bg-canvas-subtle transition-colors hover:border-fire/50"
                >
                  <button
                    type="button"
                    onClick={() => addAsset(asset)}
                    title={
                      asset.kind === "audio"
                        ? `Add ${asset.filename || "audio"} to the timeline`
                        : `Add ${asset.filename || asset.kind} to the scene`
                    }
                    className="block w-full text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-fire/40"
                  >
                    <span className="grid aspect-square w-full place-items-center overflow-hidden bg-stage">
                      {asset.kind === "image" ? (
                        // eslint-disable-next-line @next/next/no-img-element
                        <img src={asset.url} alt="" loading="lazy" className="h-full w-full object-cover" />
                      ) : asset.kind === "video" ? (
                        <Video className="h-5 w-5 text-white/60" />
                      ) : (
                        <Music className="h-5 w-5 text-white/60" />
                      )}
                    </span>
                    <span className="block px-2 pt-1.5">
                      <span className="block truncate text-[10px] font-semibold uppercase tracking-[0.05em] text-fire">
                        {info?.label ?? asset.assetClass}
                      </span>
                      <span className="block truncate pb-1.5 text-[10px] text-ink-muted">
                        {asset.filename || asset.kind}
                        {asset.durationMs ? ` · ${(asset.durationMs / 1000).toFixed(1)}s` : ""}
                      </span>
                    </span>
                  </button>
                  <button
                    type="button"
                    onClick={() => onOpenAssetForm(asset, null)}
                    aria-label={`Edit class and notes for ${asset.filename || asset.kind}`}
                    title="Class and notes"
                    className={cn(
                      "absolute right-1.5 top-1.5 grid h-7 w-7 place-items-center rounded-lg bg-black/55 text-white",
                      "transition-opacity sm:opacity-0 sm:group-hover:opacity-100 focus-visible:opacity-100",
                      "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-fire/60",
                    )}
                  >
                    <Tag className="h-3.5 w-3.5" />
                  </button>
                </div>
              );
            })}
          </div>
        )}

        {activeShelf.uploadAs && (
          <Button
            variant="ghost"
            size="sm"
            className="mt-2 w-full"
            onClick={() => onOpenAssetForm(null, activeShelf.uploadAs ?? null)}
          >
            <Plus className="h-3.5 w-3.5" /> Upload {activeShelf.label.toLowerCase()}
          </Button>
        )}
      </Panel>

    </div>
  );
}
