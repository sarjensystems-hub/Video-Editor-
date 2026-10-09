import Link from "next/link";
import { Download, ExternalLink, Film } from "lucide-react";
import { createClient } from "@/lib/supabase/server";
import { isRenderJobRunning } from "@/lib/creative/render-job";
import { buildRenderTiles, formatClock, type RenderTile } from "@/lib/render-library";
import PageHeader from "@/components/ui/PageHeader";
import LazyVideo from "@/components/media/LazyVideo";

export const dynamic = "force-dynamic";

function formatBytes(bytes: number): string {
  const megabytes = bytes / (1024 * 1024);
  return megabytes >= 1 ? `${megabytes.toFixed(megabytes >= 10 ? 0 : 1)} MB` : `${Math.max(1, Math.round(bytes / 1024))} KB`;
}

function formatDate(value: string): string {
  return new Date(value).toLocaleString(undefined, { day: "numeric", month: "short", hour: "numeric", minute: "2-digit" });
}

export default async function RendersPage() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return null;

  const [renders, projects] = await Promise.all([
    supabase
      .from("creative_render_jobs")
      .select("id, project_id, status, output_url, size_bytes, metadata, finished_at, created_at")
      .eq("user_id", user.id)
      .order("created_at", { ascending: false })
      .limit(500),
    supabase.from("creative_projects").select("id, title").eq("user_id", user.id),
  ]);

  const rows = renders.data ?? [];
  const tiles = buildRenderTiles(rows.filter((row) => row.status === "completed"), projects.data ?? []);
  const running = rows.filter((row) => isRenderJobRunning(row.status)).length;
  const error = renders.error?.message ?? projects.error?.message ?? null;

  return (
    <div className="mx-auto w-full max-w-6xl px-4 py-6 sm:px-8 sm:py-10">
      <PageHeader
        eyebrow="Exports"
        title="Renders"
        description={
          <>
            Every finished video, newest first.
            {running > 0 && ` ${running} more ${running === 1 ? "is" : "are"} rendering now.`} To delete one, use{" "}
            <Link href="/dashboard/media" className="text-fire hover:underline">Media</Link>.
          </>
        }
      />
      {error ? (
        <p className="rounded-xl bg-danger-wash px-4 py-3 text-sm text-danger">{error}</p>
      ) : tiles.length === 0 ? (
        <div className="card flex flex-col items-center gap-2 px-6 py-12 text-center">
          <Film className="h-7 w-7 text-ink-faint" />
          <p className="text-sm font-medium text-ink">No renders yet</p>
          <p className="text-xs text-ink-faint">Export a project from Creative Studio and the MP4 lands here.</p>
        </div>
      ) : (
        <ul className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {tiles.map((tile) => (
            <RenderCard key={tile.id} tile={tile} />
          ))}
        </ul>
      )}
    </div>
  );
}

function RenderCard({ tile }: { tile: RenderTile }) {
  const details = [
    tile.durationMs !== null ? formatClock(tile.durationMs) : null,
    tile.width && tile.height ? `${tile.width}×${tile.height}` : null,
    tile.sizeBytes !== null ? formatBytes(tile.sizeBytes) : null,
  ].filter(Boolean);

  return (
    <li className="card flex min-w-0 flex-col overflow-hidden">
      {/* Square, so portrait and landscape films both sit whole in a tidy grid. */}
      <div className="aspect-square bg-black">
        <LazyVideo src={tile.url} muted={false} />
      </div>
      <div className="flex min-w-0 items-start gap-2 p-3">
        <div className="min-w-0 flex-1">
          <Link
            href={`/dashboard/creative-studio/${tile.projectId}`}
            className="block truncate text-sm font-medium text-ink hover:text-fire"
            title={tile.projectTitle}
          >
            {tile.projectTitle}
          </Link>
          <p className="mt-0.5 truncate text-xs tabular-nums text-ink-faint">
            {formatDate(tile.finishedAt)}
            {details.length > 0 && ` · ${details.join(" · ")}`}
          </p>
          {tile.range && <p className="mt-1 text-xs text-ink-muted">Part {tile.range}</p>}
        </div>
        <a
          href={tile.url}
          target="_blank"
          rel="noreferrer"
          aria-label={`Open ${tile.projectTitle} in a new tab`}
          title="Open in a new tab"
          className="grid h-8 w-8 shrink-0 place-items-center rounded-lg text-ink-muted transition-colors hover:bg-canvas-subtle hover:text-ink"
        >
          <ExternalLink className="h-3.5 w-3.5" />
        </a>
        <a
          href={tile.downloadUrl}
          aria-label={`Download ${tile.projectTitle}`}
          title="Download MP4"
          className="grid h-8 w-8 shrink-0 place-items-center rounded-lg text-fire transition-colors hover:bg-canvas-subtle"
        >
          <Download className="h-3.5 w-3.5" />
        </a>
      </div>
    </li>
  );
}
