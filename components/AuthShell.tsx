import Link from "next/link";
import BrandLogo from "@/components/BrandLogo";

/**
 * Shared chrome for the signed-out pages (login, signup).
 *
 * A split layout: a dark brand panel that carries the pitch on large screens,
 * and the form itself on a light surface. The panel collapses away below `lg`
 * so a phone gets the form and nothing competing with it.
 */
export default function AuthShell({
  title,
  subtitle,
  children,
  footer,
}: {
  title: string;
  subtitle: string;
  children: React.ReactNode;
  footer?: React.ReactNode;
}) {
  return (
    <div className="min-h-screen lg:grid lg:grid-cols-[1.05fr_1fr]" style={{ backgroundColor: "var(--bg)" }}>
      {/* Brand panel — its own dark room in both themes, like the editor stage. */}
      <aside
        className="relative hidden lg:flex flex-col justify-between overflow-hidden p-12"
        style={{ backgroundColor: "var(--stage)" }}
      >
        <div
          aria-hidden
          className="pointer-events-none absolute -left-24 -top-32 h-[28rem] w-[28rem] rounded-full blur-3xl"
          style={{ background: "radial-gradient(circle, rgba(249,115,22,0.30), transparent 65%)" }}
        />
        <div
          aria-hidden
          className="pointer-events-none absolute -bottom-40 -right-24 h-[30rem] w-[30rem] rounded-full blur-3xl"
          style={{ background: "radial-gradient(circle, rgba(249,115,22,0.16), transparent 65%)" }}
        />

        <Link href="/" className="relative z-10 inline-block">
          <BrandLogo className="h-8" onDark priority />
        </Link>

        <div className="relative z-10 max-w-md">
          <h2 className="font-display text-4xl font-bold leading-tight tracking-tight text-white">
            Every idea deserves
            <span className="font-serif-italic block text-orange-400">a finished cut.</span>
          </h2>
          <ul className="mt-8 space-y-4">
            {[
              "Script, storyboard and render in one place",
              "Reusable brand kits, so every video matches",
              "Export in minutes, not an afternoon",
            ].map((line) => (
              <li key={line} className="flex items-start gap-3 text-sm text-white/60">
                <span className="mt-1.5 h-1.5 w-1.5 shrink-0 rounded-full bg-orange-500" />
                {line}
              </li>
            ))}
          </ul>
        </div>

        <p className="relative z-10 text-xs text-white/25">
          © {new Date().getFullYear()} Studio. All rights reserved.
        </p>
      </aside>

      {/* Form side */}
      <main className="flex min-h-screen items-center justify-center px-5 py-12 lg:min-h-0">
        <div className="w-full max-w-sm">
          <Link href="/" className="mb-10 inline-block lg:hidden">
            <BrandLogo className="h-7" priority />
          </Link>

          <h1 className="font-display text-3xl font-bold tracking-tight" style={{ color: "var(--ink)" }}>
            {title}
          </h1>
          <p className="mt-2 text-sm" style={{ color: "var(--ink-muted)" }}>
            {subtitle}
          </p>

          <div className="mt-8">{children}</div>

          {footer && (
            <p className="mt-8 text-center text-sm" style={{ color: "var(--ink-muted)" }}>
              {footer}
            </p>
          )}
        </div>
      </main>
    </div>
  );
}
