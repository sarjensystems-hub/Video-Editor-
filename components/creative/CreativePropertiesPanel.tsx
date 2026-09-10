"use client";

import { Group, Sparkles, Trash2, Ungroup } from "lucide-react";
import { Button, IconButton } from "@/components/ui/Button";
import { NumberField, SelectField, TextAreaField } from "@/components/ui/Field";
import { EmptyNote, Panel } from "@/components/ui/Panel";
import {
  SCENE_TRANSITION_KINDS,
  type CreativeDocument,
  type CreativeElement,
  type CropRect,
  type SceneTransitionKind,
} from "@/lib/creative/schema";
import type { CreativeTransaction } from "@/lib/creative/transactions";

/** Turns `slide-left` into `Slide left` so the schema stays the single source. */
function transitionLabel(kind: SceneTransitionKind): string {
  const spaced = kind.replace(/-/g, " ");
  return spaced.charAt(0).toUpperCase() + spaced.slice(1);
}

export default function CreativePropertiesPanel({
  document: doc,
  sceneId,
  selectedIds,
  onTransaction,
  bare,
}: {
  document: CreativeDocument;
  sceneId: string;
  selectedIds: string[];
  onTransaction: (transaction: CreativeTransaction) => void;
  bare?: boolean;
}) {
  const scene = doc.scenes.find((item) => item.id === sceneId) ?? doc.scenes[0];
  const element = selectedIds.length === 1 ? scene.elements.find((item) => item.id === selectedIds[0]) : undefined;
  const group = element ? scene.groups.find((item) => item.elementIds.includes(element.id)) : undefined;

  const transformPatch = (patch: Partial<CreativeElement["transform"]>, summary: string) => {
    if (!element) return;
    onTransaction({
      summary,
      operations: [
        {
          type: "update_element",
          sceneId: scene.id,
          elementId: element.id,
          patch: { transform: { ...element.transform, ...patch } } as Partial<CreativeElement>,
        },
      ],
    });
  };

  const setCrop = (patch: Partial<CropRect>) => {
    if (!element || (element.type !== "image" && element.type !== "video")) return;
    const current = element.crop ?? { x: 0, y: 0, width: 1, height: 1 };
    onTransaction({
      summary: "Adjust media crop",
      operations: [
        {
          type: "update_element",
          sceneId: scene.id,
          elementId: element.id,
          patch: { crop: { ...current, ...patch } } as Partial<CreativeElement>,
        },
      ],
    });
  };

  const setTransition = (kind: SceneTransitionKind) => {
    const durationMs = kind === "cut" ? 0 : kind === "fade" ? 250 : 300;
    onTransaction({
      summary: "Change scene transition",
      operations: [
        {
          type: "set_transition",
          sceneId: scene.id,
          transition: { kind, durationMs, easing: kind === "cut" ? "linear" : "ease-in-out" },
        },
      ],
    });
  };

  return (
    <div className="grid content-start gap-4">
      <Panel title="Scene" bare={bare}>
        <div className="grid grid-cols-2 gap-2.5">
          <NumberField
            label="Duration ms"
            value={scene.durationMs}
            min={100}
            onCommit={(durationMs) =>
              onTransaction({
                summary: "Change scene duration",
                operations: [{ type: "update_scene", sceneId: scene.id, patch: { durationMs: Math.round(durationMs) } }],
              })
            }
          />
          <SelectField
            label="Transition out"
            value={scene.transitionOut?.kind ?? "cut"}
            onChange={(event) => setTransition(event.target.value as SceneTransitionKind)}
          >
            {SCENE_TRANSITION_KINDS.map((kind) => (
              <option key={kind} value={kind}>
                {transitionLabel(kind)}
              </option>
            ))}
          </SelectField>
        </div>
      </Panel>

      {!element && selectedIds.length < 2 && (
        <Panel title="Properties" bare={bare}>
          <EmptyNote>Select a layer on the stage, or pick one from Layers.</EmptyNote>
        </Panel>
      )}

      {selectedIds.length > 1 && (
        <Panel title="Multi-selection" bare={bare}>
          <p className="mb-3 text-xs text-ink-muted">{selectedIds.length} layers selected</p>
          <Button
            variant="primary"
            block
            onClick={() =>
              onTransaction({
                summary: "Group layers",
                operations: [
                  {
                    type: "create_group",
                    sceneId: scene.id,
                    group: { id: `group-${crypto.randomUUID().slice(0, 8)}`, name: "Group", elementIds: selectedIds },
                  },
                ],
              })
            }
          >
            <Group className="h-4 w-4" /> Group
          </Button>
        </Panel>
      )}

      {element && (
        <>
          <Panel
            title={element.type}
            bare={bare}
            actions={
              <IconButton
                label="Delete layer"
                size="sm"
                variant="danger"
                onClick={() =>
                  onTransaction({
                    summary: "Delete layer",
                    operations: [{ type: "remove_element", sceneId: scene.id, elementId: element.id }],
                  })
                }
              >
                <Trash2 className="h-4 w-4" />
              </IconButton>
            }
          >
            <p className="mb-3 truncate text-sm font-bold text-ink">{element.name}</p>

            {element.type === "text" && (
              <TextAreaField
                label="Text"
                key={`${element.id}-${element.text}`}
                defaultValue={element.text}
                rows={3}
                className="mb-3"
                onBlur={(event) => {
                  if (event.currentTarget.value !== element.text) {
                    onTransaction({
                      summary: "Edit text",
                      operations: [
                        { type: "set_text", sceneId: scene.id, elementId: element.id, text: event.currentTarget.value },
                      ],
                    });
                  }
                }}
              />
            )}

            <div className="grid grid-cols-2 gap-2.5">
              <NumberField label="X" value={element.transform.x} onCommit={(x) => transformPatch({ x }, "Move layer")} />
              <NumberField label="Y" value={element.transform.y} onCommit={(y) => transformPatch({ y }, "Move layer")} />
              <NumberField label="Width" value={element.transform.width} min={1} onCommit={(width) => transformPatch({ width }, "Resize layer")} />
              <NumberField label="Height" value={element.transform.height} min={1} onCommit={(height) => transformPatch({ height }, "Resize layer")} />
              <NumberField label="Rotation" value={element.transform.rotation} step={0.5} onCommit={(rotation) => transformPatch({ rotation }, "Rotate layer")} />
              <NumberField label="Opacity" value={element.transform.opacity} min={0} max={1} step={0.05} onCommit={(opacity) => transformPatch({ opacity }, "Change opacity")} />
            </div>
          </Panel>

          <Panel title="Timing" bare={bare}>
            <div className="grid grid-cols-2 gap-2.5">
              <NumberField
                label="Start ms"
                value={element.timing?.startMs ?? 0}
                min={0}
                max={scene.durationMs - 1}
                onCommit={(startMs) =>
                  onTransaction({
                    summary: "Change layer timing",
                    operations: [
                      {
                        type: "set_timing",
                        sceneId: scene.id,
                        elementId: element.id,
                        timing: { startMs: Math.round(startMs), endMs: element.timing?.endMs ?? scene.durationMs },
                      },
                    ],
                  })
                }
              />
              <NumberField
                label="End ms"
                value={element.timing?.endMs ?? scene.durationMs}
                min={1}
                max={scene.durationMs}
                onCommit={(endMs) =>
                  onTransaction({
                    summary: "Change layer timing",
                    operations: [
                      {
                        type: "set_timing",
                        sceneId: scene.id,
                        elementId: element.id,
                        timing: { startMs: element.timing?.startMs ?? 0, endMs: Math.round(endMs) },
                      },
                    ],
                  })
                }
              />
            </div>

            <div className="mt-3 grid gap-1.5">
              <span className="text-[10px] font-semibold uppercase tracking-[0.06em] text-ink-faint">Motion presets</span>
              <div className="flex flex-wrap gap-1.5">
                {Object.keys(doc.designSystem.motion.presets).map((preset) => (
                  <Button
                    key={preset}
                    size="sm"
                    variant="subtle"
                    onClick={() =>
                      onTransaction({
                        summary: `Apply ${preset}`,
                        operations: [
                          {
                            type: "apply_motion_preset",
                            sceneId: scene.id,
                            elementId: element.id,
                            presetName: preset,
                            startMs: element.timing?.startMs ?? 0,
                          },
                        ],
                      })
                    }
                  >
                    <Sparkles className="h-3.5 w-3.5" /> {preset}
                  </Button>
                ))}
              </div>
            </div>
          </Panel>

          {(element.type === "image" || element.type === "video") && (
            <Panel title="Crop" bare={bare}>
              <div className="grid grid-cols-2 gap-2.5">
                <NumberField label="Crop X" value={element.crop?.x ?? 0} min={0} max={1} step={0.01} onCommit={(x) => setCrop({ x })} />
                <NumberField label="Crop Y" value={element.crop?.y ?? 0} min={0} max={1} step={0.01} onCommit={(y) => setCrop({ y })} />
                <NumberField label="Crop W" value={element.crop?.width ?? 1} min={0.01} max={1} step={0.01} onCommit={(width) => setCrop({ width })} />
                <NumberField label="Crop H" value={element.crop?.height ?? 1} min={0.01} max={1} step={0.01} onCommit={(height) => setCrop({ height })} />
              </div>
            </Panel>
          )}

          {group && (
            <Panel title="Group" bare={bare}>
              <p className="mb-3 text-xs text-ink-muted">
                {group.name} · {group.elementIds.length} layers
              </p>
              <Button
                variant="ghost"
                block
                onClick={() =>
                  onTransaction({ summary: "Ungroup layers", operations: [{ type: "ungroup", sceneId: scene.id, groupId: group.id }] })
                }
              >
                <Ungroup className="h-4 w-4" /> Ungroup
              </Button>
            </Panel>
          )}
        </>
      )}
    </div>
  );
}
