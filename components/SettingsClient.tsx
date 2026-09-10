"use client";

import ConnectedApps from "@/components/ConnectedApps";

import { useState, useEffect, useTransition } from "react";
import { Moon, Sun, User, Check, Mail, Globe, Trash2, AlertTriangle } from "lucide-react";
import { setTheme } from "@/app/actions/theme";
import { sendPasswordReset } from "@/app/actions/auth";
import { deleteSite } from "@/app/actions/sites";
import { useRouter } from "next/navigation";

const TABS = [
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
}

export default function SettingsClient({ email, sites, activeSiteId }: Props) {
  const router = useRouter();
  const [activeTab, setActiveTab] = useState<TabId>("appearance");
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
    <div className="flex gap-6">
      {/* Sidebar tabs */}
      <div className="w-44 shrink-0">
        <nav className="space-y-0.5">
          {TABS.map(({ id, label, icon: Icon }) => (
            <button
              key={id}
              onClick={() => setActiveTab(id)}
              className={`w-full flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm font-medium transition-all text-left ${
                activeTab === id
                  ? "bg-orange-50 dark:bg-orange-500/15 text-orange-600 dark:text-orange-400"
                  : "text-gray-500 dark:text-white/40 hover:bg-gray-50 dark:hover:bg-white/5 hover:text-gray-800 dark:hover:text-white/70"
              }`}
            >
              <Icon className="w-4 h-4 shrink-0" strokeWidth={1.8} />
              {label}
            </button>
          ))}
        </nav>
      </div>

      {/* Content */}
      <div className="flex-1 min-w-0">
        {/* Appearance */}
        {activeTab === "appearance" && (
          <Card title="Appearance">
            <p className="text-sm text-gray-500 dark:text-white/40 mb-6">
              Choose how Studio looks. Saved automatically.
            </p>
            <div className="flex items-center gap-4">
              <ThemeOption label="Light" icon={Sun}  active={!isDark} onClick={() => toggleTheme(false)} />
              <ThemeOption label="Dark"  icon={Moon} active={isDark}  onClick={() => toggleTheme(true)} />
            </div>
            {isPending && (
              <p className="text-xs text-gray-400 mt-3">Saving preference…</p>
            )}
          </Card>
        )}

        {/* Account */}
        {activeTab === "account" && (
          <div className="space-y-5">
          <Card title="Account">
            <div className="space-y-5">
              <div>
                <p className="text-xs font-medium text-gray-400 dark:text-white/30 uppercase tracking-wider mb-1.5">Email</p>
                <p className="text-sm text-gray-900 dark:text-white bg-gray-50 dark:bg-white/5 border border-gray-100 dark:border-white/10 rounded-lg px-4 py-2.5">
                  {email}
                </p>
              </div>

              <div className="border-t border-gray-100 dark:border-white/8 pt-5">
                <p className="text-xs font-medium text-gray-400 dark:text-white/30 uppercase tracking-wider mb-1.5">Password</p>
                <p className="text-sm text-gray-500 dark:text-white/40 mb-3">
                  We&apos;ll send a password reset link to your email address.
                </p>
                {pwEmailSent ? (
                  <div className="flex items-center gap-2.5 bg-green-50 dark:bg-green-500/10 border border-green-100 dark:border-green-500/20 rounded-xl px-4 py-3">
                    <Check className="w-4 h-4 text-green-500 shrink-0" />
                    <p className="text-sm text-green-700 dark:text-green-400 font-medium">
                      Reset link sent to {email}
                    </p>
                  </div>
                ) : (
                  <button
                    onClick={handleSendPasswordReset}
                    disabled={pwSending}
                    className="btn-ghost flex items-center gap-2"
                  >
                    <Mail className="w-4 h-4" />
                    {pwSending ? "Sending…" : "Send Password Reset Email"}
                  </button>
                )}
              </div>
            </div>
          </Card>

          <Card title="Connected apps">
            <p className="mb-4 text-sm text-ink-muted">
              Assistants holding a Studio connection. Revoking takes effect immediately.
            </p>
            <ConnectedApps />
          </Card>
          </div>
        )}

        {/* Websites */}
        {activeTab === "websites" && (
          <Card title="Websites">
            <p className="text-sm text-gray-500 dark:text-white/40 mb-5">
              Manage the websites connected to your account.
            </p>
            {deleteError && (
              <div className="flex items-center gap-2 bg-red-50 dark:bg-red-500/10 border border-red-100 dark:border-red-500/20 rounded-xl px-4 py-3 mb-4">
                <AlertTriangle className="w-4 h-4 text-red-500 shrink-0" />
                <p className="text-sm text-red-700 dark:text-red-400">{deleteError}</p>
              </div>
            )}
            {sites.length === 0 ? (
              <p className="text-sm text-gray-400 dark:text-white/30">No websites added yet.</p>
            ) : (
              <div className="space-y-2">
                {sites.map((site) => (
                  <div key={site.id} className="flex items-center gap-3 bg-gray-50 dark:bg-white/5 border border-gray-100 dark:border-white/10 rounded-xl px-4 py-3">
                    <Globe className="w-4 h-4 text-gray-400 dark:text-white/30 shrink-0" />
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-medium text-gray-900 dark:text-white truncate">
                        {site.name}
                        {site.id === activeSiteId && (
                          <span className="ml-2 text-[10px] font-medium bg-orange-100 dark:bg-orange-500/20 text-orange-600 dark:text-orange-400 px-1.5 py-0.5 rounded-full">Active</span>
                        )}
                      </p>
                      {site.url && (
                        <p className="text-xs text-gray-400 dark:text-white/30 truncate">{site.url}</p>
                      )}
                    </div>
                    {confirmDeleteId === site.id ? (
                      <div className="flex items-center gap-2 shrink-0">
                        <span className="text-xs text-gray-500 dark:text-white/40">Delete?</span>
                        <button
                          onClick={() => handleDeleteSite(site.id)}
                          disabled={deletingId === site.id}
                          className="text-xs font-medium text-red-600 dark:text-red-400 hover:text-red-700 disabled:opacity-50 px-2 py-1 rounded-lg hover:bg-red-50 dark:hover:bg-red-500/10 transition-colors"
                        >
                          {deletingId === site.id ? "Deleting…" : "Confirm"}
                        </button>
                        <button
                          onClick={() => setConfirmDeleteId(null)}
                          disabled={deletingId === site.id}
                          className="text-xs font-medium text-gray-500 dark:text-white/40 hover:text-gray-700 px-2 py-1 rounded-lg hover:bg-gray-100 dark:hover:bg-white/5 transition-colors"
                        >
                          Cancel
                        </button>
                      </div>
                    ) : (
                      <button
                        onClick={() => { setConfirmDeleteId(site.id); setDeleteError(null); }}
                        className="text-gray-300 dark:text-white/20 hover:text-red-400 transition-colors p-1.5 rounded-lg hover:bg-red-50 dark:hover:bg-red-500/10 shrink-0"
                        title="Delete website"
                      >
                        <Trash2 className="w-4 h-4" />
                      </button>
                    )}
                  </div>
                ))}
              </div>
            )}
          </Card>
        )}

      </div>
    </div>
  );
}

function Card({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="bg-white dark:bg-white/5 border border-gray-100 dark:border-white/10 rounded-2xl p-6">
      <h2 className="text-base font-semibold text-gray-900 dark:text-white mb-5">{title}</h2>
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
      className={`flex flex-col items-center gap-2 w-28 py-5 rounded-xl border-2 transition-all ${
        active
          ? "border-orange-400 dark:border-orange-500 bg-orange-50 dark:bg-orange-500/10"
          : "border-gray-100 dark:border-white/10 hover:border-gray-200 dark:hover:border-white/20"
      }`}
    >
      <Icon
        className={`w-5 h-5 ${active ? "text-orange-500" : "text-gray-400 dark:text-white/30"}`}
        strokeWidth={1.8}
      />
      <span className={`text-sm font-medium ${active ? "text-orange-600 dark:text-orange-400" : "text-gray-500 dark:text-white/40"}`}>
        {label}
      </span>
    </button>
  );
}
