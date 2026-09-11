"use client";

import { useState } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { Check, Clapperboard, LayoutDashboard, Plus, Settings, Video } from "lucide-react";
import BrandLogo from "@/components/BrandLogo";
import LogoutButton from "@/components/LogoutButton";
import Sheet from "@/components/ui/Sheet";
import { Button } from "@/components/ui/Button";
import { cn } from "@/components/ui/cn";
import { createSite, switchSite } from "@/app/actions/sites";

export type Workspace = {
  id: string;
  name: string;
  url: string | null;
  platform: string | null;
  is_default: boolean;
};

const TABS = [
  { href: "/dashboard", label: "Home", icon: LayoutDashboard, exact: true },
  { href: "/dashboard/creative-studio", label: "Studio", icon: Clapperboard },
  { href: "/dashboard/videos", label: "Videos", icon: Video },
  { href: "/dashboard/settings", label: "Settings", icon: Settings },
];

export function MobileTopBar({
  email,
  workspaces,
  activeWorkspaceId,
}: {
  email: string;
  workspaces: Workspace[];
  activeWorkspaceId: string | null;
}) {
  const [accountOpen, setAccountOpen] = useState(false);
  const [adding, setAdding] = useState(false);
  const [name, setName] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const active = workspaces.find((item) => item.id === activeWorkspaceId) ?? workspaces[0];

  const pick = async (id: string) => {
    await switchSite(id);
    window.location.reload();
  };

  const add = async () => {
    if (!name.trim()) return;
    setSaving(true);
    setError(null);
    const form = new FormData();
    form.append("name", name);
    form.append("url", "");
    const result = await createSite(form);
    setSaving(false);
    if ("error" in result) {
      setError(result.error ?? "Something went wrong");
      return;
    }
    window.location.reload();
  };

  return (
    <>
      <header className="sticky top-0 z-30 flex h-14 items-center gap-3 border-b border-wall-edge bg-wall px-4 lg:hidden">
        <Link href="/dashboard">
          <BrandLogo className="h-7" onDark />
        </Link>

        <div className="ml-auto flex items-center gap-2">
          <button
            type="button"
            onClick={() => setAccountOpen(true)}
            aria-label="Account and workspace"
            className="grid h-9 w-9 place-items-center rounded-full bg-gradient-to-br from-brand-400 to-brand-600 text-sm font-bold uppercase text-white"
          >
            {email[0] ?? "?"}
          </button>
        </div>
      </header>

      <Sheet open={accountOpen} onClose={() => setAccountOpen(false)} title="Account">
        <div className="grid gap-4 pb-2">
          <div>
            <p className="mb-2 text-[11px] font-bold uppercase tracking-[0.08em] text-ink-faint">Workspace</p>
            <ul className="grid gap-1.5">
              {workspaces.map((workspace) => (
                <li key={workspace.id}>
                  <button
                    type="button"
                    onClick={() => pick(workspace.id)}
                    className={cn(
                      "flex min-h-11 w-full items-center justify-between gap-2 rounded-xl border px-3 text-left text-sm",
                      workspace.id === active?.id
                        ? "border-fire/50 bg-fire-wash text-ink"
                        : "border-edge bg-panel text-ink-muted",
                    )}
                  >
                    <span className="truncate">{workspace.name}</span>
                    {workspace.id === active?.id && <Check className="h-4 w-4 shrink-0 text-fire" />}
                  </button>
                </li>
              ))}
            </ul>

            {adding ? (
              <div className="mt-2 grid gap-2">
                <input
                  autoFocus
                  value={name}
                  onChange={(event) => setName(event.target.value)}
                  placeholder="Workspace name"
                  className="input text-base"
                />
                {error && <p className="text-xs text-danger">{error}</p>}
                <div className="flex gap-2">
                  <Button variant="primary" block disabled={saving || !name.trim()} onClick={add}>
                    {saving ? "Adding" : "Add workspace"}
                  </Button>
                  <Button variant="ghost" onClick={() => setAdding(false)}>
                    Cancel
                  </Button>
                </div>
              </div>
            ) : (
              <Button variant="ghost" block className="mt-2" onClick={() => setAdding(true)}>
                <Plus className="h-4 w-4" /> New workspace
              </Button>
            )}
          </div>

          <div className="border-t border-edge-faint pt-3">
            <p className="mb-2 truncate text-xs text-ink-muted">{email}</p>
            <LogoutButton />
          </div>
        </div>
      </Sheet>
    </>
  );
}

export function MobileTabBar() {
  const pathname = usePathname();

  return (
    <nav
      aria-label="Main"
      className="sticky bottom-0 z-30 flex items-center gap-1 border-t border-wall-edge bg-wall px-2 pb-[max(0.375rem,env(safe-area-inset-bottom))] pt-1.5 lg:hidden"
    >
      {TABS.map((tab) => {
        const active = tab.exact ? pathname === tab.href : pathname.startsWith(tab.href);
        const Icon = tab.icon;
        return (
          <Link
            key={tab.href}
            href={tab.href}
            aria-current={active ? "page" : undefined}
            className={cn(
              "flex min-h-12 flex-1 flex-col items-center justify-center gap-0.5 rounded-xl text-[10px] font-semibold transition-colors",
              active ? "bg-wall-active text-fire" : "text-chalk-dim hover:text-chalk",
            )}
          >
            <Icon className="h-5 w-5" />
            {tab.label}
          </Link>
        );
      })}
    </nav>
  );
}
