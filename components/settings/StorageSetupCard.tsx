"use client";

import { useCallback, useEffect, useState } from "react";
import { AlertTriangle, Check, HardDrive, Loader2, RefreshCw } from "lucide-react";
import { checkStorageUploads, enableStorageUploads } from "@/app/actions/storage-setup";
import { cn } from "@/components/ui/cn";

/**
 * One-time setup that lets the browser upload into the Backblaze bucket.
 * The master key is sent once with the request and never kept.
 */
type Check = Awaited<ReturnType<typeof checkStorageUploads>>;

/** A one-line reading of the probe: does an upload from this page work, and if not, why. */
function verdict(check: Check): { ok: boolean; text: string } {
  if (!check.ok) return { ok: false, text: `Could not check storage: ${check.error}` };
  const { probe } = check;
  if (probe.put.status >= 200 && probe.put.status < 300 && probe.preflight.allowOrigin) {
    return { ok: true, text: `Uploads work from ${probe.origin}.` };
  }
  if (!probe.preflight.allowOrigin) {
    return {
      ok: false,
      text: `Storage does not allow uploads from ${probe.origin} yet (no CORS rule matches it). Enable uploads below while on this address.`,
    };
  }
  return {
    ok: false,
    text: `The CORS rule matches, but storage refused the upload (${probe.put.status}${probe.put.message ? `: ${probe.put.message}` : ""}).`,
  };
}

export default function StorageSetupCard() {
  const [check, setCheck] = useState<Check | null>(null);
  const [checking, setChecking] = useState(false);
  const runCheck = useCallback(async () => {
    setChecking(true);
    setCheck(await checkStorageUploads().catch((error) => ({ ok: false as const, error: String(error) })));
    setChecking(false);
  }, []);
  useEffect(() => {
    void runCheck();
  }, [runCheck]);

  const [keyId, setKeyId] = useState("");
  const [applicationKey, setApplicationKey] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState<string[] | null>(null);

  async function apply() {
    setBusy(true);
    setError(null);
    const result = await enableStorageUploads(keyId, applicationKey);
    setBusy(false);
    // The key leaves the page either way.
    setApplicationKey("");
    if (!result.ok) {
      setError(result.error);
      return;
    }
    setKeyId("");
    setDone(result.origins);
    // Backblaze can take a moment to apply a rule; check again shortly after.
    setTimeout(() => void runCheck(), 4000);
  }

  const reading = check ? verdict(check) : null;

  return (
    <section className="card p-5 sm:p-6">
      <div className="flex items-start gap-3">
        <span className="grid h-9 w-9 shrink-0 place-items-center rounded-lg bg-brand-500/10 text-fire">
          <HardDrive className="h-4 w-4" />
        </span>
        <div className="min-w-0 flex-1">
          <h2 className="text-sm font-bold text-ink">Storage uploads</h2>
          <p className="mt-1 text-sm leading-relaxed text-ink-muted">
            One-time setup so videos, narration and images can upload straight into your Backblaze
            bucket. Backblaze only allows this through its Master Application Key: paste it here once,
            it is used for this single request and never saved.
          </p>
        </div>
      </div>

      <div className="mt-5 rounded-xl border border-edge bg-canvas-subtle px-3.5 py-3">
        <div className="flex items-start gap-2">
          {checking || !reading ? (
            <Loader2 className="mt-0.5 h-4 w-4 shrink-0 animate-spin text-ink-faint" />
          ) : reading.ok ? (
            <Check className="mt-0.5 h-4 w-4 shrink-0 text-success" />
          ) : (
            <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-danger" />
          )}
          <p className="min-w-0 flex-1 text-sm text-ink">
            {checking || !reading ? "Checking storage…" : reading.text}
          </p>
          <button onClick={() => void runCheck()} disabled={checking} className="btn-ghost px-2.5 py-1 text-xs">
            <RefreshCw className="h-3.5 w-3.5" /> Check
          </button>
        </div>
        {check?.ok && (
          <details className="mt-2">
            <summary className="cursor-pointer text-xs text-ink-faint">Details</summary>
            <pre className="mt-2 overflow-x-auto whitespace-pre-wrap break-all rounded-lg bg-canvas p-2.5 font-mono text-[11px] leading-relaxed text-ink-muted">
              {JSON.stringify({ rules: check.rules, probe: check.probe }, null, 2)}
            </pre>
          </details>
        )}
      </div>

      {done ? (
        <p className="mt-5 flex items-start gap-2 rounded-[10px] bg-success-wash px-3.5 py-3 text-sm text-success">
          <Check className="mt-0.5 h-4 w-4 shrink-0" />
          <span>
            Uploads enabled for {done.join(", ")}. Optional, for extra safety: in Backblaze, click
            &ldquo;Generate New Master Application Key&rdquo; - the app uses its own key and is not affected.
          </span>
        </p>
      ) : (
        <div className="mt-5 grid gap-3">
          <label htmlFor="b2-key-id" className="text-[10px] font-bold uppercase tracking-[0.14em] text-ink-faint">
            Master keyID
          </label>
          <input
            id="b2-key-id"
            autoComplete="off"
            spellCheck={false}
            value={keyId}
            onChange={(event) => setKeyId(event.target.value)}
            placeholder="e.g. 7a47bb902424"
            className="input font-mono"
          />
          <label htmlFor="b2-app-key" className="text-[10px] font-bold uppercase tracking-[0.14em] text-ink-faint">
            Master applicationKey
          </label>
          <input
            id="b2-app-key"
            type="password"
            autoComplete="off"
            spellCheck={false}
            value={applicationKey}
            onChange={(event) => setApplicationKey(event.target.value)}
            placeholder="K00…"
            className="input font-mono"
          />
          <p className="text-xs leading-relaxed text-ink-faint">
            Lost the master key? In Backblaze, Application Keys → &ldquo;Generate New Master Application
            Key&rdquo; shows a new one. That does not affect the app.
          </p>
          <div>
            <button onClick={apply} disabled={busy || !keyId.trim() || !applicationKey.trim()} className="btn">
              {busy && <Loader2 className="h-4 w-4 animate-spin" />}
              {busy ? "Applying…" : "Enable uploads"}
            </button>
          </div>
        </div>
      )}

      {error && (
        <p className={cn("mt-4 flex items-start gap-2 rounded-[10px] bg-danger-wash px-3.5 py-3 text-sm text-danger")}>
          <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
          {error}
        </p>
      )}
    </section>
  );
}
