"use client";

import { useEffect, useMemo, useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { Check, FileQuestion, Lock, Music, Trash2, Type } from "lucide-react";
import { deleteMediaFiles } from "@/app/actions/media";
import type { MediaItem, MediaType } from "@/lib/media-library";
import { Button, IconButton } from "@/components/ui/Button";
import Segmented from "@/components/ui/Segmented";
import { cn } from "@/components/ui/cn";

type Filter = "all" | "video" | "image" | "audio" | "unused";

const FILTERS: ReadonlyArray<{ value: Filter; label: string }> = [
  { value: "all", label: "All" },
  { value: "video", label: "Videos" },
  { value: "image", label: "Images" },
  { value: "audio", label: "Audio" },
  { value: "unused", label: "Unused" },
];

/** Cards rendered per step. Media loads only as it scrolls into view, but a
    thousand cards would still be a thousand nodes; this keeps the page light. */
const PAGE = 48;

function formatBytes(bytes: number): string {
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

function formatDate(ms: number): string {
  if (!ms) return "";
  return new Date(ms).toLocaleDateString(undefined, { day: "numeric", month: "short", year: "numeric" });
}

function describeUse(item: MediaItem): string {
  if (item.uses.length === 0) return "Not used by anything";
  const use = item.uses[0];
  const where = use.projectTitle ? ` · ${use.projectTitle}` : "";
  const more = item.uses.length > 1 ? ` +${item.uses.length - 1}` : "";
  return `${use.label}${where}${more}`;
}

export default function MediaGallery({ items }: { items: MediaItem[] }) {
  const router = useRouter();
  const [filter, setFilter] = useState<Filter>("all");
  const [shown, setShown] = useState(PAGE);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [confirming, setConfirming] = useState<string[] | null>(null);
  const [message, setMessage] = useState<{ tone: "ok" | "error"; text: string } | null>(null);
  const [pending, startTransition] = useTransition();

  const totals = useMemo(() => {
    const unused = items.filter((item) => item.uses.length === 0);
    return {
      size: items.reduce((sum, item) => sum + item.size, 0),
      unusedCount: unused.length,
      unusedSize: unused.reduce((sum, item) => sum + item.size, 0),
    };
  }, [items]);

  const visible = useMemo(
    () =>
      items.filter((item) => {
        if (filter === "all") return true;
        if (filter === "unused") return item.uses.length === 0;
        return item.type === filter;
      }),
    [items, filter],
  );

  // A file that vanished after a refresh cannot stay selected.
  useEffect(() => {
    const present = new Set(items.map((item) => item.path));
    setSelected((current) => new Set([...current].filter((path) => present.has(path))));
  }, [items]);

  const deletableShown = visible.filter((item) => item.placedIn.length === 0);
  const selectedItems = items.filter((item) => selected.has(item.path));
  const selectedSize = selectedItems.reduce((sum, item) => sum + item.size, 0);

  function toggle(path: string) {
    setSelected((current) => {
      const next = new Set(current);
      if (next.has(path)) next.delete(path);
      else next.add(path);
      return next;
    });
  }

  function runDelete(paths: string[]) {
    setMessage(null);
    startTransition(async () => {
      const result = await deleteMediaFiles(paths);
      setConfirming(null);
      if (!result.ok) {
        setMessage({ tone: "error", text: result.error });
        return;
      }
      setSelected((current) => new Set([...current].filter((path) => !paths.includes(path))));
      const parts = [`Deleted ${result.deleted} file${result.deleted === 1 ? "" : "s"}.`];
      if (result.failed > 0) parts.push(`${result.failed} could not be removed from storage; try again.`);
      if (result.blocked.length > 0) {
        const projects = [...new Set(result.blocked.flatMap((entry) => entry.projects))].join(", ");
        parts.push(`${result.blocked.length} kept because a project timeline uses ${result.blocked.length === 1 ? "it" : "them"} (${projects}).`);
      }
      setMessage({ tone: result.failed > 0 ? "error" : "ok", text: parts.join(" ") });
      router.refresh();
    });
  }

  const confirmingSize = confirming
    ? items.filter((item) => confirming.includes(item.path)).reduce((sum, item) => sum + item.size, 0)
    : 0;

  return (
    <div className="grid gap-4">
      <div className="grid grid-cols-3 gap-2 sm:gap-3">
        <Stat label="Files" value={String(items.length)} />
        <Stat label="Storage used" value={formatBytes(totals.size)} />
        <Stat
          label="Not used by anything"
          value={`${totals.unusedCount} · ${formatBytes(totals.unusedSize)}`}
          onClick={totals.unusedCount > 0 ? () => { setFilter("unused"); setShown(PAGE); } : undefined}
        />
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <Segmented
          label="Show"
          options={FILTERS}
          value={filter}
          onChange={(value) => { setFilter(value); setShown(PAGE); }}
          className="w-full sm:w-auto"
        />
        <div className="ml-auto flex items-center gap-2">
          {selected.size > 0 ? (
            <>
              <Button size="sm" variant="ghost" onClick={() => setSelected(new Set())} disabled={pending}>
                Clear
              </Button>
              <Button size="sm" variant="danger" onClick={() => setConfirming([...selected])} disabled={pending}>
                <Trash2 className="h-3.5 w-3.5" />
                Delete {selected.size} · {formatBytes(selectedSize)}
              </Button>
            </>
          ) : (
            deletableShown.length > 0 && (
              <Button
                size="sm"
                variant="ghost"
                onClick={() => setSelected(new Set(deletableShown.map((item) => item.path)))}
                disabled={pending}
              >
                Select all {deletableShown.length}
              </Button>
            )
          )}
        </div>
      </div>

      {confirming && (
        <div className="flex flex-wrap items-center gap-3 rounded-xl border border-danger/30 bg-danger-wash px-4 py-3">
          <p className="min-w-0 flex-1 text-sm text-danger">
            Permanently delete {confirming.length} file{confirming.length === 1 ? "" : "s"} ({formatBytes(confirmingSize)})?
            Renders and generated videos built from them disappear from their lists too. This cannot be undone.
          </p>
          <Button size="sm" variant="ghost" onClick={() => setConfirming(null)} disabled={pending}>
            Cancel
          </Button>
          <Button size="sm" variant="danger" onClick={() => runDelete(confirming)} disabled={pending}>
            {pending ? "Deleting…" : "Delete"}
          </Button>
        </div>
      )}

      {message && (
        <p
          className={cn(
            "rounded-xl px-4 py-3 text-sm",
            message.tone === "ok" ? "bg-canvas-subtle text-ink-muted" : "bg-danger-wash text-danger",
          )}
        >
          {message.text}
        </p>
      )}

      {visible.length === 0 ? (
        <p className="rounded-xl border border-dashed border-edge px-4 py-10 text-center text-sm text-ink-faint">
          {items.length === 0 ? "Your storage is empty." : "Nothing here."}
        </p>
      ) : (
        <ul className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4">
          {visible.slice(0, shown).map((item) => (
            <MediaCard
              key={item.path}
              item={item}
              selected={selected.has(item.path)}
              disabled={pending}
              onToggle={() => toggle(item.path)}
              onDelete={() => setConfirming([item.path])}
            />
          ))}
        </ul>
      )}

      {visible.length > shown && (
        <div className="flex justify-center">
          <Button variant="ghost" size="sm" onClick={() => setShown((count) => count + PAGE)}>
            Show more ({visible.length - shown} left)
          </Button>
        </div>
      )}
    </div>
  );
}

function Stat({ label, value, onClick }: { label: string; value: string; onClick?: () => void }) {
  const body = (
    <>
      <p className="text-[10px] font-bold uppercase tracking-[0.12em] text-ink-faint">{label}</p>
      <p className="mt-1 truncate text-sm font-semibold text-ink sm:text-base">{value}</p>
    </>
  );
  return onClick ? (
    <button type="button" onClick={onClick} className="card p-3 text-left transition-colors hover:border-fire sm:p-4">
      {body}
    </button>
  ) : (
    <div className="card p-3 sm:p-4">{body}</div>
  );
}

function MediaCard({
  item,
  selected,
  disabled,
  onToggle,
  onDelete,
}: {
  item: MediaItem;
  selected: boolean;
  disabled: boolean;
  onToggle: () => void;
  onDelete: () => void;
}) {
  const locked = item.placedIn.length > 0;
  return (
    <li className={cn("card flex min-w-0 flex-col overflow-hidden", selected && "ring-2 ring-fire")}>
      <div className="relative aspect-video bg-canvas-muted">
        <Preview item={item} />
        {!locked && (
          <button
            type="button"
            onClick={onToggle}
            aria-pressed={selected}
            aria-label={selected ? `Deselect ${item.name}` : `Select ${item.name}`}
            className={cn(
              "absolute left-2 top-2 grid h-6 w-6 place-items-center rounded-md border transition-colors",
              selected ? "border-fire bg-fire text-white" : "border-white/70 bg-black/40 text-transparent hover:text-white/70",
            )}
          >
            <Check className="h-4 w-4" />
          </button>
        )}
      </div>
      <div className="flex min-w-0 flex-1 items-start gap-2 p-3">
        <div className="min-w-0 flex-1">
          <a href={item.url} target="_blank" rel="noreferrer" className="block truncate text-sm font-medium text-ink hover:text-fire" title={item.name}>
            {item.name}
          </a>
          <p className="mt-0.5 truncate text-xs text-ink-faint">
            {formatBytes(item.size)} · {formatDate(item.modifiedMs)}
          </p>
          {locked ? (
            <p className="mt-1 truncate text-xs text-ink-muted" title={`On the timeline of ${item.placedIn.map((p) => p.title).join(", ")}`}>
              On timeline:{" "}
              {item.placedIn.map((project, index) => (
                <span key={project.id}>
                  {index > 0 && ", "}
                  <Link href={`/dashboard/creative-studio/${project.id}`} className="text-fire hover:underline">
                    {project.title}
                  </Link>
                </span>
              ))}
            </p>
          ) : (
            <p className={cn("mt-1 truncate text-xs", item.uses.length === 0 ? "text-fire" : "text-ink-muted")}>
              {describeUse(item)}
            </p>
          )}
        </div>
        {locked ? (
          <span
            className="grid h-8 w-8 shrink-0 place-items-center text-ink-faint"
            title="Remove it from the project's timeline before deleting it"
          >
            <Lock className="h-3.5 w-3.5" />
          </span>
        ) : (
          <IconButton
            label={`Delete ${item.name}`}
            size="sm"
            variant="ghost"
            className="!border-transparent !text-danger"
            disabled={disabled}
            onClick={onDelete}
          >
            <Trash2 className="h-3.5 w-3.5" />
          </IconButton>
        )}
      </div>
    </li>
  );
}

const ICONS: Partial<Record<MediaType, React.ElementType>> = { audio: Music, font: Type, other: FileQuestion };

function Preview({ item }: { item: MediaItem }) {
  if (item.type === "image") {
    // eslint-disable-next-line @next/next/no-img-element
    return <img src={item.url} alt={item.name} loading="lazy" decoding="async" className="h-full w-full object-cover" />;
  }
  if (item.type === "video") return <LazyVideo src={item.url} />;
  const Icon = ICONS[item.type] ?? FileQuestion;
  return (
    <div className="flex h-full w-full flex-col items-center justify-center gap-2 px-3">
      <Icon className="h-7 w-7 text-ink-faint" />
      {item.type === "audio" && (
        // preload="none": nothing is fetched until play is pressed.
        <audio src={item.url} controls preload="none" className="h-8 w-full" />
      )}
    </div>
  );
}

/**
 * A video that fetches nothing until it scrolls near the viewport, and then
 * only enough to show its first frame. The whole file streams on play.
 */
function LazyVideo({ src }: { src: string }) {
  const ref = useRef<HTMLVideoElement>(null);
  const [near, setNear] = useState(false);

  useEffect(() => {
    const element = ref.current;
    if (!element || near) return;
    const observer = new IntersectionObserver(
      (entries) => {
        if (entries.some((entry) => entry.isIntersecting)) {
          setNear(true);
          observer.disconnect();
        }
      },
      { rootMargin: "200px" },
    );
    observer.observe(element);
    return () => observer.disconnect();
  }, [near]);

  return (
    <video
      ref={ref}
      src={near ? `${src}#t=0.1` : undefined}
      preload={near ? "metadata" : "none"}
      controls={near}
      muted
      playsInline
      className="h-full w-full bg-black object-contain"
    />
  );
}
