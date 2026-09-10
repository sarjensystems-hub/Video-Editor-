"use client";

import {
  ChevronDown,
  ChevronUp,
  Eye,
  EyeOff,
  ImagePlus,
  Lock,
  LockOpen,
  Music,
  Square,
  Type,
  Video,
} from "lucide-react";
import { Button, IconButton } from "@/components/ui/Button";
import { EmptyNote, Panel } from "@/components/ui/Panel";
import { cn } from "@/components/ui/cn";
import { createDefaultTransform } from "@/lib/creative/defaults";
import type { CreativeDocument } from "@/lib/creative/schema";
import type { CreativeTransaction } from "@/lib/creative/transactions";

export interface EditorAsset {
  id: string;
  kind: string;
  url: string;
  filename?: string | null;
  mimeType?: string | null;
}

export default function CreativeLayersPanel({
  document: doc,
  sceneId,
  selectedIds,
  assets,
  onSelect,
  onTransaction,
  onUpload,
  bare,
}: {
  document: CreativeDocument;
  sceneId: string;
  selectedIds: string[];
  assets: EditorAsset[];
  onSelect: (ids: string[]) => void;
  onTransaction: (transaction: CreativeTransaction) => void;
  onUpload: (file: File) => void;
  /** Set inside a bottom sheet, where the surrounding surface is the sheet. */
  bare?: boolean;
}) {
  const scene = doc.scenes.find((item) => item.id === sceneId) ?? doc.scenes[0];
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

  const addAsset = (asset: EditorAsset) => {
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
        <div className="grid grid-cols-3 gap-2">
          <Button variant="subtle" size="sm" onClick={addText} className="flex-col gap-1 !h-auto py-2.5">
            <Type className="h-4 w-4" /> Text
          </Button>
          <Button variant="subtle" size="sm" onClick={addShape} className="flex-col gap-1 !h-auto py-2.5">
            <Square className="h-4 w-4" /> Shape
          </Button>
          <label
            className={cn(
              "inline-flex cursor-pointer flex-col items-center justify-center gap-1 rounded-lg py-2.5",
              "border border-transparent bg-canvas-subtle text-xs font-semibold text-ink-muted",
              "transition-colors hover:bg-canvas-muted hover:text-ink",
              "focus-within:ring-2 focus-within:ring-fire/40",
            )}
          >
            <ImagePlus className="h-4 w-4" /> Upload
            <input
              type="file"
              accept="image/*,video/*,audio/*"
              hidden
              onChange={(event) => {
                const file = event.target.files?.[0];
                if (file) onUpload(file);
                event.currentTarget.value = "";
              }}
            />
          </label>
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
        {assets.length === 0 ? (
          <EmptyNote>Upload an image or video, or let your assistant generate one.</EmptyNote>
        ) : (
          <div className="grid max-h-72 grid-cols-3 gap-2 overflow-y-auto sm:grid-cols-2">
            {assets.map((asset) => (
              <button
                key={asset.id}
                type="button"
                onClick={() => addAsset(asset)}
                title={`Add ${asset.filename || asset.kind} to the scene`}
                className={cn(
                  "group overflow-hidden rounded-xl border border-edge bg-canvas-subtle text-left",
                  "transition-colors hover:border-fire/50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-fire/40",
                )}
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
                <span className="block truncate px-2 py-1.5 text-[10px] text-ink-muted">
                  {asset.filename || asset.kind}
                </span>
              </button>
            ))}
          </div>
        )}
      </Panel>
    </div>
  );
}
