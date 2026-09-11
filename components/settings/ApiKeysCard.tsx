"use client";

import { useState } from "react";
import { AlertTriangle, Check, KeyRound, Loader2, Trash2 } from "lucide-react";
import {
  removeOpenRouterKey,
  saveOpenRouterKey,
  testStoredOpenRouterKey,
} from "@/app/actions/api-keys";
import type { OpenRouterKeyStatus } from "@/lib/openrouter-key";
import { cn } from "@/components/ui/cn";

/**
 * Where an account brings its own OpenRouter key.
 *
 * The stored key never comes back to the browser — the server sends only the
 * last four characters, which is enough to recognise which key is in place and
 * useless to anyone who intercepts it. "Replace" is therefore the only edit:
 * there is no field to load an existing key into.
 */
export default function ApiKeysCard({ initialStatus }: { initialStatus: OpenRouterKeyStatus }) {
  const [status, setStatus] = useState(initialStatus);
  const [value, setValue] = useState("");
  const [editing, setEditing] = useState(!initialStatus.configured);
  const [busy, setBusy] = useState<"save" | "test" | "remove" | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  async function handleSave() {
    setBusy("save");
    setError(null);
    setNotice(null);
    const result = await saveOpenRouterKey(value);
    setBusy(null);

    if (!result.ok) {
      setError(result.error);
      return;
    }

    setStatus({ ...status, configured: true, last4: result.last4, setAt: new Date().toISOString() });
    setValue("");
    setEditing(false);
    setNotice(result.label ? `Key verified — OpenRouter calls it “${result.label}”.` : "Key verified and saved.");
  }

  async function handleTest() {
    setBusy("test");
    setError(null);
    setNotice(null);
    const result = await testStoredOpenRouterKey();
    setBusy(null);
    if (result.ok) setNotice("Key works — OpenRouter accepted it.");
    else setError(result.error);
  }

  async function handleRemove() {
    setBusy("remove");
    setError(null);
    setNotice(null);
    const result = await removeOpenRouterKey();
    setBusy(null);
    if (!result.ok) {
      setError(result.error);
      return;
    }
    setStatus({ ...status, configured: false, last4: null, setAt: null });
    setEditing(true);
  }

  return (
    <section className="card p-5 sm:p-6">
      <div className="flex items-start gap-3">
        <span className="grid h-9 w-9 shrink-0 place-items-center rounded-lg bg-brand-500/10 text-fire">
          <KeyRound className="h-4 w-4" />
        </span>
        <div className="min-w-0 flex-1">
          <h2 className="text-sm font-bold text-ink">OpenRouter</h2>
          <p className="mt-1 text-sm leading-relaxed text-ink-muted">
            Generation runs on your own OpenRouter account — text, images, speech, music and video
            are all billed there. Create a key at{" "}
            <a
              href="https://openrouter.ai/keys"
              target="_blank"
              rel="noreferrer"
              className="font-medium text-fire hover:underline"
            >
              openrouter.ai/keys
            </a>
            .
          </p>
        </div>
      </div>

      <div className="mt-5">
        {status.configured && !editing ? (
          <div className="flex flex-wrap items-center gap-3 rounded-xl border border-edge bg-canvas-subtle px-3.5 py-3">
            <span className="grid h-7 w-7 shrink-0 place-items-center rounded-full bg-success-wash text-success">
              <Check className="h-4 w-4" />
            </span>
            <div className="min-w-0 flex-1">
              <p className="font-mono text-sm text-ink">sk-or-…{status.last4}</p>
              {status.setAt && (
                <p className="text-xs text-ink-faint">
                  Added {new Date(status.setAt).toLocaleDateString()}
                </p>
              )}
            </div>
            <div className="flex shrink-0 items-center gap-1.5">
              <button onClick={handleTest} disabled={busy !== null} className="btn-ghost px-3 py-1.5 text-xs">
                {busy === "test" ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : null}
                Test
              </button>
              <button onClick={() => setEditing(true)} disabled={busy !== null} className="btn-ghost px-3 py-1.5 text-xs">
                Replace
              </button>
              <button
                onClick={handleRemove}
                disabled={busy !== null}
                aria-label="Remove key"
                title="Remove key"
                className="rounded-lg p-2 text-ink-faint transition-colors hover:bg-danger-wash hover:text-danger"
              >
                {busy === "remove" ? <Loader2 className="h-4 w-4 animate-spin" /> : <Trash2 className="h-4 w-4" />}
              </button>
            </div>
          </div>
        ) : (
          <div className="grid gap-3">
            <label htmlFor="openrouter-key" className="text-[10px] font-bold uppercase tracking-[0.14em] text-ink-faint">
              API key
            </label>
            <input
              id="openrouter-key"
              type="password"
              autoComplete="off"
              spellCheck={false}
              value={value}
              onChange={(event) => setValue(event.target.value)}
              placeholder="sk-or-v1-…"
              className="input font-mono"
            />
            <div className="flex flex-wrap items-center gap-2">
              <button onClick={handleSave} disabled={busy !== null || !value.trim()} className="btn">
                {busy === "save" && <Loader2 className="h-4 w-4 animate-spin" />}
                {busy === "save" ? "Verifying…" : "Save key"}
              </button>
              {status.configured && (
                <button
                  onClick={() => { setEditing(false); setValue(""); setError(null); }}
                  disabled={busy !== null}
                  className="btn-ghost"
                >
                  Cancel
                </button>
              )}
            </div>
          </div>
        )}
      </div>

      {(error || notice) && (
        <p
          className={cn(
            "mt-4 flex items-start gap-2 rounded-[10px] px-3.5 py-3 text-sm",
            error ? "bg-danger-wash text-danger" : "bg-success-wash text-success",
          )}
        >
          {error ? <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" /> : <Check className="mt-0.5 h-4 w-4 shrink-0" />}
          {error ?? notice}
        </p>
      )}

      {!status.configured && (
        <p className="mt-4 text-xs leading-relaxed text-ink-faint">
          Until a key is saved, generation is unavailable on this account — everything else keeps
          working. There is no shared key behind it.
        </p>
      )}
    </section>
  );
}
