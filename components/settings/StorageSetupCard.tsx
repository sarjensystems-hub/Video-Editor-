"use client";

import { useState } from "react";
import { AlertTriangle, Check, HardDrive, Loader2 } from "lucide-react";
import { enableStorageUploads } from "@/app/actions/storage-setup";
import { cn } from "@/components/ui/cn";

/**
 * One-time setup that lets the browser upload into the Backblaze bucket.
 * The master key is sent once with the request and never kept.
 */
export default function StorageSetupCard() {
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
  }

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
