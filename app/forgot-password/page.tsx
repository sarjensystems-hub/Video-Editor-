"use client";

import { useState, Suspense } from "react";
import Link from "next/link";
import { ArrowLeft, Check } from "lucide-react";
import { useSearchParams } from "next/navigation";
import { sendPasswordReset } from "@/app/actions/auth";
import AuthShell, { AuthError, AuthField } from "@/components/AuthShell";

function ForgotPasswordForm() {
  const searchParams = useSearchParams();
  const linkExpired = searchParams.get("error") === "link-expired";

  const [email, setEmail]   = useState("");
  const [sent, setSent]     = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError]   = useState<string | null>(null);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setLoading(true);
    setError(null);

    const { error } = await sendPasswordReset(email);

    setLoading(false);

    if (error) {
      setError(error);
      return;
    }

    setSent(true);
  }

  if (sent) {
    return (
      <AuthShell title="Check your email" subtitle="The link expires in one hour.">
        <div className="card flex flex-col items-center bg-canvas-subtle p-8 text-center">
          <span className="grid h-12 w-12 place-items-center rounded-full bg-success-wash">
            <Check className="h-6 w-6 text-success" strokeWidth={2.2} />
          </span>
          <p className="mt-4 text-sm leading-relaxed text-ink-muted">
            We sent a password reset link to <strong className="text-ink">{email}</strong>.
          </p>
          <p className="mt-3 text-xs text-ink-faint">
            Didn&apos;t get it? Check your spam folder, or{" "}
            <button onClick={() => setSent(false)} className="font-medium text-fire hover:underline">
              try again
            </button>
            .
          </p>
        </div>

        <Link href="/login" className="btn-ghost mt-5 w-full">
          Back to sign in
        </Link>
      </AuthShell>
    );
  }

  return (
    <AuthShell
      title="Forgot your password?"
      subtitle="Enter your email and we'll send you a reset link."
      footer={
        <Link
          href="/login"
          className="inline-flex items-center gap-1.5 text-ink-faint transition-colors hover:text-ink"
        >
          <ArrowLeft className="h-3.5 w-3.5" />
          Back to sign in
        </Link>
      }
    >
      {linkExpired && (
        <div className="mb-5 rounded-[10px] bg-warning-wash px-4 py-3 text-sm text-warning">
          Your reset link has expired or was opened in a different browser. Request a new one below.
        </div>
      )}

      <form onSubmit={handleSubmit} className="space-y-5">
        <AuthField id="email" label="Email address">
          <input
            id="email"
            type="email"
            autoComplete="email"
            required
            autoFocus
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            placeholder="you@example.com"
            className="input"
          />
        </AuthField>

        {error && <AuthError>{error}</AuthError>}

        <button type="submit" disabled={loading} className="btn w-full">
          {loading ? "Sending…" : "Send reset link"}
        </button>
      </form>
    </AuthShell>
  );
}

export default function ForgotPasswordPage() {
  return (
    <Suspense fallback={<div className="min-h-screen bg-canvas" />}>
      <ForgotPasswordForm />
    </Suspense>
  );
}
