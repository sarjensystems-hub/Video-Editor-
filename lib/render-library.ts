/**
 * The Renders page: every finished MP4 the user has exported, newest first.
 *
 * It reads the render rows, not storage, because a render's worth is in what
 * the row knows - which project, how long, what size - and the Media page
 * already covers "everything in storage". Deleting stays on the Media page,
 * which removes the stored file along with the row.
 */

export interface RenderRow {
  id: string;
  project_id: string;
  output_url: string | null;
  size_bytes: number | null;
  metadata: Record<string, unknown> | null;
  finished_at: string | null;
  created_at: string;
}

export interface RenderTile {
  id: string;
  projectId: string;
  projectTitle: string;
  /** Same-origin `/media/…` path, so playback and download go through this deployment. */
  url: string;
  downloadUrl: string;
  finishedAt: string;
  sizeBytes: number | null;
  durationMs: number | null;
  width: number | null;
  height: number | null;
  /** Set when only part of the film was rendered, e.g. "0:12-0:30". */
  range: string | null;
}

function numberOrNull(value: unknown): number | null {
  const number = typeof value === "number" ? value : typeof value === "string" ? Number(value) : NaN;
  return Number.isFinite(number) && number >= 0 ? number : null;
}

/** `/media/<path>` from a stored URL written on any of the app's domains. */
export function sameOriginMediaPath(url: string): string {
  try {
    const parsed = new URL(url, "https://app.invalid");
    return parsed.pathname.startsWith("/media/") ? parsed.pathname : url;
  } catch {
    return url;
  }
}

export function formatClock(ms: number): string {
  const totalSeconds = Math.round(ms / 1000);
  return `${Math.floor(totalSeconds / 60)}:${String(totalSeconds % 60).padStart(2, "0")}`;
}

function downloadName(title: string, finishedAt: string): string {
  const base = title.replace(/[^A-Za-z0-9 ._()-]/g, "").replace(/\s+/g, " ").trim() || "render";
  const date = finishedAt.slice(0, 10);
  return `${base}${date ? ` ${date}` : ""}.mp4`;
}

export function buildRenderTiles(
  rows: RenderRow[],
  projects: Array<{ id: string; title: string | null }>,
): RenderTile[] {
  const titles = new Map(projects.map((project) => [project.id, project.title?.trim() || "Untitled creative"]));
  return rows
    .filter((row): row is RenderRow & { output_url: string } => Boolean(row.output_url))
    .map((row) => {
      const metadata = row.metadata ?? {};
      const projectTitle = titles.get(row.project_id) ?? "Deleted project";
      const finishedAt = row.finished_at ?? row.created_at;
      const url = sameOriginMediaPath(row.output_url);
      const start = numberOrNull(metadata.start_ms);
      const end = numberOrNull(metadata.end_ms);
      const total = numberOrNull(metadata.project_duration_ms);
      const partial = start !== null && end !== null && (start > 0 || (total !== null && end < total));
      return {
        id: row.id,
        projectId: row.project_id,
        projectTitle,
        url,
        downloadUrl: url.startsWith("/media/")
          ? `${url}?download=${encodeURIComponent(downloadName(projectTitle, finishedAt))}`
          : url,
        finishedAt,
        sizeBytes: numberOrNull(row.size_bytes),
        durationMs: numberOrNull(metadata.duration_ms) ?? (start !== null && end !== null ? end - start : null),
        width: numberOrNull(metadata.output_width),
        height: numberOrNull(metadata.output_height),
        range: partial ? `${formatClock(start!)}–${formatClock(end!)}` : null,
      };
    })
    .sort((a, b) => Date.parse(b.finishedAt) - Date.parse(a.finishedAt));
}
