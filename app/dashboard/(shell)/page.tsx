import Link from "next/link";
import { ArrowUpRight, Clapperboard, Film, Plus, Video } from "lucide-react";
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
      .limit(4),
  ]);

  const renders = recentRenders.data ?? [];
  const rendering = renders.filter((render) => isRenderJobRunning(render.status)).length;

  return (
    <div className="mx-auto w-full max-w-6xl px-4 py-6 sm:px-8 sm:py-10">
      {/* ── Masthead ──
          The accent lives here and almost nowhere else on the page: one place
          that carries the brand, so every other surface can stay quiet. */}
      <header className="relative mb-6 overflow-hidden rounded-3xl border border-edge bg-stage px-6 py-7 sm:px-8 sm:py-9">
        <div
          aria-hidden
          className="pointer-events-none absolute -right-16 -top-24 h-80 w-80 rounded-full blur-3xl"
          style={{ background: "radial-gradient(circle, rgba(109,93,250,0.35), transparent 65%)" }}
        />
        <div
          aria-hidden
          className="pointer-events-none absolute -bottom-32 left-1/3 h-72 w-72 rounded-full blur-3xl"
          style={{ background: "radial-gradient(circle, rgba(8,145,178,0.18), transparent 65%)" }}
        />

        <div className="relative flex flex-col gap-6 sm:flex-row sm:items-end sm:justify-between">
          <div className="min-w-0">
            <p className="text-[10px] font-bold uppercase tracking-[0.18em] text-white/35">Overview</p>
            <h1 className="mt-2 font-display text-2xl font-bold tracking-tight text-white sm:text-3xl">
              {BRAND.name}
            </h1>
            <p className="mt-2 max-w-md text-sm leading-relaxed text-white/50">
              {BRAND.tagline}. Your assistant writes the brief — Studio holds the project, validates
              every edit and renders the file.
            </p>
          </div>

          <Link
            href="/dashboard/creative-studio"
            className="btn shrink-0 self-start sm:self-auto"
          >
            <Plus className="h-4 w-4" /> New project
          </Link>
        </div>

        <dl className="relative mt-8 grid grid-cols-3 gap-px overflow-hidden rounded-2xl border border-white/10 bg-white/10">
          <Stat label="Projects" value={projects.count ?? 0} />
          <Stat label="Generations" value={videos.count ?? 0} />
          <Stat label="Rendering" value={rendering} accent={rendering > 0} />
        </dl>
      </header>

      <div className="grid gap-4 lg:grid-cols-[1.4fr_1fr]">
        <div className="grid gap-4">
          <div className="grid gap-4 sm:grid-cols-2">
            <NavCard
              href="/dashboard/creative-studio"
              icon={Clapperboard}
              title="Creative Studio"
              blurb="Layered projects with revisions, frame previews and MP4 export."
            />
            <NavCard
              href="/dashboard/videos"
              icon={Video}
              title="Videos"
              blurb="Generative footage via Seedance 2.0 Fast, promotable into any project."
            />
          </div>

          <McpConnectCard url={`${appOrigin()}/api/mcp`} />
        </div>

        <section className="card h-fit p-5">
          <h2 className="mb-4 flex items-center gap-2 text-[11px] font-bold uppercase tracking-[0.14em] text-ink-faint">
            <Film className="h-3.5 w-3.5" /> Recent renders
          </h2>

          {renders.length === 0 ? (
            <p className="text-xs leading-relaxed text-ink-faint">
              Nothing rendered yet. Export a project and the last few runs land here.
            </p>
          ) : (
            <ul className="grid gap-1">
              {renders.map((render) => {
                const running = isRenderJobRunning(render.status);
                const done = render.status === "completed" && render.output_url;
                return (
                  <li key={render.id}>
                    <Link
                      href={`/dashboard/creative-studio/${render.project_id}`}
                      className="flex items-center gap-2.5 rounded-xl px-2 py-2.5 transition-colors hover:bg-canvas-subtle"
                    >
                      <span
                        className={[
                          "h-2 w-2 shrink-0 rounded-full",
                          running ? "animate-pulse bg-warning" : done ? "bg-success" : "bg-danger",
                        ].join(" ")}
                      />
                      <span className="min-w-0 flex-1">
                        <span className="block truncate text-xs font-medium text-ink">
                          {running ? "Rendering" : done ? "Completed" : "Failed"}
                        </span>
                        <span className="block truncate text-[11px] tabular-nums text-ink-faint">
                          {relativeTime(render.updated_at)}
                          {running ? ` · ${Math.round(Number(render.progress ?? 0) * 100)}%` : ""}
                        </span>
                      </span>
                      {done && (
                        <span className="shrink-0 text-[11px] font-bold text-fire">Open</span>
                      )}
                    </Link>
                  </li>
                );
              })}
            </ul>
          )}
        </section>
      </div>
    </div>
  );
}

function Stat({ label, value, accent }: { label: string; value: number; accent?: boolean }) {
  return (
    <div className="bg-stage px-4 py-3.5">
      <dt className="text-[10px] font-bold uppercase tracking-[0.14em] text-white/35">{label}</dt>
      <dd
        className={[
          "mt-1 font-display text-2xl font-bold tabular-nums",
          accent ? "text-brand-300" : "text-white",
        ].join(" ")}
      >
        {value}
      </dd>
    </div>
  );
}

function NavCard({
  href,
  icon: Icon,
  title,
  blurb,
}: {
  href: string;
  icon: React.ElementType;
  title: string;
  blurb: string;
}) {
  return (
    <Link
      href={href}
      className="group card p-5 transition-all duration-150 hover:-translate-y-0.5 hover:border-brand-400/60 hover:shadow-md"
    >
      <div className="mb-4 flex items-start justify-between">
        <span className="grid h-10 w-10 place-items-center rounded-xl bg-brand-500/10 text-fire transition-colors group-hover:bg-brand-500/15">
          <Icon className="h-5 w-5" />
        </span>
        <ArrowUpRight className="h-4 w-4 text-ink-faint transition-transform group-hover:-translate-y-0.5 group-hover:translate-x-0.5" />
      </div>
      <div className="text-sm font-bold text-ink">{title}</div>
      <p className="mt-1.5 text-xs leading-relaxed text-ink-muted">{blurb}</p>
    </Link>
  );
}
