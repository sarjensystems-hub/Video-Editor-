"use client";

import { useState, useEffect } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { Zap, Eye, EyeOff, Check } from "lucide-react";
import { createClient } from "@/lib/supabase/client";

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
      <div className="min-h-screen bg-[#f4f4f8] dark:bg-[#0f0f17] flex items-center justify-center px-4">
        <div className="bg-white dark:bg-[#16161f] rounded-2xl border border-gray-200 dark:border-white/8 w-full max-w-md p-8 text-center">
          <Logo />
          <div className="w-14 h-14 rounded-full bg-gray-100 dark:bg-white/5 flex items-center justify-center mx-auto my-6 animate-pulse">
            <Zap className="w-6 h-6 text-gray-400 dark:text-white/20" />
          </div>
          <p className="text-gray-500 dark:text-white/40 text-sm">
            Verifying your reset link…
          </p>
          <p className="text-xs text-gray-300 dark:text-white/20 mt-2">
            If nothing happens, your link may have expired.{" "}
            <Link href="/forgot-password" className="text-orange-500 hover:underline">
              Request a new one
            </Link>
            .
          </p>
        </div>
      </div>
    );
  }

  /* ── Success ── */
  if (done) {
    return (
      <div className="min-h-screen bg-[#f4f4f8] dark:bg-[#0f0f17] flex items-center justify-center px-4">
        <div className="bg-white dark:bg-[#16161f] rounded-2xl border border-gray-200 dark:border-white/8 w-full max-w-md p-8 text-center">
          <Logo />
          <div className="w-14 h-14 rounded-full bg-green-50 dark:bg-green-500/15 flex items-center justify-center mx-auto my-6">
            <Check className="w-7 h-7 text-green-500" strokeWidth={2} />
          </div>
          <h1 className="text-xl font-bold text-gray-900 dark:text-white mb-2">Password updated</h1>
          <p className="text-gray-500 dark:text-white/40 text-sm">
            Redirecting you to the dashboard…
          </p>
        </div>
      </div>
    );
  }

  /* ── Reset form ── */
  return (
    <div className="min-h-screen bg-[#f4f4f8] dark:bg-[#0f0f17] flex items-center justify-center px-4">
      <div className="bg-white dark:bg-[#16161f] rounded-2xl shadow-sm border border-gray-200 dark:border-white/8 w-full max-w-md p-8">
        <div className="text-center mb-8">
          <Logo />
          <h1 className="text-xl font-bold text-gray-900 dark:text-white mt-4 mb-1">Set a new password</h1>
          <p className="text-gray-500 dark:text-white/40 text-sm">
            Choose something strong — at least 8 characters.
          </p>
        </div>

        <form onSubmit={handleSubmit} className="space-y-5">
          <PasswordField
            id="password"
            label="New password"
            value={password}
            onChange={setPassword}
            show={showPw}
            onToggle={() => setShowPw(!showPw)}
          />
          <PasswordField
            id="confirm"
            label="Confirm new password"
            value={confirm}
            onChange={setConfirm}
            show={showPw}
            onToggle={() => setShowPw(!showPw)}
          />

          {/* Strength hints */}
          {password.length > 0 && (
            <div className="flex gap-1">
              {[4, 8, 12].map((len) => (
                <div
                  key={len}
                  className={`flex-1 h-1 rounded-full transition-colors ${
                    password.length >= len
                      ? len === 12 ? "bg-green-400" : len === 8 ? "bg-orange-400" : "bg-red-400"
                      : "bg-gray-100 dark:bg-white/10"
                  }`}
                />
              ))}
            </div>
          )}

          {error && (
            <div className="bg-red-50 dark:bg-red-500/10 border border-red-100 dark:border-red-500/20 text-red-600 dark:text-red-400 rounded-xl px-4 py-3 text-sm">
              {error}
            </div>
          )}

          <button type="submit" disabled={loading} className="btn w-full">
            {loading ? "Updating…" : "Update Password"}
          </button>
        </form>
      </div>
    </div>
  );
}

function Logo() {
  return (
    <Link href="/" className="inline-flex items-center gap-2.5 justify-center">
      <div className="w-8 h-8 rounded-lg bg-orange-500 flex items-center justify-center">
        <Zap className="w-4 h-4 text-white" strokeWidth={2.5} />
      </div>
      <span className="font-display text-xl font-bold text-gray-900 dark:text-white tracking-tight">
        Studio
      </span>
    </Link>
  );
}

function PasswordField({
  id, label, value, onChange, show, onToggle,
}: {
  id: string;
  label: string;
  value: string;
  onChange: (v: string) => void;
  show: boolean;
  onToggle: () => void;
}) {
  return (
    <div>
      <label htmlFor={id} className="block text-sm font-medium text-gray-700 dark:text-white/60 mb-1.5">
        {label}
      </label>
      <div className="relative">
        <input
          id={id}
          type={show ? "text" : "password"}
          required
          value={value}
          onChange={(e) => onChange(e.target.value)}
          placeholder="••••••••"
          className="w-full border border-gray-200 dark:border-white/10 rounded-xl px-4 pr-11 py-2.5 text-sm text-gray-900 dark:text-white bg-white dark:bg-white/5 placeholder:text-gray-300 dark:placeholder:text-white/20 outline-none focus:border-orange-400 dark:focus:border-orange-500/50 transition-colors"
        />
        <button
          type="button"
          onClick={onToggle}
          className="absolute right-3.5 top-1/2 -translate-y-1/2 text-gray-300 dark:text-white/20 hover:text-gray-500 dark:hover:text-white/50 transition-colors"
        >
          {show ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
        </button>
      </div>
    </div>
  );
}
