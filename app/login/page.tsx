"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Zap } from "lucide-react";
import { createClient } from "@/lib/supabase/client";

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
    <div className="min-h-screen bg-[#f4f4f8] dark:bg-[#0f0f17] flex items-center justify-center px-4">
      <div className="bg-white dark:bg-[#16161f] rounded-2xl shadow-sm border border-gray-200 dark:border-white/8 w-full max-w-md p-8">
        {/* Logo */}
        <div className="text-center mb-8">
          <Link href="/" className="inline-flex items-center gap-2.5 justify-center mb-3">
            <div className="w-8 h-8 rounded-lg bg-orange-500 flex items-center justify-center">
              <Zap className="w-4 h-4 text-white" strokeWidth={2.5} />
            </div>
            <span className="font-display text-xl font-bold text-gray-900 dark:text-white tracking-tight">
              Studio
            </span>
          </Link>
          <p className="text-gray-500 dark:text-white/40 text-sm">Welcome back — sign in to your account</p>
        </div>

        {/* Form */}
        <form onSubmit={handleLogin} className="space-y-5">
          <div>
            <label htmlFor="email" className="block text-sm font-medium text-gray-700 dark:text-white/60 mb-1.5">
              Email address
            </label>
            <input
              id="email"
              type="email"
              required
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="you@example.com"
              className="w-full border border-gray-200 dark:border-white/10 rounded-xl px-4 py-2.5 text-sm text-gray-900 dark:text-white bg-white dark:bg-white/5 placeholder:text-gray-300 dark:placeholder:text-white/20 outline-none focus:border-orange-400 dark:focus:border-orange-500/50 transition-colors"
            />
          </div>

          <div>
            <div className="flex items-center justify-between mb-1.5">
              <label htmlFor="password" className="block text-sm font-medium text-gray-700 dark:text-white/60">
                Password
              </label>
              <Link
                href="/forgot-password"
                className="text-xs text-orange-500 hover:text-orange-600 hover:underline font-medium"
              >
                Forgot password?
              </Link>
            </div>
            <input
              id="password"
              type="password"
              required
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              placeholder="••••••••"
              className="w-full border border-gray-200 dark:border-white/10 rounded-xl px-4 py-2.5 text-sm text-gray-900 dark:text-white bg-white dark:bg-white/5 placeholder:text-gray-300 dark:placeholder:text-white/20 outline-none focus:border-orange-400 dark:focus:border-orange-500/50 transition-colors"
            />
          </div>

          {error && (
            <div className="bg-red-50 dark:bg-red-500/10 border border-red-100 dark:border-red-500/20 text-red-600 dark:text-red-400 rounded-xl px-4 py-3 text-sm">
              {error}
            </div>
          )}

          <button
            type="submit"
            disabled={loading}
            className="btn w-full"
          >
            {loading ? "Signing in…" : "Sign In"}
          </button>
        </form>

        <p className="text-center text-sm text-gray-400 dark:text-white/30 mt-6">
          Don&apos;t have an account?{" "}
          <Link href="/signup" className="text-orange-500 font-semibold hover:underline">
            Start free
          </Link>
        </p>
      </div>
    </div>
  );
}
