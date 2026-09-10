"use client";

import { useState } from "react";
import { Globe } from "lucide-react";
import { Button } from "@/components/ui/Button";
import { createSite } from "@/app/actions/sites";

/**
 * Shown when a page needs a workspace and the account has none.
 *
 * It creates one in place rather than pointing at a control elsewhere: the old
 * copy sent people to a sidebar switcher, which phones no longer show, and
 * which in any case cannot help an account whose workspace list is empty.
 */
export default function NoSiteSelected() {
  const [name, setName] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const create = async () => {
    if (!name.trim()) return;
    setSaving(true);
    setError(null);
    const form = new FormData();
    form.append("name", name);
    form.append("url", "");
    const result = await createSite(form);
    if ("error" in result) {
      setSaving(false);
      setError(result.error ?? "Something went wrong");
      return;
    }
    window.location.reload();
  };

  return (
    <div className="flex min-h-[60vh] items-center justify-center px-4">
      <div className="w-full max-w-sm text-center">
        <div className="mx-auto mb-4 grid h-14 w-14 place-items-center rounded-2xl bg-fire-wash">
          <Globe className="h-7 w-7 text-fire" strokeWidth={1.5} />
        </div>
        <p className="text-sm font-bold text-ink">Create a workspace</p>
        <p className="mx-auto mt-1.5 max-w-xs text-xs leading-relaxed text-ink-muted">
          Workspaces keep projects, assets and generated video separate. You need one to continue.
        </p>

        <form
          className="mt-4 grid gap-2"
          onSubmit={(event) => {
            event.preventDefault();
            void create();
          }}
        >
          <input
            value={name}
            onChange={(event) => setName(event.target.value)}
            placeholder="Workspace name"
            aria-label="Workspace name"
            className="w-full rounded-xl border border-field-edge bg-field px-3 py-2.5 text-base text-ink focus:border-fire/40 focus:outline-none focus:ring-2 focus:ring-fire/30 sm:text-sm"
          />
          {error && <p className="text-xs text-danger">{error}</p>}
          <Button type="submit" variant="primary" block disabled={saving || !name.trim()}>
            {saving ? "Creating" : "Create workspace"}
          </Button>
        </form>
      </div>
    </div>
  );
}
