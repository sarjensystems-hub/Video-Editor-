"use client";

import { useState } from "react";
import Link from "next/link";
import { Zap, ArrowLeft, Mail, Check } from "lucide-react";
import { useSearchParams } from "next/navigation";
import { Suspense } from "react";
import { sendPasswordReset } from "@/app/actions/auth";

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
        </div>

        {sent ? (
          /* Success state */
          <div className="text-center">
            <div className="w-14 h-14 rounded-full bg-green-50 dark:bg-green-500/15 flex items-center justify-center mx-auto mb-5">
              <Check className="w-7 h-7 text-green-500" strokeWidth={2} />
            </div>
            <h1 className="text-xl font-bold text-gray-900 dark:text-white mb-2">Check your email</h1>
            <p className="text-gray-500 dark:text-white/40 text-sm mb-6 leading-relaxed">
              We sent a password reset link to{" "}
              <span className="font-semibold text-gray-700 dark:text-white/70">{email}</span>.
              It expires in 1 hour.
            </p>
            <p className="text-xs text-gray-400 dark:text-white/25 mb-6">
              Didn&apos;t get it? Check your spam folder, or{" "}
              <button
                onClick={() => setSent(false)}
                className="text-orange-500 hover:underline font-medium"
              >
                try again
              </button>
              .
            </p>
            <Link href="/login" className="btn w-full justify-center">
              Back to Sign In
            </Link>
          </div>
        ) : (
          /* Form state */
          <>
            {linkExpired && (
              <div className="mb-5 bg-amber-50 dark:bg-amber-500/10 border border-amber-100 dark:border-amber-500/20 text-amber-700 dark:text-amber-400 rounded-xl px-4 py-3 text-sm">
                Your reset link has expired or was opened in a different browser. Request a new one below.
              </div>
            )}
            <div className="mb-7">
              <h1 className="text-xl font-bold text-gray-900 dark:text-white mb-1.5">Forgot your password?</h1>
              <p className="text-gray-500 dark:text-white/40 text-sm">
                Enter your email and we&apos;ll send you a reset link.
              </p>
            </div>

            <form onSubmit={handleSubmit} className="space-y-5">
              <div>
                <label htmlFor="email" className="block text-sm font-medium text-gray-700 dark:text-white/60 mb-1.5">
                  Email address
                </label>
                <div className="relative">
                  <Mail className="absolute left-3.5 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-300 dark:text-white/20" />
                  <input
                    id="email"
                    type="email"
                    required
                    autoFocus
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                    placeholder="you@example.com"
                    className="w-full border border-gray-200 dark:border-white/10 rounded-xl pl-10 pr-4 py-2.5 text-sm text-gray-900 dark:text-white bg-white dark:bg-white/5 placeholder:text-gray-300 dark:placeholder:text-white/20 outline-none focus:border-orange-400 dark:focus:border-orange-500/50 transition-colors"
                  />
                </div>
              </div>

              {error && (
                <div className="bg-red-50 dark:bg-red-500/10 border border-red-100 dark:border-red-500/20 text-red-600 dark:text-red-400 rounded-xl px-4 py-3 text-sm">
                  {error}
                </div>
              )}

              <button type="submit" disabled={loading} className="btn w-full">
                {loading ? "Sending…" : "Send Reset Link"}
              </button>
            </form>

            <div className="mt-6 text-center">
              <Link
                href="/login"
                className="inline-flex items-center gap-1.5 text-sm text-gray-400 dark:text-white/30 hover:text-gray-600 dark:hover:text-white/60 transition-colors"
              >
                <ArrowLeft className="w-3.5 h-3.5" />
                Back to Sign In
              </Link>
            </div>
          </>
        )}
      </div>
    </div>
  );
}

export default function ForgotPasswordPage() {
  return (
    <Suspense fallback={<div className="min-h-screen" />}>
      <ForgotPasswordForm />
    </Suspense>
  );
}
