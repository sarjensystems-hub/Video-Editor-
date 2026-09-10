"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { ReactNode } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import {
  Check,
  ChevronLeft,
  Film,
  History,
  Layers,
  PanelLeft,
  PanelRight,
  Pause,
  Play,
  Plus,
  Redo2,
  RotateCcw,
  Save,
  Sliders,
  Sparkles,
  Trash2,
} from "lucide-react";
import { Button, IconButton } from "@/components/ui/Button";
import Sheet from "@/components/ui/Sheet";
import { EmptyNote, Panel } from "@/components/ui/Panel";
import { cn } from "@/components/ui/cn";
import { useIsDesktop } from "@/components/ui/media";
import { deleteCreativeProject, saveCreativeProject } from "@/app/actions/creative-studio";
import { createDefaultTransform } from "@/lib/creative/defaults";
import type { CreativeDocument } from "@/lib/creative/schema";
import {
  applyEditorTransaction,
  createCreativeEditorState,
  markEditorSaved,
  redoEditor,
  setEditorSelection,
  undoEditor,
} from "@/lib/creative/editor-state";
import type { CreativeTransaction } from "@/lib/creative/transactions";
import CreativeAutomationPanel from "./CreativeAutomationPanel";
import CreativeEditorCanvas from "./CreativeEditorCanvas";
import CreativeLayersPanel, { type EditorAsset } from "./CreativeLayersPanel";
import CreativePropertiesPanel from "./CreativePropertiesPanel";
import CreativeRenderPanel from "./CreativeRenderPanel";

export interface EditorRevision {
  id: string;
  sequence: number;
  summary: string;
}

/** Panels that arrive as an overlay rather than living in a docked rail. */
type OverlayName = "layers" | "properties" | "produce" | "export" | "revisions";

const OVERLAY_TITLES: Record<OverlayName, string> = {
  layers: "Layers & assets",
  properties: "Properties",
  produce: "AI production",
  export: "Export",
  revisions: "Revision history",
};

function formatTime(ms: number): string {
  const total = Math.max(0, ms) / 1000;
  const minutes = Math.floor(total / 60);
  const seconds = total - minutes * 60;
  return `${minutes}:${seconds.toFixed(1).padStart(4, "0")}`;
}

export default function CreativeEditor({
  projectId,
  title,
  documentVersion,
  initialDocument,
  initialAssets,
  revisions,
}: {
  projectId: string;
  title: string;
  documentVersion: number;
  initialDocument: CreativeDocument;
  initialAssets: EditorAsset[];
  revisions: EditorRevision[];
}) {
  const [state, setState] = useState(() => createCreativeEditorState(initialDocument));
  const [assets, setAssets] = useState(initialAssets);
  const [timeMs, setTimeMs] = useState(0);
  const [playing, setPlaying] = useState(false);
  const [busy, setBusy] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const router = useRouter();
  const [overlay, setOverlay] = useState<OverlayName | null>(null);
  const [railsOpen, setRailsOpen] = useState({ left: true, right: true });
  const startedAt = useRef<number | null>(null);
  const startedFrom = useRef(0);
  const isDesktop = useIsDesktop();

  const scene =
    state.document.scenes.find((item) => item.id === state.selection.sceneId) ?? state.document.scenes[0];
  const sceneIndex = Math.max(0, state.document.scenes.findIndex((item) => item.id === scene.id));

  const previewAssets = useMemo(
    () =>
      Object.fromEntries(
        assets.map((asset) => [asset.id, { id: asset.id, url: asset.url, mimeType: asset.mimeType ?? null }]),
      ),
    [assets],
  );

  useEffect(() => {
    if (!playing) {
      startedAt.current = null;
      return;
    }
    let frame = 0;
    const tick = (now: number) => {
      if (startedAt.current == null) startedAt.current = now;
      const next = startedFrom.current + (now - startedAt.current);
      if (next >= scene.durationMs) {
        setTimeMs(Math.max(0, scene.durationMs - 1));
        setPlaying(false);
        return;
      }
      setTimeMs(next);
      frame = requestAnimationFrame(tick);
    };
    frame = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(frame);
  }, [playing, scene.durationMs]);

  useEffect(() => {
    if (timeMs >= scene.durationMs) setTimeMs(Math.max(0, scene.durationMs - 1));
  }, [scene.durationMs, timeMs]);

  // Layers and properties are docked rails on a wide screen; leaving their
  // overlays open across a resize would show the same panel twice.
  useEffect(() => {
    if (isDesktop && (overlay === "layers" || overlay === "properties")) setOverlay(null);
  }, [isDesktop, overlay]);

  const transact = useCallback((transaction: CreativeTransaction) => {
    setState((current) => applyEditorTransaction(current, transaction));
    setNotice(null);
  }, []);

  const select = useCallback((elementIds: string[]) => {
    setState((current) => setEditorSelection(current, { sceneId: current.selection.sceneId, elementIds }));
  }, []);

  const setScene = useCallback((sceneId: string) => {
    setPlaying(false);
    startedFrom.current = 0;
    setTimeMs(0);
    setState((current) => setEditorSelection(current, { sceneId, elementIds: [] }));
  }, []);

  const save = async () => {
    setBusy(true);
    setNotice(null);
    const result = await saveCreativeProject(projectId, state.document, state.lastSummary || "Saved from Creative Studio");
    setBusy(false);
    if (!result.ok) {
      setNotice(result.error);
      return;
    }
    setState((current) => markEditorSaved(current));
    setNotice(`Saved revision ${result.data.sequence}`);
  };

  const deleteProject = async () => {
    if (
      !window.confirm(
        `Delete "${title}"? This permanently removes the project and its render history. Generated assets are kept.`,
      )
    ) {
      return;
    }
    setDeleting(true);
    const result = await deleteCreativeProject(projectId);
    if (!result.ok) {
      setDeleting(false);
      setNotice(result.error);
      return;
    }
    router.push("/dashboard/creative-studio");
  };

  const appendAssets = useCallback((next: EditorAsset[]) => {
    setAssets((current) => {
      const byId = new Map(current.map((asset) => [asset.id, asset]));
      for (const asset of next) byId.set(asset.id, asset);
      return [...byId.values()];
    });
  }, []);

  const upload = useCallback(
    async (file: File) => {
      setBusy(true);
      setNotice(null);
      try {
        const form = new FormData();
        form.set("projectId", projectId);
        form.set("file", file);
        const response = await fetch("/api/creative/assets/upload", { method: "POST", body: form });
        const payload = await response.json();
        if (!response.ok) throw new Error(payload.error ?? "Asset upload failed");
        const asset = payload.asset;
        appendAssets([
          {
            id: asset.id,
            kind: asset.kind,
            url: asset.url,
            filename: asset.filename ?? null,
            mimeType: asset.mime_type ?? null,
          },
        ]);
        setNotice(`${asset.filename || asset.kind} uploaded`);
      } catch (error) {
        setNotice(error instanceof Error ? error.message : String(error));
      } finally {
        setBusy(false);
      }
    },
    [projectId, appendAssets],
  );

  const togglePlay = () => {
    if (!playing) {
      if (timeMs >= scene.durationMs - 1) setTimeMs(0);
      startedFrom.current = timeMs >= scene.durationMs - 1 ? 0 : timeMs;
      startedAt.current = null;
    }
    setPlaying((value) => !value);
  };

  const scrub = useCallback((next: number) => {
    setPlaying(false);
    startedFrom.current = next;
    setTimeMs(next);
  }, []);

  const addScene = () => {
    const nextNumber = state.document.scenes.length + 1;
    const id = `scene-${crypto.randomUUID().slice(0, 8)}`;
    transact({
      summary: "Add scene",
      operations: [
        {
          type: "add_scene",
          scene: {
            id,
            name: `Scene ${nextNumber}`,
            durationMs: 3000,
            elements: [
              {
                id: `scene-title-${crypto.randomUUID().slice(0, 8)}`,
                name: "Scene title",
                type: "text",
                text: `SCENE ${nextNumber}`,
                style: { token: "heading" },
                transform: createDefaultTransform({
                  x: 90,
                  y: 520,
                  width: Math.max(100, state.document.canvas.width - 180),
                  height: 160,
                  anchorX: 0,
                  anchorY: 0,
                  zIndex: 2,
                }),
              },
            ],
            groups: [],
          },
        },
      ],
    });
    setScene(id);
  };

  const insertDecomposition = (asset: EditorAsset, box: { x: number; y: number; width: number; height: number }) => {
    const id = `decomposed-${crypto.randomUUID().slice(0, 8)}`;
    transact({
      summary: "Insert decomposed crop",
      operations: [
        {
          type: "add_element",
          sceneId: scene.id,
          element: {
            id,
            name: asset.filename || "Decomposed crop",
            type: "image",
            assetId: asset.id,
            fit: "contain",
            transform: createDefaultTransform({
              x: Math.round(box.x * state.document.canvas.width),
              y: Math.round(box.y * state.document.canvas.height),
              width: Math.max(1, Math.round(box.width * state.document.canvas.width)),
              height: Math.max(1, Math.round(box.height * state.document.canvas.height)),
              anchorX: 0,
              anchorY: 0,
              zIndex: scene.elements.length + 2,
            }),
          },
        },
      ],
    });
    select([id]);
  };

  const layersPanel = (bare: boolean) => (
    <CreativeLayersPanel
      document={state.document}
      sceneId={scene.id}
      selectedIds={state.selection.elementIds}
      assets={assets}
      onSelect={select}
      onTransaction={transact}
      onUpload={upload}
      bare={bare}
    />
  );

  const propertiesPanel = (bare: boolean) => (
    <CreativePropertiesPanel
      document={state.document}
      sceneId={scene.id}
      selectedIds={state.selection.elementIds}
      onTransaction={transact}
      bare={bare}
    />
  );

  const status = state.lastError ?? notice;
  const statusIsError = Boolean(state.lastError) || (notice != null && /failed|error/i.test(notice));

  return (
    // `fixed inset-0` rather than a tall page: the editor owns the viewport, so
    // nothing scrolls behind it and the stage can be measured against the glass.
    <div className="fixed inset-0 flex flex-col overflow-hidden bg-canvas">
      {/* ── Top bar ── */}
      <header className="flex h-[52px] shrink-0 items-center gap-2 border-b border-edge bg-panel px-2 sm:px-3">
        <Link
          href="/dashboard/creative-studio"
          aria-label="Back to Creative Studio"
          className="grid h-9 w-9 shrink-0 place-items-center rounded-lg text-ink-muted transition-colors hover:bg-canvas-subtle hover:text-ink"
        >
          <ChevronLeft className="h-5 w-5" />
        </Link>
        <IconButton
          label="Delete project"
          size="sm"
          variant="ghost"
          className="!border-transparent !text-danger"
          disabled={deleting}
          onClick={deleteProject}
        >
          <Trash2 className="h-4 w-4" />
        </IconButton>

        <div className="min-w-0 flex-1">
          <h1 className="truncate text-sm font-bold leading-tight text-ink">{title}</h1>
          <p className="hidden text-[10px] leading-tight text-ink-faint sm:block">
            CreativeDocument v{documentVersion} · {state.document.canvas.width}&#215;{state.document.canvas.height}
          </p>
        </div>

        <div className="flex shrink-0 items-center gap-1">
          <IconButton label="Undo" size="sm" variant="ghost" className="!border-transparent" disabled={state.past.length === 0} onClick={() => setState(undoEditor)}>
            <Redo2 className="h-4 w-4 -scale-x-100" />
          </IconButton>
          <IconButton label="Redo" size="sm" variant="ghost" className="!border-transparent" disabled={state.future.length === 0} onClick={() => setState(redoEditor)}>
            <Redo2 className="h-4 w-4" />
          </IconButton>

          {isDesktop && (
            <>
              <span className="mx-1 h-5 w-px bg-edge" />
              <IconButton
                label={railsOpen.left ? "Hide layers" : "Show layers"}
                size="sm"
                variant={railsOpen.left ? "subtle" : "ghost"}
                className={cn(!railsOpen.left && "!border-transparent")}
                onClick={() => setRailsOpen((r) => ({ ...r, left: !r.left }))}
              >
                <PanelLeft className="h-4 w-4" />
              </IconButton>
              <IconButton
                label={railsOpen.right ? "Hide properties" : "Show properties"}
                size="sm"
                variant={railsOpen.right ? "subtle" : "ghost"}
                className={cn(!railsOpen.right && "!border-transparent")}
                onClick={() => setRailsOpen((r) => ({ ...r, right: !r.right }))}
              >
                <PanelRight className="h-4 w-4" />
              </IconButton>
              <span className="mx-1 h-5 w-px bg-edge" />
              <IconButton label="AI production" size="sm" variant="ghost" className="!border-transparent" onClick={() => setOverlay("produce")}>
                <Sparkles className="h-4 w-4" />
              </IconButton>
              <IconButton label="Revision history" size="sm" variant="ghost" className="!border-transparent" onClick={() => setOverlay("revisions")}>
                <History className="h-4 w-4" />
              </IconButton>
              <Button variant="ghost" size="sm" onClick={() => setOverlay("export")}>
                <Film className="h-3.5 w-3.5" /> Export
              </Button>
            </>
          )}

          {state.dirty && <span className="ml-1 hidden text-[11px] font-semibold text-warning lg:inline">Unsaved</span>}
          <Button
            variant={state.dirty ? "primary" : "subtle"}
            size="sm"
            className="ml-1"
            disabled={busy || !state.dirty}
            onClick={save}
          >
            {state.dirty ? <Save className="h-3.5 w-3.5" /> : <Check className="h-3.5 w-3.5" />}
            {busy ? "Saving" : state.dirty ? "Save" : "Saved"}
          </Button>
        </div>
      </header>

      {status && (
        <p
          className={cn(
            "shrink-0 px-3 py-1.5 text-center text-xs",
            statusIsError ? "bg-danger-wash text-danger" : "bg-success-wash text-success",
          )}
        >
          {status}
        </p>
      )}

      {/* ── The room: rails flank a stage that runs to the edges ── */}
      <div className="flex min-h-0 flex-1">
        {isDesktop && railsOpen.left && (
          <aside className="w-[248px] shrink-0 overflow-y-auto border-r border-edge bg-panel p-3">
            {layersPanel(true)}
          </aside>
        )}

        <div className="relative min-w-0 flex-1">
          <CreativeEditorCanvas
            document={state.document}
            sceneId={scene.id}
            timeMs={timeMs}
            assets={previewAssets}
            selectedIds={state.selection.elementIds}
            onSelect={select}
            onTransaction={transact}
            className="absolute inset-0"
          />
        </div>

        {isDesktop && railsOpen.right && (
          <aside className="w-[296px] shrink-0 overflow-y-auto border-l border-edge bg-panel p-3">
            {propertiesPanel(true)}
          </aside>
        )}
      </div>

      {/* ── Transport ── */}
      <div className="flex h-12 shrink-0 items-center gap-2 border-t border-edge bg-panel px-2 sm:px-3">
        <IconButton label={playing ? "Pause" : "Play"} size="sm" variant="ghost" className="!border-transparent" onClick={togglePlay}>
          {playing ? <Pause className="h-4 w-4" /> : <Play className="h-4 w-4" />}
        </IconButton>
        <IconButton
          label="Restart"
          size="sm"
          variant="ghost"
          className="!border-transparent"
          onClick={() => {
            setPlaying(false);
            startedFrom.current = 0;
            setTimeMs(0);
          }}
        >
          <RotateCcw className="h-4 w-4" />
        </IconButton>
        <input
          type="range"
          aria-label="Scene time"
          min={0}
          max={Math.max(1, scene.durationMs - 1)}
          value={Math.min(Math.round(timeMs), scene.durationMs - 1)}
          onChange={(event) => scrub(Number(event.currentTarget.value))}
          className="scrubber min-w-0 flex-1"
        />
        <span className="shrink-0 text-[11px] font-semibold tabular-nums text-ink-muted">
          {formatTime(timeMs)} / {formatTime(scene.durationMs)}
        </span>
      </div>

      {/* ── Scenes ── */}
      <div className="flex h-14 shrink-0 items-center gap-1.5 border-t border-edge bg-panel px-2 sm:px-3">
        <div className="flex min-w-0 flex-1 gap-1.5 overflow-x-auto">
          {state.document.scenes.map((item, index) => {
            const active = item.id === scene.id;
            return (
              <button
                key={item.id}
                type="button"
                onClick={() => setScene(item.id)}
                className={cn(
                  "shrink-0 rounded-lg border px-2.5 py-1.5 text-left transition-colors",
                  "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-fire/40",
                  active
                    ? "border-fire/50 bg-fire-wash text-ink"
                    : "border-edge bg-canvas-subtle text-ink-muted hover:text-ink",
                )}
              >
                <span className="block whitespace-nowrap text-[11px] font-bold leading-tight">
                  {index + 1}. {item.name}
                </span>
                <span className="block text-[10px] leading-tight tabular-nums opacity-70">
                  {(item.durationMs / 1000).toFixed(1)}s
                </span>
              </button>
            );
          })}
        </div>
        <IconButton label="Add scene" size="sm" variant="ghost" className="!border-transparent" onClick={addScene}>
          <Plus className="h-4 w-4" />
        </IconButton>
        {state.document.scenes.length > 1 && (
          <IconButton
            label="Delete scene"
            size="sm"
            variant="ghost"
            className="!border-transparent !text-danger"
            onClick={() => {
              const fallback = state.document.scenes[sceneIndex === 0 ? 1 : sceneIndex - 1];
              transact({ summary: "Delete scene", operations: [{ type: "remove_scene", sceneId: scene.id }] });
              setScene(fallback.id);
            }}
          >
            <Trash2 className="h-4 w-4" />
          </IconButton>
        )}
      </div>

      {/* ── Phone tool bar ── */}
      {!isDesktop && (
        <nav
          aria-label="Editor panels"
          className="flex shrink-0 items-center gap-1 border-t border-edge bg-panel px-2 pb-[max(0.25rem,env(safe-area-inset-bottom))] pt-1"
        >
          <ToolTab icon={<Layers className="h-4 w-4" />} label="Layers" active={overlay === "layers"} onClick={() => setOverlay("layers")} />
          <ToolTab
            icon={<Sliders className="h-4 w-4" />}
            label="Properties"
            active={overlay === "properties"}
            badge={state.selection.elementIds.length || undefined}
            onClick={() => setOverlay("properties")}
          />
          <ToolTab icon={<Sparkles className="h-4 w-4" />} label="Produce" active={overlay === "produce"} onClick={() => setOverlay("produce")} />
          <ToolTab icon={<History className="h-4 w-4" />} label="History" active={overlay === "revisions"} onClick={() => setOverlay("revisions")} />
          <ToolTab icon={<Film className="h-4 w-4" />} label="Export" active={overlay === "export"} onClick={() => setOverlay("export")} />
        </nav>
      )}

      <Sheet open={overlay !== null} onClose={() => setOverlay(null)} title={overlay ? OVERLAY_TITLES[overlay] : ""}>
        {overlay === "layers" && layersPanel(true)}
        {overlay === "properties" && propertiesPanel(true)}
        {overlay === "produce" && (
          <CreativeAutomationPanel
            projectId={projectId}
            document={state.document}
            assets={assets}
            bare
            onDocumentReplace={(document) => {
              setPlaying(false);
              setTimeMs(0);
              setState(createCreativeEditorState(document));
              setNotice("Server revision loaded into the editor.");
            }}
            onAssetsAppend={appendAssets}
            onInsertDecomposition={insertDecomposition}
          />
        )}
        {overlay === "export" && (
          <CreativeRenderPanel
            projectId={projectId}
            scenes={state.document.scenes.map((item) => ({
              id: item.id,
              name: item.name,
              durationMs: item.durationMs,
            }))}
            bare
          />
        )}
        {overlay === "revisions" && (
          <Panel bare>
            {revisions.length === 0 ? (
              <EmptyNote>No revisions yet. Every saved edit creates one.</EmptyNote>
            ) : (
              <ul className="divide-y divide-edge-faint">
                {revisions.map((revision) => (
                  <li key={revision.id} className="flex items-center justify-between gap-3 py-2.5 first:pt-0">
                    <span className="min-w-0 truncate text-xs text-ink-muted">{revision.summary}</span>
                    <span className="shrink-0 text-[11px] tabular-nums text-ink-faint">v{revision.sequence}</span>
                  </li>
                ))}
              </ul>
            )}
          </Panel>
        )}
      </Sheet>
    </div>
  );
}

function ToolTab({
  icon,
  label,
  active,
  badge,
  onClick,
}: {
  icon: ReactNode;
  label: string;
  active: boolean;
  badge?: number;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={active}
      aria-label={badge ? `${label}, ${badge} selected` : label}
      className={cn(
        "relative flex min-h-11 flex-1 flex-col items-center justify-center gap-0.5 rounded-lg text-[9px] font-semibold",
        "transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-fire/40",
        active ? "bg-fire-wash text-fire" : "text-ink-muted",
      )}
    >
      {icon}
      {label}
      {badge ? (
        <span
          aria-hidden="true"
          className="absolute right-1.5 top-0.5 grid h-3.5 min-w-3.5 place-items-center rounded-full bg-select px-1 text-[8px] tabular-nums text-select-ink"
        >
          {badge}
        </span>
      ) : null}
    </button>
  );
}
