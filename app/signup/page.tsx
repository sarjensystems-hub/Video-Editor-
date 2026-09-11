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
import { Loader2, MailCheck } from "lucide-react";
import { createClient } from "@/lib/supabase/client";
import AuthShell, { AuthError, AuthField, AuthPasswordInput } from "@/components/AuthShell";

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
          <Link href="/login" className="font-semibold text-fire hover:underline">
            Back to sign in
          </Link>
        }
      >
        <div className="card flex flex-col items-center bg-canvas-subtle p-8 text-center">
          <span className="grid h-12 w-12 place-items-center rounded-full bg-brand-500/10">
            <MailCheck className="h-6 w-6 text-fire" />
          </span>
          <p className="mt-4 text-sm leading-relaxed text-ink-muted">
            We sent a confirmation link to <strong className="text-ink">{email}</strong>. Click it to
            activate your account.
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
          <Link href="/login" className="font-semibold text-fire hover:underline">
            Sign in
          </Link>
        </>
      }
    >
      <form onSubmit={handleSignup} className="space-y-5">
        <AuthField id="email" label="Email address">
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
        </AuthField>

        <AuthField id="password" label="Password">
          <AuthPasswordInput
            id="password"
            value={password}
            onChange={setPassword}
            show={showPassword}
            onToggleShow={() => setShowPassword((v) => !v)}
            autoComplete="new-password"
            minLength={8}
            placeholder="At least 8 characters"
          />
        </AuthField>

        {error && <AuthError>{error}</AuthError>}

        <button type="submit" disabled={loading} className="btn w-full">
          {loading && <Loader2 className="h-4 w-4 animate-spin" />}
          {loading ? "Creating account…" : "Create account"}
        </button>

        <p className="text-center text-xs leading-relaxed text-ink-faint">
          By creating an account you agree to our Terms of Service and Privacy Policy.
        </p>
      </form>
    </AuthShell>
  );
}
