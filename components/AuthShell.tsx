import Link from "next/link";
import { Eye, EyeOff } from "lucide-react";
import BrandLogo from "@/components/BrandLogo";

/**
 * Shared chrome for every signed-out page: login, signup, and the two password
 * screens.
 *
 * A split layout — a dark brand panel carrying the pitch, the form on a light
 * surface beside it. The panel collapses away below `lg` so a phone gets the
 * form and nothing competing with it. Everything reads design tokens, so the
 * accent moves with the theme rather than being restated per page.
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
    <div className="min-h-screen bg-canvas lg:grid lg:grid-cols-[1.05fr_1fr]">
      {/* Brand panel — its own dark room in both themes, like the editor stage. */}
      <aside className="relative hidden flex-col justify-between overflow-hidden bg-stage p-12 lg:flex">
        <div
          aria-hidden
          className="pointer-events-none absolute -left-24 -top-32 h-[30rem] w-[30rem] rounded-full blur-3xl"
          style={{ background: "radial-gradient(circle, rgba(109,93,250,0.38), transparent 65%)" }}
        />
        <div
          aria-hidden
          className="pointer-events-none absolute -bottom-40 -right-24 h-[32rem] w-[32rem] rounded-full blur-3xl"
          style={{ background: "radial-gradient(circle, rgba(8,145,178,0.22), transparent 65%)" }}
        />
        {/* A faint rule grid, so the panel reads as a workspace rather than a poster. */}
        <div
          aria-hidden
          className="pointer-events-none absolute inset-0 opacity-[0.07]"
          style={{
            backgroundImage:
              "linear-gradient(to right, #fff 1px, transparent 1px), linear-gradient(to bottom, #fff 1px, transparent 1px)",
            backgroundSize: "72px 72px",
          }}
        />

        <Link href="/" className="relative z-10 inline-block">
          <BrandLogo className="h-8" onDark />
        </Link>

        <div className="relative z-10 max-w-md">
          <h2 className="font-display text-[2.6rem] font-bold leading-[1.05] tracking-tight text-white">
            Every idea deserves
            <span className="font-serif-italic block text-brand-300">a finished cut.</span>
          </h2>
          <ul className="mt-9 space-y-4">
            {[
              "Script, storyboard and render in one place",
              "Reusable brand kits, so every video matches",
              "Export in minutes, not an afternoon",
            ].map((line) => (
              <li key={line} className="flex items-start gap-3 text-sm text-white/55">
                <span className="mt-[7px] h-1 w-4 shrink-0 rounded-full bg-brand-400" />
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
            <BrandLogo className="h-7" />
          </Link>

          <h1 className="font-display text-[1.75rem] font-bold tracking-tight text-ink">{title}</h1>
          <p className="mt-2 text-sm text-ink-muted">{subtitle}</p>

          <div className="mt-8">{children}</div>

          {footer && <div className="mt-8 text-center text-sm text-ink-muted">{footer}</div>}
        </div>
      </main>
    </div>
  );
}

/** A labelled field, so every auth form spaces and labels its inputs alike. */
export function AuthField({
  id,
  label,
  action,
  children,
}: {
  id: string;
  label: string;
  action?: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <div>
      <div className="mb-1.5 flex items-center justify-between gap-2">
        <label htmlFor={id} className="block text-sm font-medium text-ink">
          {label}
        </label>
        {action}
      </div>
      {children}
    </div>
  );
}

/** The inline error every auth form shows above its submit button. */
export function AuthError({ children }: { children: React.ReactNode }) {
  return (
    <div role="alert" className="rounded-[10px] bg-danger-wash px-4 py-3 text-sm text-danger">
      {children}
    </div>
  );
}

/**
 * A password input with its own show/hide toggle. Every auth form needs one
 * and they were each growing a slightly different eye button.
 */
export function AuthPasswordInput({
  id,
  value,
  onChange,
  show,
  onToggleShow,
  autoComplete,
  minLength,
  placeholder = "••••••••",
}: {
  id: string;
  value: string;
  onChange: (value: string) => void;
  show: boolean;
  onToggleShow: () => void;
  autoComplete?: string;
  minLength?: number;
  placeholder?: string;
}) {
  return (
    <div className="relative">
      <input
        id={id}
        type={show ? "text" : "password"}
        required
        minLength={minLength}
        autoComplete={autoComplete}
        value={value}
        onChange={(event) => onChange(event.target.value)}
        placeholder={placeholder}
        className="input pr-11"
      />
      <button
        type="button"
        onClick={onToggleShow}
        aria-label={show ? "Hide password" : "Show password"}
        className="absolute right-3 top-1/2 -translate-y-1/2 rounded-md p-1 text-ink-faint transition-colors hover:text-fire"
      >
        {show ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
      </button>
    </div>
  );
}
