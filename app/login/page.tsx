"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Loader2 } from "lucide-react";
import { createClient } from "@/lib/supabase/client";
import AuthShell, { AuthError, AuthField, AuthPasswordInput } from "@/components/AuthShell";

function safePostLoginRedirect(): string {
  if (typeof window === "undefined") return "/dashboard";
  const candidate = new URLSearchParams(window.location.search).get("redirect");
  if (candidate && candidate.startsWith("/") && !candidate.startsWith("//")) return candidate;
  return "/dashboard";
}

export default function LoginPage() {
  const router = useRouter();
  const supabase = createClient();

  const [email, setEmail]       = useState("");
  const [password, setPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [error, setError]       = useState<string | null>(null);
  const [loading, setLoading]   = useState(false);

  async function handleLogin(e: React.FormEvent) {
    e.preventDefault();
    setLoading(true);
    setError(null);

    const { error } = await supabase.auth.signInWithPassword({ email, password });

    if (error) {
      setError(error.message);
      setLoading(false);
      return;
    }

    router.push(safePostLoginRedirect());
    router.refresh();
  }

  return (
    <AuthShell
      title="Welcome back"
      subtitle="Sign in to pick up where you left off."
      footer={
        <>
          New here?{" "}
          <Link href="/signup" className="font-semibold text-fire hover:underline">
            Create an account
          </Link>
        </>
      }
    >
      <form onSubmit={handleLogin} className="space-y-5">
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

        <AuthField
          id="password"
          label="Password"
          action={
            <Link href="/forgot-password" className="text-xs font-medium text-fire hover:underline">
              Forgot password?
            </Link>
          }
        >
          <AuthPasswordInput
            id="password"
            value={password}
            onChange={setPassword}
            show={showPassword}
            onToggleShow={() => setShowPassword((v) => !v)}
            autoComplete="current-password"
          />
        </AuthField>

        {error && <AuthError>{error}</AuthError>}

        <button type="submit" disabled={loading} className="btn w-full">
          {loading && <Loader2 className="h-4 w-4 animate-spin" />}
          {loading ? "Signing in…" : "Sign in"}
        </button>
      </form>
    </AuthShell>
  );
}
