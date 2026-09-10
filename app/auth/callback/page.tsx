"use client";

import { Suspense, useEffect } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { createClient } from "@/lib/supabase/client";

function CallbackHandler() {
  const router = useRouter();
  const searchParams = useSearchParams();

  useEffect(() => {
    const supabase = createClient();
    const code = searchParams.get("code");

    // Implicit-flow recovery links arrive with #type=recovery in the URL hash
    const hash = typeof window !== "undefined" ? window.location.hash.substring(1) : "";
    const isRecoveryHash = new URLSearchParams(hash).get("type") === "recovery";

    let done = false;
    function finish(target: string) {
      if (done) return;
      done = true;
      router.replace(target);
    }

    const { data: { subscription } } = supabase.auth.onAuthStateChange((event) => {
      // INITIAL_SESSION fires immediately on subscribe with the existing
      // cookie session — ignore it so we can wait for the real post-exchange
      // event (PASSWORD_RECOVERY or SIGNED_IN).
      if (event === "INITIAL_SESSION") return;
      if (event === "PASSWORD_RECOVERY") {
        subscription.unsubscribe();
        finish("/reset-password");
      } else if (event === "SIGNED_IN") {
        subscription.unsubscribe();
        finish(isRecoveryHash ? "/reset-password" : "/dashboard");
      }
    });

    if (code) {
      supabase.auth.exchangeCodeForSession(code).then(({ error }) => {
        if (error) {
          subscription.unsubscribe();
          finish("/login");
        }
      });
    }

    return () => subscription.unsubscribe();
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <div className="min-h-screen bg-[#f4f4f8] dark:bg-[#0f0f17] flex items-center justify-center">
      <p className="text-sm text-gray-400 dark:text-white/30">Verifying…</p>
    </div>
  );
}

export default function AuthCallbackPage() {
  return (
    <Suspense fallback={<div className="min-h-screen" />}>
      <CallbackHandler />
    </Suspense>
  );
}
