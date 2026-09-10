"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { Download, Loader2, Play } from "lucide-react";
import { Button } from "@/components/ui/Button";
import { Panel } from "@/components/ui/Panel";
import Segmented from "@/components/ui/Segmented";
import { cn } from "@/components/ui/cn";

type RenderJob = {
  id: string;
  status: string;
  progress?: number | null;
  output_url?: string | null;
  content_type?: string | null;
  size_bytes?: number | null;
  error?: string | null;
  metadata?: { phase?: string; scene_id?: string | null } | null;
  created_at?: string | null;
  finished_at?: string | null;
};

const POLL_INTERVAL_MS = 4000;

const PHASE_LABELS: Record<string, string> = {
  "restoring-renderer": "Starting renderer",
  "opening-browser": "Opening renderer",
  "selecting-composition": "Loading composition",
  rendering: "Rendering frames",
  uploading: "Uploading MP4",
  completed: "Finishing",
};

/**
 * Reads a response body that is only *supposed* to be JSON.
 *
 * A gateway timeout or an edge error returns an HTML page, and calling
 * `.json()` on that throws a parser error with no bearing on what went wrong —
 * which is how a render timeout used to surface as "The string did not match
 * the expected pattern".
 */
async function readJson(response: Response): Promise<{ data: Record<string, unknown> | null; raw: string }> {
  const raw = await response.text();
  try {
    return { data: JSON.parse(raw) as Record<string, unknown>, raw };
  } catch {
    return { data: null, raw };
  }
}

function describeFailure(response: Response, data: Record<string, unknown> | null, raw: string): string {
  if (data && typeof data.error === "string") return data.error;
  const snippet = raw.replace(/<[^>]*>/g, " ").replace(/\s+/g, " ").trim().slice(0, 160);
  return snippet
    ? `Render request failed (HTTP ${response.status}): ${snippet}`
    : `Render request failed (HTTP ${response.status})`;
}

export interface ExportScene {
  id: string;
  name: string;
  durationMs: number;
}

type ExportScope = "film" | "clip";

export default function CreativeRenderPanel({
  projectId,
  scenes,
  bare,
}: {
  projectId: string;
  scenes: ExportScene[];
  bare?: boolean;
}) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [job, setJob] = useState<RenderJob | null>(null);
  const [jobId, setJobId] = useState<string | null>(null);
  const [scope, setScope] = useState<ExportScope>("film");
  const [selectedSceneId, setSelectedSceneId] = useState<string | null>(scenes[0]?.id ?? null);
  const [history, setHistory] = useState<RenderJob[]>([]);
  const [historyLoaded, setHistoryLoaded] = useState(false);
  // The export finished during this visit, so it is worth pointing at. A row
  // that was already there when the sheet opened is just history.
  const [freshId, setFreshId] = useState<string | null>(null);
  // Survives unmount so a poll that lands late cannot revive a stale render.
  const activeJobId = useRef<string | null>(null);

  const start = useCallback(async () => {
    setBusy(true);
    setError(null);
    setJob(null);
    setJobId(null);
    activeJobId.current = null;
    try {
      const response = await fetch("/api/creative/render", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ projectId, sceneId: scope === "clip" ? selectedSceneId : undefined }),
      });
      const { data, raw } = await readJson(response);
      if (!response.ok || !data) throw new Error(describeFailure(response, data, raw));
      const started = data.job as RenderJob | undefined;
      if (!started?.id) throw new Error("Render started but returned no job id");
      activeJobId.current = started.id;
      setJob(started);
      setJobId(started.id);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
      setBusy(false);
    }
  }, [projectId, scope, selectedSceneId, scenes]);

  const loadHistory = useCallback(async () => {
    try {
      const response = await fetch(`/api/creative/render?projectId=${encodeURIComponent(projectId)}`, {
        cache: "no-store",
      });
      const { data } = await readJson(response);
      if (!response.ok || !data) return;
      setHistory((data.jobs as RenderJob[]) ?? []);
    } catch {
      // History is a convenience; failing to load it must not break exporting.
    } finally {
      setHistoryLoaded(true);
    }
  }, [projectId]);

  useEffect(() => {
    void loadHistory();
  }, [loadHistory]);

  // A render outlives the component: closing the sheet, reloading the page or
  // navigating away does not stop it, but it did reset jobId to null, so the
  // button came back as "Render film" while the previous export was still
  // going - inviting a second, invisible, concurrent render of the same
  // project rather than reporting anything wrong. Once history is in, resume
  // tracking whatever it says is still running instead of assuming a clean
  // slate.
  useEffect(() => {
    if (jobId || !historyLoaded) return;
    const active = history.find((entry) => entry.status === "queued" || entry.status === "rendering");
    if (!active) return;
    activeJobId.current = active.id;
    setJob(active);
    setJobId(active.id);
    setBusy(true);
  }, [history, historyLoaded, jobId]);

  // The render outlives the request that started it, so progress comes from
  // polling the job row rather than from a connection held open for minutes.
  useEffect(() => {
    if (!jobId) return;
    let cancelled = false;

    const poll = async () => {
      try {
        const response = await fetch(`/api/creative/render/${jobId}`, { cache: "no-store" });
        const { data, raw } = await readJson(response);
        if (cancelled || activeJobId.current !== jobId) return;
        if (!response.ok || !data) throw new Error(describeFailure(response, data, raw));
        const next = data.job as RenderJob;
        setJob(next);
        if (next.status === "completed") {
          setBusy(false);
          setJobId(null);
          setFreshId(next.id);
          void loadHistory();
        } else if (next.status === "failed") {
          void loadHistory();
          setError(next.error ?? "Render failed");
          setBusy(false);
          setJobId(null);
        }
      } catch (err) {
        if (cancelled || activeJobId.current !== jobId) return;
        // A single failed poll is a network blip, not a failed render; the next
        // tick retries, and a genuinely dead job comes back as failed.
        console.warn("Render poll failed", err);
      }
    };

    void poll();
    const timer = setInterval(poll, POLL_INTERVAL_MS);
    return () => {
      cancelled = true;
      clearInterval(timer);
    };
  }, [jobId, loadHistory]);

  // A clip export with nothing chosen would render the whole film by omission,
  // which is the one outcome the scope switch exists to prevent.
  const canStart = scope === "film" || Boolean(selectedSceneId);
  const progress = Math.min(1, Math.max(0, Number(job?.progress ?? 0)));
  const phase = job?.metadata?.phase;
  const phaseLabel = (phase && PHASE_LABELS[phase]) ?? "Rendering";

  return (
    <Panel
      // Inside a sheet the title is already on the sheet"s own header;
      // repeating it puts the same word on screen twice.
      title={bare ? undefined : "Export"}
      bare={bare}
      actions={
        <Button variant="primary" size="sm" disabled={busy || !canStart} onClick={start}>
          {busy ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Play className="h-3.5 w-3.5" />}
          {busy ? "Rendering" : scope === "film" ? "Render film" : "Render clip"}
        </Button>
      }
    >
      <Segmented
        className="mb-3"
        label="Export scope"
        value={scope}
        onChange={(next) => setScope(next)}
        options={[
          { value: "film", label: "Whole film" },
          { value: "clip", label: "Single clip" },
        ]}
      />

      {scope === "film" ? (
        <p className="text-xs leading-relaxed text-ink-faint">
          Renders every scene through the deterministic Remotion engine, transitions included, and
          stores the result durably.
        </p>
      ) : (
        <>
          <p className="mb-2 text-xs leading-relaxed text-ink-faint">
            Renders one scene as its own MP4, starting at zero. The scene keeps the project&apos;s
            canvas and design system, drops its outgoing transition, and carries only the audio that
            sounds during it.
          </p>
          <ul className="grid max-h-56 gap-1.5 overflow-y-auto">
            {scenes.map((scene, index) => {
              const active = scene.id === selectedSceneId;
              return (
                <li key={scene.id}>
                  <button
                    type="button"
                    onClick={() => setSelectedSceneId(scene.id)}
                    aria-pressed={active}
                    className={cn(
                      "flex min-h-11 w-full items-center justify-between gap-3 rounded-xl border px-3 text-left transition-colors",
                      "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-fire/40",
                      active
                        ? "border-fire/50 bg-fire-wash text-ink"
                        : "border-edge bg-canvas-subtle text-ink-muted hover:text-ink",
                    )}
                  >
                    <span className="min-w-0 truncate text-xs font-semibold">
                      {index + 1}. {scene.name}
                    </span>
                    <span className="shrink-0 text-[11px] tabular-nums opacity-70">
                      {(scene.durationMs / 1000).toFixed(1)}s
                    </span>
                  </button>
                </li>
              );
            })}
          </ul>
        </>
      )}

      {busy && (
        <div className="mt-3">
          <div className="mb-1.5 flex items-center justify-between text-[11px] text-ink-muted">
            <span>{phaseLabel}</span>
            <span className="tabular-nums">{Math.round(progress * 100)}%</span>
          </div>
          <div className="h-1.5 overflow-hidden rounded-full bg-canvas-muted">
            <div
              style={{ width: `${Math.max(2, progress * 100)}%` }}
              className="h-full rounded-full bg-fire transition-[width] duration-500 ease-out"
            />
          </div>
          <p className="mt-2 text-[11px] text-ink-faint">
            A minute of 1080&#215;1920 footage takes a few minutes. You can leave this page.
          </p>
        </div>
      )}

      {error && (
        <p className="mt-3 rounded-lg bg-danger-wash px-3 py-2 text-xs leading-relaxed text-danger">{error}</p>
      )}

      <section className="mt-4 border-t border-edge-faint pt-3">
        <div className="mb-2 flex items-center justify-between gap-2">
          <h3 className="text-[11px] font-bold uppercase tracking-[0.08em] text-ink-faint">Export history</h3>
          {history.length > 0 && (
            <span className="text-[10px] tabular-nums text-ink-faint">{history.length}</span>
          )}
        </div>

        {!historyLoaded ? (
          <p className="text-xs text-ink-faint">Loading&hellip;</p>
        ) : history.length === 0 ? (
          <p className="text-xs leading-relaxed text-ink-faint">
            Nothing exported yet. Finished renders are kept here with a link to the file.
          </p>
        ) : (
          <ul className="grid gap-1.5">
            {history.map((entry) => {
              const done = entry.status === "completed" && Boolean(entry.output_url);
              const running = entry.status === "queued" || entry.status === "rendering";
              return (
                <li
                  key={entry.id}
                  className={cn(
                    "flex items-center justify-between gap-3 rounded-xl border px-3 py-2",
                    entry.id === freshId ? "border-success/40 bg-success-wash" : "border-edge bg-canvas-subtle",
                  )}
                >
                  <span className="min-w-0">
                    <span className="block truncate text-xs font-semibold text-ink">
                      {describeScope(entry, scenes)}
                    </span>
                    <span className="block truncate text-[10px] text-ink-faint">
                      {formatWhen(entry.finished_at ?? entry.created_at)}
                      {done && entry.size_bytes ? ` · ${(entry.size_bytes / 1024 / 1024).toFixed(1)} MB` : ""}
                    </span>
                  </span>

                  {done ? (
                    <span className="flex shrink-0 items-center gap-1.5">
                      <a
                        href={entry.output_url ?? "#"}
                        target="_blank"
                        rel="noreferrer"
                        aria-label={`Watch ${describeScope(entry, scenes)}`}
                        className="inline-flex h-9 items-center gap-1.5 rounded-lg border border-edge px-3 text-xs font-bold text-ink-muted transition-colors hover:border-fire/50 hover:text-ink focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-fire/40"
                      >
                        <Play className="h-3.5 w-3.5" /> Watch
                      </a>
                      {/* Points at our own origin, not the storage URL: the
                          download attribute is ignored cross-origin, so a
                          direct link would open the video instead of saving
                          it. The route re-serves it as an attachment. */}
                      <a
                        href={`/api/creative/render/${encodeURIComponent(entry.id)}/download`}
                        aria-label={`Download ${describeScope(entry, scenes)}`}
                        className="inline-flex h-9 items-center gap-1.5 rounded-lg bg-fire px-3 text-xs font-bold text-white transition-colors hover:bg-fire-hover focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-fire/40"
                      >
                        <Download className="h-3.5 w-3.5" /> Download
                      </a>
                    </span>
                  ) : (
                    <span
                      className={cn(
                        "shrink-0 rounded-full px-2 py-0.5 text-[10px] font-bold",
                        running ? "bg-warning-wash text-warning" : "bg-danger-wash text-danger",
                      )}
                      title={entry.error ?? undefined}
                    >
                      {running ? `${Math.round(Number(entry.progress ?? 0) * 100)}%` : "Failed"}
                    </span>
                  )}
                </li>
              );
            })}
          </ul>
        )}
      </section>
    </Panel>
  );
}

/** Whether this export was the whole film or one clip, named where possible. */
function describeScope(entry: RenderJob, scenes: ExportScene[]): string {
  const sceneId = entry.metadata?.scene_id;
  if (!sceneId) return "Whole film";
  const index = scenes.findIndex((scene) => scene.id === sceneId);
  // A clip whose scene has since been deleted still deserves an honest label
  // rather than a stale name or a raw id.
  if (index < 0) return "Clip · removed scene";
  return `Clip · ${index + 1}. ${scenes[index].name}`;
}

function formatWhen(value: string | null | undefined): string {
  if (!value) return "";
  const then = Date.parse(value);
  if (Number.isNaN(then)) return "";
  const minutes = Math.round((Date.now() - then) / 60_000);
  if (minutes < 1) return "just now";
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  return new Date(then).toLocaleDateString(undefined, { day: "numeric", month: "short" });
}
