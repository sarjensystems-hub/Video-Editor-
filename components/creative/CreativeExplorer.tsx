"use client";

import { useEffect, useMemo, useState, useTransition } from "react";
import type { DragEvent, KeyboardEvent as ReactKeyboardEvent, MouseEvent as ReactMouseEvent } from "react";
import { useRouter } from "next/navigation";
import { ChevronRight, Clapperboard, Folder, FolderPlus, LayoutGrid, List, Pencil, Trash2 } from "lucide-react";
import {
  createCreativeFolder,
  deleteCreativeFolder,
  deleteCreativeProject,
  moveCreativeProjectToFolder,
  renameCreativeFolder,
  renameCreativeProject,
} from "@/app/actions/creative-studio";
import { IconButton } from "@/components/ui/Button";
import { cn } from "@/components/ui/cn";

export interface ExplorerFolder {
  id: string;
  name: string;
}

export interface ExplorerProject {
  id: string;
  title: string;
  status: string;
  folder_id: string | null;
  updated_at: string | null;
  size_bytes: number | null;
}

const STATUS_ICON_TONE: Record<string, string> = {
  ready: "text-success",
  rendering: "text-warning",
  failed: "text-danger",
};

function statusIconTone(status: string): string {
  return STATUS_ICON_TONE[status] ?? "text-ink-faint";
}

function formatBytes(bytes: number | null): string {
  if (bytes == null) return "—";
  if (bytes < 1024) return `${bytes} B`;
  const units = ["KB", "MB", "GB"];
  let value = bytes / 1024;
  let unitIndex = 0;
  while (value >= 1024 && unitIndex < units.length - 1) {
    value /= 1024;
    unitIndex += 1;
  }
  return `${value.toFixed(value >= 10 ? 0 : 1)} ${units[unitIndex]}`;
}

function formatDate(iso: string | null): string {
  if (!iso) return "—";
  return new Date(iso).toLocaleDateString(undefined, { month: "short", day: "numeric" });
}

/** Fires `action` on Enter/Space, the keyboard equivalent of a click on a role="button" container. */
function activationKeyDown(action: () => void) {
  return (event: ReactKeyboardEvent) => {
    if (event.key !== "Enter" && event.key !== " ") return;
    event.preventDefault();
    action();
  };
}

type SortKey = "name" | "size";
type SortDir = "asc" | "desc";
type Renaming = { kind: "folder" | "project"; id: string; value: string };
type ViewMode = "details" | "tiles";
type ContextTargetInput = { kind: "folder"; folder: ExplorerFolder } | { kind: "project"; project: ExplorerProject };
// An intersection distributes over the union per-branch, unlike Omit<ContextTarget, "x" | "y">,
// which would collapse to the fields the two branches share (just `kind`) and lose `folder`/`project`.
type ContextTarget = ContextTargetInput & { x: number; y: number };

/** Drop target ids besides real folder ids — dropping here files a project back to root. */
const ROOT_DROP_TARGET = "__root__";

const VIEW_MODE_STORAGE_KEY = "creative-studio-view-mode";

/** Rough menu footprint used to keep the context menu on screen. */
const MENU_WIDTH = 200;
const MENU_MAX_HEIGHT = 320;

/**
 * The Explorer-style view of Creative Studio: OneDrive/Windows-like — one
 * flat list mixing subfolders (root only; folders don't nest) and projects,
 * sortable by name or size, draggable into folders, right-clickable for a
 * rename/move/delete menu, switchable between Details (a sortable table)
 * and Tiles (a large-icon grid). Every row/tile is one clickable unit -
 * opening it doesn't depend on hitting the name text - since deleting now
 * lives only in the right-click menu and there is nothing else inside a row
 * that needs its own click target.
 *
 * Folder navigation is entirely client-side: every folder and project loads
 * once up front, and clicking into a folder just changes which of them are
 * shown. Earlier this went through the URL (`?folder=<id>`), which meant a
 * full server round trip - a fresh Supabase auth check and two queries - on
 * every click. That round trip is what "opening a folder takes forever" was:
 * this app's Vercel functions run in iad1 (US East) and its Supabase project
 * lives in ap-southeast-2 (Australia), so each of those was a cross-Pacific
 * hop. Only opening a *project* still navigates - that's a real route (the
 * editor), not a filter, and needs the server regardless.
 */
export default function CreativeExplorer({
  folders,
  projects,
  initialFolderId,
}: {
  folders: ExplorerFolder[];
  /** Every project regardless of folder — filtering to the current one happens client-side. */
  projects: ExplorerProject[];
  initialFolderId: string | null;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [view, setView] = useState<ViewMode>("details");
  const [currentFolderId, setCurrentFolderId] = useState<string | null>(initialFolderId);
  const [sort, setSort] = useState<{ key: SortKey; dir: SortDir }>({ key: "name", dir: "asc" });
  const [renaming, setRenaming] = useState<Renaming | null>(null);
  const [dragOverId, setDragOverId] = useState<string | null>(null);
  const [menu, setMenu] = useState<ContextTarget | null>(null);

  useEffect(() => {
    try {
      const stored = window.localStorage.getItem(VIEW_MODE_STORAGE_KEY);
      if (stored === "details" || stored === "tiles") setView(stored);
    } catch {
      // Per-viewer convenience only; a blocked or absent localStorage just keeps the default.
    }
  }, []);

  // Cosmetic only — plain History API, not the Next.js router, so a bookmark
  // or refresh lands back in the right folder without ever re-fetching from
  // the server on the clicks that got here.
  useEffect(() => {
    const url = new URL(window.location.href);
    if (currentFolderId) url.searchParams.set("folder", currentFolderId);
    else url.searchParams.delete("folder");
    window.history.replaceState(null, "", url);
  }, [currentFolderId]);

  function setViewMode(next: ViewMode) {
    setView(next);
    try {
      window.localStorage.setItem(VIEW_MODE_STORAGE_KEY, next);
    } catch {
      // Same as above — nothing to recover from, nothing to break.
    }
  }

  const currentFolder = currentFolderId ? folders.find((entry) => entry.id === currentFolderId) ?? null : null;
  const showFolders = !currentFolderId;

  const sortedFolders = useMemo(() => [...folders].sort((a, b) => a.name.localeCompare(b.name)), [folders]);

  const visibleProjects = useMemo(
    () => projects.filter((project) => (project.folder_id ?? null) === currentFolderId),
    [projects, currentFolderId],
  );

  const sortedProjects = useMemo(() => {
    const dir = sort.dir === "asc" ? 1 : -1;
    return [...visibleProjects].sort((a, b) => {
      if (sort.key === "size") return ((a.size_bytes ?? -1) - (b.size_bytes ?? -1)) * dir;
      return a.title.localeCompare(b.title) * dir;
    });
  }, [visibleProjects, sort]);

  function toggleSort(key: SortKey) {
    setSort((current) => (current.key === key ? { key, dir: current.dir === "asc" ? "desc" : "asc" } : { key, dir: "asc" }));
  }

  // Opening is a no-op while that same row is mid-rename, so a stray click on
  // the row's padding (outside the input) can't navigate out from under it.
  function openFolder(folder: ExplorerFolder) {
    if (renaming?.kind === "folder" && renaming.id === folder.id) return;
    setCurrentFolderId(folder.id);
  }

  function openProject(project: ExplorerProject) {
    if (renaming?.kind === "project" && renaming.id === project.id) return;
    router.push(`/dashboard/creative-studio/${project.id}`);
  }

  function commitRename() {
    if (!renaming) return;
    const { kind, id, value } = renaming;
    const trimmed = value.trim();
    setRenaming(null);
    if (!trimmed) return;
    startTransition(async () => {
      const result = kind === "folder" ? await renameCreativeFolder(id, trimmed) : await renameCreativeProject(id, trimmed);
      if (!result.ok) window.alert(result.error);
    });
  }

  function handleCreateFolder() {
    const name = window.prompt("Folder name")?.trim();
    if (!name) return;
    startTransition(async () => {
      const result = await createCreativeFolder(name);
      if (!result.ok) window.alert(result.error);
    });
  }

  function handleDeleteFolder(folder: ExplorerFolder) {
    if (!window.confirm(`Delete the folder "${folder.name}"? Its projects are kept and become unfiled.`)) return;
    startTransition(async () => {
      const result = await deleteCreativeFolder(folder.id);
      if (!result.ok) window.alert(result.error);
    });
  }

  function handleDeleteProject(project: ExplorerProject) {
    if (
      !window.confirm(
        `Delete "${project.title}"? This permanently removes the project and its render history. Generated assets are kept.`,
      )
    ) {
      return;
    }
    startTransition(async () => {
      const result = await deleteCreativeProject(project.id);
      if (!result.ok) window.alert(result.error);
    });
  }

  function moveProject(projectId: string, folderId: string | null) {
    startTransition(async () => {
      const result = await moveCreativeProjectToFolder(projectId, folderId);
      if (!result.ok) window.alert(result.error);
    });
  }

  function handleDrop(event: DragEvent<HTMLElement>, folderId: string | null) {
    event.preventDefault();
    setDragOverId(null);
    const projectId = event.dataTransfer.getData("text/creative-project-id");
    if (projectId) moveProject(projectId, folderId);
  }

  function openContextMenu(event: ReactMouseEvent, target: ContextTargetInput) {
    event.preventDefault();
    event.stopPropagation();
    const x = Math.min(event.clientX, window.innerWidth - MENU_WIDTH - 8);
    const y = Math.min(event.clientY, window.innerHeight - MENU_MAX_HEIGHT - 8);
    setMenu({ ...target, x: Math.max(8, x), y: Math.max(8, y) });
  }

  function renameInput(kind: "folder" | "project", id: string, value: string, className: string) {
    return (
      <input
        autoFocus
        value={value}
        onChange={(event) => setRenaming({ kind, id, value: event.target.value })}
        onBlur={commitRename}
        onKeyDown={(event) => {
          // Without this, Enter/Space here would also bubble to the row's
          // own activationKeyDown and try to open the row mid-edit.
          event.stopPropagation();
          if (event.key === "Enter") commitRename();
          if (event.key === "Escape") setRenaming(null);
        }}
        onClick={(event) => event.stopPropagation()}
        className={className}
      />
    );
  }

  const empty = sortedFolders.length === 0 && sortedProjects.length === 0;

  return (
    <div>
      <div className="mb-3 flex flex-wrap items-center gap-1.5 text-xs font-semibold text-ink-muted">
        <button
          type="button"
          onClick={() => setCurrentFolderId(null)}
          onDragOver={(event) => {
            if (!currentFolder) return;
            event.preventDefault();
            setDragOverId(ROOT_DROP_TARGET);
          }}
          onDragLeave={() => setDragOverId((id) => (id === ROOT_DROP_TARGET ? null : id))}
          onDrop={(event) => currentFolder && handleDrop(event, null)}
          className={cn(
            "rounded-md px-1.5 py-0.5 transition-colors hover:text-ink",
            !currentFolder && "text-ink",
            dragOverId === ROOT_DROP_TARGET && "bg-fire-wash text-fire",
          )}
        >
          Creative Studio
        </button>
        {currentFolder && (
          <>
            <ChevronRight className="h-3.5 w-3.5 text-ink-faint" />
            <span className="text-ink">{currentFolder.name}</span>
            <IconButton
              label="Rename folder"
              size="sm"
              variant="ghost"
              className="!h-7 !w-7 !border-transparent"
              disabled={pending}
              onClick={() => setRenaming({ kind: "folder", id: currentFolder.id, value: currentFolder.name })}
            >
              <Pencil className="h-3.5 w-3.5" />
            </IconButton>
            <IconButton
              label="Delete folder"
              size="sm"
              variant="ghost"
              className="!h-7 !w-7 !border-transparent !text-danger"
              disabled={pending}
              onClick={() => handleDeleteFolder(currentFolder)}
            >
              <Trash2 className="h-3.5 w-3.5" />
            </IconButton>
          </>
        )}
        <IconButton
          label="New folder"
          size="sm"
          variant="ghost"
          className="!ml-1 !h-7 !w-7 !border-transparent"
          disabled={pending}
          onClick={handleCreateFolder}
        >
          <FolderPlus className="h-4 w-4" />
        </IconButton>

        {/* Tiles has no columns to click, so sorting moves here instead of staying column-header-only. */}
        {view === "tiles" && (
          <>
            <span className="mx-0.5 h-4 w-px bg-edge" />
            <button
              type="button"
              onClick={() => toggleSort("name")}
              className={cn("rounded-md px-1.5 py-0.5 hover:text-ink", sort.key === "name" && "text-ink")}
            >
              Name {sort.key === "name" && (sort.dir === "asc" ? "▲" : "▼")}
            </button>
            <button
              type="button"
              onClick={() => toggleSort("size")}
              className={cn("rounded-md px-1.5 py-0.5 hover:text-ink", sort.key === "size" && "text-ink")}
            >
              Size {sort.key === "size" && (sort.dir === "asc" ? "▲" : "▼")}
            </button>
          </>
        )}

        <span className="ml-auto flex items-center gap-0.5 rounded-lg border border-edge p-0.5">
          <IconButton
            label="Details view"
            size="sm"
            variant={view === "details" ? "subtle" : "ghost"}
            className={cn("!h-7 !w-7", view !== "details" && "!border-transparent")}
            onClick={() => setViewMode("details")}
          >
            <List className="h-4 w-4" />
          </IconButton>
          <IconButton
            label="Tiles view"
            size="sm"
            variant={view === "tiles" ? "subtle" : "ghost"}
            className={cn("!h-7 !w-7", view !== "tiles" && "!border-transparent")}
            onClick={() => setViewMode("tiles")}
          >
            <LayoutGrid className="h-4 w-4" />
          </IconButton>
        </span>
      </div>

      {view === "details" && (
        <div className="mb-1 hidden items-center gap-3 px-3 pb-2 text-[10px] font-bold uppercase tracking-[0.06em] text-ink-faint sm:flex">
          <span className="w-5 shrink-0" />
          <button type="button" onClick={() => toggleSort("name")} className="flex-1 text-left hover:text-ink">
            Name {sort.key === "name" && (sort.dir === "asc" ? "▲" : "▼")}
          </button>
          <span className="w-14 shrink-0">Modified</span>
          <button type="button" onClick={() => toggleSort("size")} className="w-14 shrink-0 text-left hover:text-ink">
            Size {sort.key === "size" && (sort.dir === "asc" ? "▲" : "▼")}
          </button>
        </div>
      )}

      {empty ? (
        <div className="grid place-items-center gap-2 rounded-2xl border border-edge bg-panel py-10 text-center">
          <Clapperboard className="h-6 w-6 text-ink-faint" />
          <p className="text-sm font-semibold text-ink">{currentFolder ? "Nothing in this folder" : "No projects yet"}</p>
          <p className="max-w-sm px-4 text-xs leading-relaxed text-ink-muted">
            {currentFolder
              ? "Drag a project here from the root, or right-click one to move it."
              : "Create one above, or ask your connected assistant to make one — it will appear here either way."}
          </p>
        </div>
      ) : view === "details" ? (
        <ul className="divide-y divide-edge-faint rounded-2xl border border-edge bg-panel">
          {showFolders &&
            sortedFolders.map((folder) => (
              <li
                key={folder.id}
                role="button"
                tabIndex={0}
                onClick={() => openFolder(folder)}
                onKeyDown={activationKeyDown(() => openFolder(folder))}
                onContextMenu={(event) => openContextMenu(event, { kind: "folder", folder })}
                onDragOver={(event) => {
                  event.preventDefault();
                  setDragOverId(folder.id);
                }}
                onDragLeave={() => setDragOverId((id) => (id === folder.id ? null : id))}
                onDrop={(event) => handleDrop(event, folder.id)}
                className={cn(
                  "flex cursor-pointer items-center gap-3 px-3 py-2.5 transition-colors",
                  dragOverId === folder.id ? "bg-fire-wash" : "hover:bg-canvas-subtle",
                )}
              >
                <Folder className="h-5 w-5 shrink-0 fill-fire/20 text-fire" />
                {renaming?.kind === "folder" && renaming.id === folder.id ? (
                  renameInput(
                    "folder",
                    folder.id,
                    renaming.value,
                    "min-w-0 flex-1 rounded-md border border-fire/50 bg-canvas px-1.5 py-0.5 text-sm font-semibold text-ink outline-none",
                  )
                ) : (
                  <span className="min-w-0 flex-1 truncate text-sm font-semibold text-ink">{folder.name}</span>
                )}
                <span className="hidden w-14 shrink-0 sm:block" />
                <span className="hidden w-14 shrink-0 sm:block" />
              </li>
            ))}

          {sortedProjects.map((project) => (
            <li
              key={project.id}
              role="button"
              tabIndex={0}
              draggable
              onClick={() => openProject(project)}
              onKeyDown={activationKeyDown(() => openProject(project))}
              onDragStart={(event) => event.dataTransfer.setData("text/creative-project-id", project.id)}
              onContextMenu={(event) => openContextMenu(event, { kind: "project", project })}
              className="flex cursor-pointer items-center gap-3 px-3 py-2.5 transition-colors hover:bg-canvas-subtle"
            >
              <Clapperboard className={cn("h-5 w-5 shrink-0", statusIconTone(project.status))} />
              {renaming?.kind === "project" && renaming.id === project.id ? (
                renameInput(
                  "project",
                  project.id,
                  renaming.value,
                  "min-w-0 flex-1 rounded-md border border-fire/50 bg-canvas px-1.5 py-0.5 text-sm font-semibold text-ink outline-none",
                )
              ) : (
                <span className="min-w-0 flex-1 truncate text-sm font-semibold text-ink">{project.title}</span>
              )}
              <span className="hidden w-14 shrink-0 text-xs text-ink-faint sm:block">{formatDate(project.updated_at)}</span>
              <span className="hidden w-14 shrink-0 text-xs text-ink-faint sm:block">{formatBytes(project.size_bytes)}</span>
            </li>
          ))}
        </ul>
      ) : (
        <div className="grid grid-cols-[repeat(auto-fill,minmax(6.5rem,1fr))] gap-2 sm:grid-cols-[repeat(auto-fill,minmax(7.5rem,1fr))] sm:gap-3">
          {showFolders &&
            sortedFolders.map((folder) => (
              <div
                key={folder.id}
                role="button"
                tabIndex={0}
                onClick={() => openFolder(folder)}
                onKeyDown={activationKeyDown(() => openFolder(folder))}
                onContextMenu={(event) => openContextMenu(event, { kind: "folder", folder })}
                onDragOver={(event) => {
                  event.preventDefault();
                  setDragOverId(folder.id);
                }}
                onDragLeave={() => setDragOverId((id) => (id === folder.id ? null : id))}
                onDrop={(event) => handleDrop(event, folder.id)}
                className={cn(
                  "flex cursor-pointer flex-col items-center gap-1.5 rounded-xl border border-transparent px-2 py-3 text-center transition-colors",
                  dragOverId === folder.id ? "border-fire/50 bg-fire-wash" : "hover:border-edge hover:bg-canvas-subtle",
                )}
              >
                <Folder className="h-10 w-10 shrink-0 fill-fire/20 text-fire" />
                {renaming?.kind === "folder" && renaming.id === folder.id ? (
                  renameInput(
                    "folder",
                    folder.id,
                    renaming.value,
                    "w-full rounded-md border border-fire/50 bg-canvas px-1 py-0.5 text-center text-xs font-semibold text-ink outline-none",
                  )
                ) : (
                  <span className="line-clamp-2 w-full text-xs font-semibold text-ink">{folder.name}</span>
                )}
              </div>
            ))}

          {sortedProjects.map((project) => (
            <div
              key={project.id}
              role="button"
              tabIndex={0}
              draggable
              onClick={() => openProject(project)}
              onKeyDown={activationKeyDown(() => openProject(project))}
              onDragStart={(event) => event.dataTransfer.setData("text/creative-project-id", project.id)}
              onContextMenu={(event) => openContextMenu(event, { kind: "project", project })}
              className="flex cursor-pointer flex-col items-center gap-1.5 rounded-xl border border-transparent px-2 py-3 text-center transition-colors hover:border-edge hover:bg-canvas-subtle"
            >
              <Clapperboard className={cn("h-10 w-10 shrink-0", statusIconTone(project.status))} />
              {renaming?.kind === "project" && renaming.id === project.id ? (
                renameInput(
                  "project",
                  project.id,
                  renaming.value,
                  "w-full rounded-md border border-fire/50 bg-canvas px-1 py-0.5 text-center text-xs font-semibold text-ink outline-none",
                )
              ) : (
                <span className="line-clamp-2 w-full text-xs font-semibold text-ink">{project.title}</span>
              )}
            </div>
          ))}
        </div>
      )}

      {menu && (
        <>
          {/* Full-screen invisible backdrop: closes the menu on any outside click without a document-level listener to manage. */}
          <div className="fixed inset-0 z-40" onClick={() => setMenu(null)} onContextMenu={(event) => { event.preventDefault(); setMenu(null); }} />
          <div
            role="menu"
            style={{ left: menu.x, top: menu.y, width: MENU_WIDTH }}
            className="fixed z-50 max-h-80 overflow-y-auto rounded-xl border border-edge bg-panel py-1.5 shadow-lg"
          >
            {menu.kind === "folder" ? (
              <>
                <MenuItem
                  onClick={() => {
                    setMenu(null);
                    openFolder(menu.folder);
                  }}
                >
                  Open
                </MenuItem>
                <MenuItem
                  onClick={() => {
                    setRenaming({ kind: "folder", id: menu.folder.id, value: menu.folder.name });
                    setMenu(null);
                  }}
                >
                  Rename
                </MenuItem>
                <MenuItem
                  danger
                  onClick={() => {
                    setMenu(null);
                    handleDeleteFolder(menu.folder);
                  }}
                >
                  Delete
                </MenuItem>
              </>
            ) : (
              <>
                <MenuItem
                  onClick={() => {
                    setMenu(null);
                    openProject(menu.project);
                  }}
                >
                  Open
                </MenuItem>
                <MenuItem
                  onClick={() => {
                    setRenaming({ kind: "project", id: menu.project.id, value: menu.project.title });
                    setMenu(null);
                  }}
                >
                  Rename
                </MenuItem>
                {folders.length > 0 && (
                  <>
                    <div className="my-1 border-t border-edge-faint" />
                    <p className="px-3 py-1 text-[10px] font-bold uppercase tracking-[0.06em] text-ink-faint">Move to</p>
                    {menu.project.folder_id && (
                      <MenuItem
                        onClick={() => {
                          setMenu(null);
                          moveProject(menu.project.id, null);
                        }}
                      >
                        No folder
                      </MenuItem>
                    )}
                    {folders
                      .filter((folder) => folder.id !== menu.project.folder_id)
                      .map((folder) => (
                        <MenuItem
                          key={folder.id}
                          onClick={() => {
                            setMenu(null);
                            moveProject(menu.project.id, folder.id);
                          }}
                        >
                          {folder.name}
                        </MenuItem>
                      ))}
                    <div className="my-1 border-t border-edge-faint" />
                  </>
                )}
                <MenuItem
                  danger
                  onClick={() => {
                    setMenu(null);
                    handleDeleteProject(menu.project);
                  }}
                >
                  Delete
                </MenuItem>
              </>
            )}
          </div>
        </>
      )}
    </div>
  );
}

function MenuItem({ onClick, danger, children }: { onClick: () => void; danger?: boolean; children: string }) {
  return (
    <button
      type="button"
      role="menuitem"
      onClick={onClick}
      className={cn(
        "block w-full truncate px-3 py-2 text-left text-sm font-medium transition-colors hover:bg-canvas-subtle",
        danger ? "text-danger" : "text-ink",
      )}
    >
      {children}
    </button>
  );
}
