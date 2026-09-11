"use client";

/**
 * Signup page — new users create their account here.
 *
 * With email confirmation switched off in the Supabase project, `signUp`
 * returns a session straight away and the user lands on the dashboard with no
 * round trip through their inbox. The confirmation screen below is the
 * fallback for a project that still has confirmation on, so the page keeps
 * working either way rather than stranding the user on a dead form.
 */
import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Eye, EyeOff, Loader2, MailCheck } from "lucide-react";
import { createClient } from "@/lib/supabase/client";
import AuthShell from "@/components/AuthShell";

export default function SignupPage() {
  const router = useRouter();
  const supabase = createClient();

  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState(false);
  const [loading, setLoading] = useState(false);

  async function handleSignup(e: React.FormEvent) {
    e.preventDefault();
    setLoading(true);
    setError(null);

    const { data, error } = await supabase.auth.signUp({
      email,
      password,
      options: {
        // Only reached when the project still requires confirmation.
        emailRedirectTo: `${location.origin}/auth/callback`,
      },
    });

    if (error) {
      setError(error.message);
      setLoading(false);
      return;
    }

    // Confirmation is off: the account is live and signed in already.
    if (data.session) {
      router.push("/dashboard");
      router.refresh();
      return;
    }

    // Confirmation is still on — tell them to go and click the link.
    setSuccess(true);
    setLoading(false);
  }

  if (success) {
    return (
      <AuthShell
        title="Check your email"
        subtitle="Your account is one click away."
        footer={
          <Link href="/login" className="font-semibold text-orange-500 hover:text-orange-600">
            Back to sign in
          </Link>
        }
      >
        <div
          className="card flex flex-col items-center p-8 text-center"
          style={{ backgroundColor: "var(--surface-2)" }}
        >
          <span
            className="flex h-12 w-12 items-center justify-center rounded-full"
            style={{ backgroundColor: "var(--fire-wash)" }}
          >
            <MailCheck className="h-6 w-6 text-orange-500" />
          </span>
          <p className="mt-4 text-sm leading-relaxed" style={{ color: "var(--ink-muted)" }}>
            We sent a confirmation link to{" "}
            <strong style={{ color: "var(--ink)" }}>{email}</strong>. Click it to activate your
            account.
          </p>
        </div>
      </AuthShell>
    );
  }

  return (
    <AuthShell
      title="Create your account"
      subtitle="Free to start — no card required."
      footer={
        <>
          Already have an account?{" "}
          <Link href="/login" className="font-semibold text-orange-500 hover:text-orange-600">
            Sign in
          </Link>
        </>
      }
    >
      <form onSubmit={handleSignup} className="space-y-5">
        <div>
          <label htmlFor="email" className="mb-1.5 block text-sm font-medium" style={{ color: "var(--ink)" }}>
            Email address
          </label>
          <input
            id="email"
            type="email"
            autoComplete="email"
            required
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            placeholder="you@example.com"
            className="input"
          />
        </div>

        <div>
          <label htmlFor="password" className="mb-1.5 block text-sm font-medium" style={{ color: "var(--ink)" }}>
            Password
          </label>
          <div className="relative">
            <input
              id="password"
              type={showPassword ? "text" : "password"}
              autoComplete="new-password"
              required
              minLength={8}
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              placeholder="At least 8 characters"
              className="input pr-11"
            />
            <button
              type="button"
              onClick={() => setShowPassword((v) => !v)}
              aria-label={showPassword ? "Hide password" : "Show password"}
              className="absolute right-3 top-1/2 -translate-y-1/2 rounded-md p-1 transition-colors hover:text-orange-500"
              style={{ color: "var(--ink-faint)" }}
            >
              {showPassword ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
            </button>
          </div>
        </div>

        {error && (
          <div
            role="alert"
            className="rounded-xl px-4 py-3 text-sm"
            style={{ backgroundColor: "var(--danger-wash)", color: "var(--danger)" }}
          >
            {error}
          </div>
        )}

        <button type="submit" disabled={loading} className="btn w-full">
          {loading && <Loader2 className="h-4 w-4 animate-spin" />}
          {loading ? "Creating account…" : "Create account"}
        </button>

        <p className="text-center text-xs leading-relaxed" style={{ color: "var(--ink-faint)" }}>
          By creating an account you agree to our Terms of Service and Privacy Policy.
        </p>
      </form>
    </AuthShell>
  );
}
