import Link from "next/link";
import { ArrowRight, Clapperboard, Film, Video } from "lucide-react";
import { BRAND } from "@/lib/brand";
import McpConnectCard from "@/components/dashboard/McpConnectCard";
import { createClient } from "@/lib/supabase/server";
import { isRenderJobRunning } from "@/lib/creative/render-job";

export const dynamic = "force-dynamic";

/** Public origin used for the MCP endpoint shown to the user. */
function appOrigin(): string {
  return process.env.NEXT_PUBLIC_APP_URL?.replace(/\/$/, "") ?? "https://studio.example.com";
}

function relativeTime(value: string | null): string {
  if (!value) return "";
  const deltaMs = Date.now() - Date.parse(value);
  if (!Number.isFinite(deltaMs)) return "";
  const minutes = Math.round(deltaMs / 60_000);
  if (minutes < 1) return "just now";
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  return `${Math.round(hours / 24)}d ago`;
}

export default async function DashboardPage() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return null;

  const [projects, videos, recentRenders] = await Promise.all([
    supabase.from("creative_projects").select("*", { count: "exact", head: true }).eq("user_id", user.id),
    supabase.from("video_generations").select("*", { count: "exact", head: true }).eq("user_id", user.id),
    supabase
      .from("creative_render_jobs")
      .select("id, project_id, status, progress, output_url, updated_at")
      .eq("user_id", user.id)
      .order("created_at", { ascending: false })
      .limit(3),
  ]);

  const renders = recentRenders.data ?? [];

  return (
    <div className="mx-auto w-full max-w-5xl px-4 py-5 sm:px-6 sm:py-8">
      <header className="mb-5 flex items-start justify-between gap-4">
        <div>
          <h1 className="text-xl font-semibold tracking-tight text-ink sm:text-2xl">{BRAND.name}</h1>
          <p className="mt-1 max-w-xl text-xs leading-relaxed text-ink-muted sm:text-sm">
            Deterministic creative execution for ChatGPT and Claude.
          </p>
        </div>
      </header>

      <div className="mb-4">
        <McpConnectCard url={`${appOrigin()}/api/mcp`} />
      </div>

      <div className="mb-4 grid gap-3 sm:grid-cols-2">
        <NavCard
          href="/dashboard/creative-studio"
          icon={Clapperboard}
          title="Creative Studio"
          count={projects.count ?? 0}
          unit="project"
          blurb="Layered projects with revisions, frame previews and MP4 export."
        />
        <NavCard
          href="/dashboard/videos"
          icon={Video}
          title="Videos"
          count={videos.count ?? 0}
          unit="generation"
          blurb="Generative footage via Seedance 2.0 Fast, promotable into any project."
        />
      </div>

      {renders.length > 0 && (
        <section className="rounded-2xl border border-edge bg-panel p-4 sm:p-5">
          <h2 className="mb-3 flex items-center gap-2 text-sm font-bold text-ink">
            <Film className="h-4 w-4 text-ink-faint" /> Recent renders
          </h2>
          <ul className="divide-y divide-edge-faint">
            {renders.map((render) => {
              const running = isRenderJobRunning(render.status);
              return (
                <li key={render.id} className="flex items-center justify-between gap-3 py-2.5 first:pt-0 last:pb-0">
                  <Link
                    href={`/dashboard/creative-studio/${render.project_id}`}
                    className="min-w-0 flex-1 truncate text-xs text-ink-muted transition-colors hover:text-ink"
                  >
                    {relativeTime(render.updated_at)}
                    {running ? ` · ${Math.round(Number(render.progress ?? 0) * 100)}%` : ""}
                  </Link>
                  {render.status === "completed" && render.output_url ? (
                    <a
                      href={render.output_url}
                      target="_blank"
                      rel="noreferrer"
                      className="shrink-0 text-[11px] font-bold text-success underline-offset-2 hover:underline"
                    >
                      Open MP4
                    </a>
                  ) : (
                    <span
                      className={[
                        "shrink-0 rounded-full px-2 py-0.5 text-[10px] font-bold",
                        running ? "bg-warning-wash text-warning" : "bg-danger-wash text-danger",
                      ].join(" ")}
                    >
                      {running ? "Rendering" : "Failed"}
                    </span>
                  )}
                </li>
              );
            })}
          </ul>
        </section>
      )}
    </div>
  );
}

function NavCard({
  href,
  icon: Icon,
  title,
  count,
  unit,
  blurb,
}: {
  href: string;
  icon: React.ElementType;
  title: string;
  count: number;
  unit: string;
  blurb: string;
}) {
  return (
    <Link
      href={href}
      className="group rounded-2xl border border-edge bg-panel p-4 transition-colors hover:border-fire/50 sm:p-5"
    >
      <div className="mb-3 flex items-center justify-between">
        <Icon className="h-5 w-5 text-ink-faint" />
        <ArrowRight className="h-4 w-4 text-ink-faint transition-transform group-hover:translate-x-0.5" />
      </div>
      <div className="text-sm font-bold text-ink">{title}</div>
      <div className="mt-0.5 text-[11px] tabular-nums text-ink-faint">
        {count} {unit}
        {count === 1 ? "" : "s"}
      </div>
      <p className="mt-2 text-xs leading-relaxed text-ink-muted">{blurb}</p>
    </Link>
  );
}
