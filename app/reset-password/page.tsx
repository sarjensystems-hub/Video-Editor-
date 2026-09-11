"use client";

import { useState, useEffect } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { Check, Loader2 } from "lucide-react";
import { createClient } from "@/lib/supabase/client";
import AuthShell, { AuthError, AuthField, AuthPasswordInput } from "@/components/AuthShell";

export default function ResetPasswordPage() {
  const router  = useRouter();
  const supabase = createClient();

  const [password, setPassword]   = useState("");
  const [confirm, setConfirm]     = useState("");
  const [showPw, setShowPw]       = useState(false);
  const [ready, setReady]         = useState(false);   // session from email link confirmed
  const [done, setDone]           = useState(false);
  const [loading, setLoading]     = useState(false);
  const [error, setError]         = useState<string | null>(null);

  useEffect(() => {
    supabase.auth.getSession().then(({ data: { session } }) => {
      if (session) setReady(true);
    });
  }, [supabase]);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);

    if (password.length < 8) {
      setError("Password must be at least 8 characters.");
      return;
    }
    if (password !== confirm) {
      setError("Passwords don't match.");
      return;
    }

    setLoading(true);
    const { error } = await supabase.auth.updateUser({ password });
    setLoading(false);

    if (error) {
      setError(error.message);
      return;
    }

    setDone(true);
    setTimeout(() => router.push("/dashboard"), 2500);
  }

  /* ── Invalid / expired link ── */
  if (!ready && !done) {
    return (
      <AuthShell title="Verifying your link" subtitle="One moment while we check this reset link.">
        <div className="card flex flex-col items-center bg-canvas-subtle p-8 text-center">
          <Loader2 className="h-6 w-6 animate-spin text-fire" />
          <p className="mt-4 text-xs leading-relaxed text-ink-faint">
            If nothing happens, your link may have expired.{" "}
            <Link href="/forgot-password" className="font-medium text-fire hover:underline">
              Request a new one
            </Link>
            .
          </p>
        </div>
      </AuthShell>
    );
  }

  /* ── Success ── */
  if (done) {
    return (
      <AuthShell title="Password updated" subtitle="Taking you to the dashboard…">
        <div className="card flex flex-col items-center bg-canvas-subtle p-8 text-center">
          <span className="grid h-12 w-12 place-items-center rounded-full bg-success-wash">
            <Check className="h-6 w-6 text-success" strokeWidth={2.2} />
          </span>
          <p className="mt-4 text-sm text-ink-muted">You&apos;re signed in with the new password.</p>
        </div>
      </AuthShell>
    );
  }

  /* ── Reset form ── */
  return (
    <AuthShell title="Set a new password" subtitle="Choose something strong — at least 8 characters.">
      <form onSubmit={handleSubmit} className="space-y-5">
        <AuthField id="password" label="New password">
          <AuthPasswordInput
            id="password"
            value={password}
            onChange={setPassword}
            show={showPw}
            onToggleShow={() => setShowPw(!showPw)}
            autoComplete="new-password"
          />
        </AuthField>

        <AuthField id="confirm" label="Confirm new password">
          <AuthPasswordInput
            id="confirm"
            value={confirm}
            onChange={setConfirm}
            show={showPw}
            onToggleShow={() => setShowPw(!showPw)}
            autoComplete="new-password"
          />
        </AuthField>

        {/* Strength hints */}
        {password.length > 0 && (
          <div className="flex gap-1">
            {[4, 8, 12].map((len) => (
              <div
                key={len}
                className={`h-1 flex-1 rounded-full transition-colors ${
                  password.length >= len
                    ? len === 12 ? "bg-success" : len === 8 ? "bg-warning" : "bg-danger"
                    : "bg-canvas-muted"
                }`}
              />
            ))}
          </div>
        )}

        {error && <AuthError>{error}</AuthError>}

        <button type="submit" disabled={loading} className="btn w-full">
          {loading && <Loader2 className="h-4 w-4 animate-spin" />}
          {loading ? "Updating…" : "Update password"}
        </button>
      </form>
    </AuthShell>
  );
}
