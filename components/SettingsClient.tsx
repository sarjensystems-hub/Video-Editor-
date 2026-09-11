"use client";

import ConnectedApps from "@/components/ConnectedApps";

import { useState, useEffect, useTransition } from "react";
import { Moon, Sun, User, Check, Mail, Globe, Trash2, AlertTriangle, KeyRound } from "lucide-react";
import { setTheme } from "@/app/actions/theme";
import { sendPasswordReset } from "@/app/actions/auth";
import { deleteSite } from "@/app/actions/sites";
import { useRouter } from "next/navigation";
import { cn } from "@/components/ui/cn";
import ApiKeysCard from "@/components/settings/ApiKeysCard";
import type { OpenRouterKeyStatus } from "@/lib/openrouter-key";

const TABS = [
  { id: "keys",       label: "API keys",   icon: KeyRound },
  { id: "appearance", label: "Appearance", icon: Sun },
  { id: "account",    label: "Account",    icon: User },
  { id: "websites",   label: "Websites",   icon: Globe },
] as const;

type TabId = typeof TABS[number]["id"];

type Site = { id: string; name: string; url: string | null; platform: string | null };

interface Props {
  email: string;
  sites: Site[];
  activeSiteId: string | null;
  keyStatus: OpenRouterKeyStatus;
}

export default function SettingsClient({ email, sites, activeSiteId, keyStatus }: Props) {
  const router = useRouter();
  // An account with no key of its own cannot generate anything, so that is the
  // tab worth opening on until one is saved.
  const [activeTab, setActiveTab] = useState<TabId>(keyStatus.configured ? "appearance" : "keys");
  const [isDark, setIsDark] = useState(false);
  const [isPending, startTransition] = useTransition();
  const [pwEmailSent, setPwEmailSent] = useState(false);
  const [pwSending, setPwSending] = useState(false);
  const [confirmDeleteId, setConfirmDeleteId] = useState<string | null>(null);
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [deleteError, setDeleteError] = useState<string | null>(null);

  useEffect(() => {
    setIsDark(document.documentElement.classList.contains("dark"));
  }, []);

  function toggleTheme(dark: boolean) {
    document.documentElement.classList.toggle("dark", dark);
    setIsDark(dark);
    startTransition(() => {
      setTheme(dark ? "dark" : "light");
    });
  }

  async function handleDeleteSite(siteId: string) {
    setDeletingId(siteId);
    setDeleteError(null);
    const result = await deleteSite(siteId);
    setDeletingId(null);
    setConfirmDeleteId(null);
    if (result.error) {
      setDeleteError(result.error);
    } else {
      router.refresh();
    }
  }

  async function handleSendPasswordReset() {
    setPwSending(true);
    await sendPasswordReset(email);
    setPwSending(false);
    setPwEmailSent(true);
  }

  return (
    /* Tabs are a scrolling row on a phone and a column on a desktop: the same
       three destinations, placed where the pointer already is. */
    <div className="flex flex-col gap-6 lg:flex-row lg:gap-8">
      <nav className="-mx-1 flex shrink-0 gap-1 overflow-x-auto px-1 pb-1 lg:mx-0 lg:w-48 lg:flex-col lg:overflow-visible lg:px-0">
        {TABS.map(({ id, label, icon: Icon }) => (
          <button
            key={id}
            onClick={() => setActiveTab(id)}
            aria-current={activeTab === id ? "page" : undefined}
            className={cn(
              "flex shrink-0 items-center gap-2.5 rounded-[10px] px-3 py-2.5 text-sm font-medium transition-colors",
              activeTab === id
                ? "bg-brand-500/10 text-fire"
                : "text-ink-muted hover:bg-canvas-subtle hover:text-ink",
            )}
          >
            <Icon className="h-4 w-4 shrink-0" strokeWidth={1.8} />
            {label}
          </button>
        ))}
      </nav>

      <div className="min-w-0 flex-1">
        {activeTab === "keys" && <ApiKeysCard initialStatus={keyStatus} />}

        {activeTab === "appearance" && (
          <Card title="Appearance" hint="Choose how Studio looks. Saved automatically.">
            <div className="flex flex-wrap items-center gap-3">
              <ThemeOption label="Light" icon={Sun}  active={!isDark} onClick={() => toggleTheme(false)} />
              <ThemeOption label="Dark"  icon={Moon} active={isDark}  onClick={() => toggleTheme(true)} />
            </div>
            {isPending && <p className="mt-3 text-xs text-ink-faint">Saving preference…</p>}
          </Card>
        )}

        {activeTab === "account" && (
          <div className="grid gap-4">
            <Card title="Account">
              <div className="grid gap-5">
                <Row label="Email">
                  <p className="rounded-[10px] border border-edge bg-canvas-subtle px-3.5 py-2.5 text-sm text-ink">
                    {email}
                  </p>
                </Row>

                <Row label="Password">
                  <p className="mb-3 text-sm text-ink-muted">
                    We&apos;ll send a password reset link to your email address.
                  </p>
                  {pwEmailSent ? (
                    <div className="flex items-center gap-2.5 rounded-[10px] bg-success-wash px-3.5 py-3">
                      <Check className="h-4 w-4 shrink-0 text-success" />
                      <p className="text-sm font-medium text-success">Reset link sent to {email}</p>
                    </div>
                  ) : (
                    <button onClick={handleSendPasswordReset} disabled={pwSending} className="btn-ghost">
                      <Mail className="h-4 w-4" />
                      {pwSending ? "Sending…" : "Send reset email"}
                    </button>
                  )}
                </Row>
              </div>
            </Card>

            <Card
              title="Connected apps"
              hint="Assistants holding a Studio connection. Revoking takes effect immediately."
            >
              <ConnectedApps />
            </Card>
          </div>
        )}

        {activeTab === "websites" && (
          <Card title="Websites" hint="Manage the websites connected to your account.">
            {deleteError && (
              <div className="mb-4 flex items-center gap-2 rounded-[10px] bg-danger-wash px-3.5 py-3">
                <AlertTriangle className="h-4 w-4 shrink-0 text-danger" />
                <p className="text-sm text-danger">{deleteError}</p>
              </div>
            )}
            {sites.length === 0 ? (
              <p className="text-sm text-ink-faint">No websites added yet.</p>
            ) : (
              <ul className="grid gap-2">
                {sites.map((site) => (
                  <li
                    key={site.id}
                    className="flex items-center gap-3 rounded-xl border border-edge bg-canvas-subtle px-3.5 py-3"
                  >
                    <span className="grid h-8 w-8 shrink-0 place-items-center rounded-lg bg-brand-500/10 text-fire">
                      <Globe className="h-4 w-4" />
                    </span>
                    <div className="min-w-0 flex-1">
                      <p className="flex items-center gap-2 truncate text-sm font-medium text-ink">
                        {site.name}
                        {site.id === activeSiteId && (
                          <span className="rounded-full bg-brand-500/15 px-1.5 py-0.5 text-[10px] font-bold uppercase tracking-wide text-fire">
                            Active
                          </span>
                        )}
                      </p>
                      {site.url && <p className="truncate text-xs text-ink-faint">{site.url}</p>}
                    </div>
                    {confirmDeleteId === site.id ? (
                      <div className="flex shrink-0 items-center gap-1">
                        <button
                          onClick={() => handleDeleteSite(site.id)}
                          disabled={deletingId === site.id}
                          className="rounded-lg px-2 py-1 text-xs font-bold text-danger transition-colors hover:bg-danger-wash disabled:opacity-50"
                        >
                          {deletingId === site.id ? "Deleting…" : "Confirm"}
                        </button>
                        <button
                          onClick={() => setConfirmDeleteId(null)}
                          disabled={deletingId === site.id}
                          className="rounded-lg px-2 py-1 text-xs font-medium text-ink-muted transition-colors hover:bg-canvas-muted"
                        >
                          Cancel
                        </button>
                      </div>
                    ) : (
                      <button
                        onClick={() => { setConfirmDeleteId(site.id); setDeleteError(null); }}
                        className="shrink-0 rounded-lg p-1.5 text-ink-faint transition-colors hover:bg-danger-wash hover:text-danger"
                        title="Delete website"
                      >
                        <Trash2 className="h-4 w-4" />
                      </button>
                    )}
                  </li>
                ))}
              </ul>
            )}
          </Card>
        )}
      </div>
    </div>
  );
}

function Card({ title, hint, children }: { title: string; hint?: string; children: React.ReactNode }) {
  return (
    <section className="card p-5 sm:p-6">
      <h2 className="text-sm font-bold text-ink">{title}</h2>
      {hint && <p className="mt-1 mb-5 text-sm text-ink-muted">{hint}</p>}
      <div className={hint ? "" : "mt-5"}>{children}</div>
    </section>
  );
}

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="border-t border-edge-faint pt-5 first:border-0 first:pt-0">
      <p className="mb-1.5 text-[10px] font-bold uppercase tracking-[0.14em] text-ink-faint">{label}</p>
      {children}
    </div>
  );
}

function ThemeOption({
  label, icon: Icon, active, onClick,
}: {
  label: string;
  icon: React.ElementType;
  active: boolean;
  onClick: () => void;
}) {
  return (
    <button
      onClick={onClick}
      aria-pressed={active}
      className={cn(
        "flex w-32 flex-col items-center gap-2 rounded-xl border py-5 transition-all",
        active
          ? "border-brand-400 bg-brand-500/10"
          : "border-edge hover:border-brand-300 hover:bg-canvas-subtle",
      )}
    >
      <Icon className={cn("h-5 w-5", active ? "text-fire" : "text-ink-faint")} strokeWidth={1.8} />
      <span className={cn("text-sm font-medium", active ? "text-fire" : "text-ink-muted")}>{label}</span>
    </button>
  );
}
