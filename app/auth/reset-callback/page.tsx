"use client";

import { Suspense, useEffect, useRef } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { createClient } from "@/lib/supabase/client";

function ResetCallbackHandler() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const done = useRef(false);

  useEffect(() => {
    const supabase = createClient();

    function goToReset() {
      if (done.current) return;
      done.current = true;
      router.replace("/reset-password");
    }

    function goToError() {
      if (done.current) return;
      done.current = true;
      router.replace("/forgot-password?error=link-expired");
    }

    async function handle() {
      // Parse hash tokens (implicit flow)
      const hash = window.location.hash.substring(1);
      const params = new URLSearchParams(hash);
      const accessToken = params.get("access_token");
      const refreshToken = params.get("refresh_token");
      const type = params.get("type");

      if (accessToken && refreshToken && type === "recovery") {
        const { error } = await supabase.auth.setSession({
          access_token: accessToken,
          refresh_token: refreshToken,
        });
        if (!error) { goToReset(); return; }
      }

      // PKCE fallback (code in query param)
      const code = searchParams.get("code");
      if (code) {
        const { error } = await supabase.auth.exchangeCodeForSession(code);
        if (!error) { goToReset(); return; }
      }

      goToError();
    }

    handle();
  }, [router, searchParams]);

  return (
    <div className="flex min-h-screen items-center justify-center bg-canvas">
      <p className="text-sm text-ink-faint">Verifying…</p>
    </div>
  );
}

export default function ResetCallbackPage() {
  return (
    <Suspense fallback={<div className="min-h-screen" />}>
      <ResetCallbackHandler />
    </Suspense>
  );
}
