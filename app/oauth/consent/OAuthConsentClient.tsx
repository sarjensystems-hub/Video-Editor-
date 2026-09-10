"use client";

import { useState } from "react";
import { Check, ShieldCheck, X } from "lucide-react";
import { Button } from "@/components/ui/Button";

const GRANTS = [
  "Create and edit your Creative Studio projects",
  "Upload and generate assets in your account",
  "Render frames and export video",
  "Spend credits on generation and rendering",
];

export default function OAuthConsentClient({
  clientName,
  email,
  params,
}: {
  clientName: string;
  email: string;
  params: Record<string, string>;
}) {
  const [busy, setBusy] = useState<"approve" | "deny" | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function decide(decision: "approve" | "deny") {
    setBusy(decision);
    setError(null);
    try {
      const response = await fetch("/api/oauth/consent", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ ...params, decision }),
      });
      const payload = await response.json();
      if (!response.ok || !payload.redirect) {
        throw new Error(payload.error ?? "Could not complete the request");
      }
      // Back to the client that started this, carrying the code or the refusal.
      window.location.assign(payload.redirect as string);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
      setBusy(null);
    }
  }

  return (
    <div>
      <div className="mb-1 flex items-center gap-2 text-fire">
        <ShieldCheck className="h-4 w-4" />
        <span className="text-[11px] font-bold uppercase tracking-[0.1em]">Authorize access</span>
      </div>

      <h1 className="text-xl font-semibold tracking-tight text-ink">
        Connect <span className="text-fire">{clientName}</span> to Studio?
      </h1>
      <p className="mt-1.5 text-xs text-ink-muted">
        Signed in as {email}
      </p>

      <p className="mt-5 text-[11px] font-bold uppercase tracking-[0.08em] text-ink-faint">
        It will be able to
      </p>
      <ul className="mt-2.5 grid gap-2">
        {GRANTS.map((grant) => (
          <li key={grant} className="flex items-start gap-2.5 text-sm text-ink-muted">
            <Check className="mt-0.5 h-4 w-4 shrink-0 text-fire" />
            {grant}
          </li>
        ))}
      </ul>

      <p className="mt-4 text-xs leading-relaxed text-ink-faint">
        You can revoke this at any time from Settings. Revoking takes effect immediately.
      </p>

      {error && (
        <p className="mt-4 rounded-lg bg-danger-wash px-3 py-2 text-xs text-danger">{error}</p>
      )}

      <div className="mt-6 flex flex-col-reverse gap-2 sm:flex-row">
        <Button variant="ghost" block disabled={busy !== null} onClick={() => decide("deny")}>
          <X className="h-4 w-4" /> {busy === "deny" ? "Cancelling" : "Cancel"}
        </Button>
        <Button variant="primary" block disabled={busy !== null} onClick={() => decide("approve")}>
          <Check className="h-4 w-4" /> {busy === "approve" ? "Connecting" : "Allow access"}
        </Button>
      </div>
    </div>
  );
}
