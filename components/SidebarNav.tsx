"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useState } from "react";
import {
  LayoutDashboard,
  Clapperboard,
  Settings,
  ChevronsUpDown,
  Plus,
  Check,
  X,
  PanelLeftClose,
  PanelLeftOpen,
  Video,
} from "lucide-react";
import BrandLogo from "@/components/BrandLogo";
import LogoutButton from "@/components/LogoutButton";
import { cn } from "@/components/ui/cn";
import { switchSite, createSite } from "@/app/actions/sites";

type Site = {
  id: string;
  name: string;
  url: string | null;
  platform: string | null;
  is_default: boolean;
};

/**
 * Nav is grouped rather than flat. Four items do not need sections for
 * findability, but they do need them for meaning: "Create" is where work
 * happens, "Account" is where settings live, and the split stops Settings
 * reading as a fourth creative surface.
 */
const NAV_GROUPS: { label: string; items: { href: string; label: string; icon: React.ElementType; exact?: boolean }[] }[] = [
  {
    label: "Create",
    items: [
      { href: "/dashboard", label: "Dashboard", icon: LayoutDashboard, exact: true },
      { href: "/dashboard/creative-studio", label: "Creative Studio", icon: Clapperboard },
      { href: "/dashboard/videos", label: "Videos", icon: Video },
    ],
  },
  {
    label: "Account",
    items: [{ href: "/dashboard/settings", label: "Settings", icon: Settings }],
  },
];

type Props = {
  email: string;
  sites: Site[];
  activeSiteId: string | null;
  collapsed: boolean;
  onToggleCollapse: () => void;
};

export default function SidebarNav({
  email, sites, activeSiteId,
  collapsed, onToggleCollapse,
}: Props) {
  const pathname = usePathname();
  const [siteMenuOpen, setSiteMenuOpen]   = useState(false);
  const [addingSite, setAddingSite]       = useState(false);
  const [newSiteName, setNewSiteName]     = useState("");
  const [newSiteUrl, setNewSiteUrl]       = useState("");
  const [saving, setSaving]               = useState(false);
  const [siteError, setSiteError]         = useState<string | null>(null);

  const activeSite = sites.find((s) => s.id === activeSiteId) ?? sites[0];

  const isActive = (href: string, exact = false) =>
    exact ? pathname === href : pathname.startsWith(href);

  async function handleSwitchSite(id: string) {
    setSiteMenuOpen(false);
    await switchSite(id);
    window.location.href = window.location.pathname;
  }

  async function handleAddSite() {
    if (!newSiteName.trim()) return;
    setSaving(true);
    setSiteError(null);
    const fd = new FormData();
    fd.append("name", newSiteName);
    fd.append("url", newSiteUrl);
    const result = await createSite(fd);
    setSaving(false);
    if ("error" in result) {
      setSiteError(result.error ?? "Something went wrong");
    } else {
      setAddingSite(false);
      setNewSiteName("");
      setNewSiteUrl("");
      setSiteError(null);
      window.location.href = window.location.pathname;
    }
  }

  return (
    <aside
      className={cn(
        // Desktop only: phones navigate through MobileTopBar and MobileTabBar.
        "fixed inset-y-0 left-0 z-40 hidden flex-col bg-wall lg:flex",
        "transition-[width] duration-200 ease-in-out",
        collapsed ? "w-[68px]" : "w-64",
      )}
    >
      {/* ── Logo row ── */}
      <div className={cn("flex h-16 shrink-0 items-center", collapsed ? "justify-center px-2" : "pl-4 pr-2")}>
        <Link href="/dashboard" className="min-w-0 flex-1">
          {collapsed ? (
            <span className="mx-auto grid h-9 w-9 place-items-center rounded-[11px] bg-gradient-to-br from-brand-400 to-brand-600 text-[15px] font-black text-white">
              S
            </span>
          ) : (
            <BrandLogo className="h-8" onDark />
          )}
        </Link>

        <button
          onClick={onToggleCollapse}
          title={collapsed ? "Expand sidebar" : "Collapse sidebar"}
          aria-label={collapsed ? "Expand sidebar" : "Collapse sidebar"}
          className={cn(
            "shrink-0 rounded-lg p-1.5 text-chalk-dim transition-colors hover:bg-wall-hover hover:text-chalk",
            collapsed && "hidden",
          )}
        >
          <PanelLeftClose className="h-4 w-4" />
        </button>
      </div>

      {collapsed && (
        <div className="px-2 pb-2">
          <button
            onClick={onToggleCollapse}
            title="Expand sidebar"
            aria-label="Expand sidebar"
            className="flex w-full justify-center rounded-lg p-2 text-chalk-dim transition-colors hover:bg-wall-hover hover:text-chalk"
          >
            <PanelLeftOpen className="h-4 w-4" />
          </button>
        </div>
      )}

      {/* ── Workspace switcher ──
          A named object with its own initial, not a globe icon: with several
          workspaces the initial is what tells them apart at a glance. */}
      <div className={cn("relative", collapsed ? "px-2 pb-2" : "px-3 pb-3")}>
        <button
          onClick={() => setSiteMenuOpen(!siteMenuOpen)}
          aria-expanded={siteMenuOpen}
          title={collapsed ? activeSite?.name ?? "Workspace" : undefined}
          className={cn(
            "flex w-full items-center rounded-xl border border-wall-edge bg-wall-hover text-left transition-colors hover:bg-wall-active",
            collapsed ? "justify-center p-2" : "gap-2.5 px-2.5 py-2",
          )}
        >
          <span className="grid h-7 w-7 shrink-0 place-items-center rounded-lg bg-gradient-to-br from-brand-400 to-brand-600 text-[12px] font-bold uppercase text-white">
            {activeSite?.name?.[0] ?? "+"}
          </span>
          {!collapsed && (
            <>
              <span className="min-w-0 flex-1">
                <span className="block truncate text-[13px] font-semibold text-chalk">
                  {activeSite?.name ?? "No workspace"}
                </span>
                <span className="block truncate text-[10px] uppercase tracking-[0.1em] text-chalk-dim">
                  {activeSite ? "Workspace" : "Add your first"}
                </span>
              </span>
              <ChevronsUpDown className="h-3.5 w-3.5 shrink-0 text-chalk-dim" />
            </>
          )}
        </button>

        {siteMenuOpen && !collapsed && (
          <div className="absolute left-3 right-3 top-full z-30 mt-1.5 overflow-hidden rounded-xl border border-edge bg-panel shadow-lg">
            {sites.map((site) => (
              <button
                key={site.id}
                onClick={() => handleSwitchSite(site.id)}
                className="flex w-full items-center gap-2.5 px-3 py-2.5 text-left transition-colors hover:bg-canvas-subtle"
              >
                <span className="grid h-6 w-6 shrink-0 place-items-center rounded-md bg-brand-500/15 text-[11px] font-bold uppercase text-fire">
                  {site.name[0]}
                </span>
                <span className="min-w-0 flex-1 truncate text-[13px] font-medium text-ink">{site.name}</span>
                {site.id === activeSiteId && <Check className="h-3.5 w-3.5 shrink-0 text-fire" />}
              </button>
            ))}

            {!addingSite ? (
              <button
                onClick={() => setAddingSite(true)}
                className="flex w-full items-center gap-2.5 border-t border-edge px-3 py-2.5 text-left text-[13px] text-ink-muted transition-colors hover:bg-canvas-subtle hover:text-ink"
              >
                <Plus className="h-3.5 w-3.5" />
                New workspace
              </button>
            ) : (
              <div className="space-y-2 border-t border-edge p-3">
                <input
                  autoFocus
                  type="text"
                  placeholder="Workspace name"
                  value={newSiteName}
                  onChange={(e) => setNewSiteName(e.target.value)}
                  className="input py-1.5 text-[13px]"
                />
                <input
                  type="text"
                  placeholder="URL (optional)"
                  value={newSiteUrl}
                  onChange={(e) => setNewSiteUrl(e.target.value)}
                  className="input py-1.5 text-[13px]"
                />
                {siteError && <p className="px-0.5 text-[11px] text-danger">{siteError}</p>}
                <div className="flex gap-2">
                  <button
                    onClick={handleAddSite}
                    disabled={saving || !newSiteName.trim()}
                    className="btn flex-1 py-1.5 text-[13px]"
                  >
                    {saving ? "Saving…" : "Add"}
                  </button>
                  <button
                    onClick={() => { setAddingSite(false); setNewSiteName(""); setNewSiteUrl(""); setSiteError(null); }}
                    aria-label="Cancel"
                    className="grid h-8 w-8 place-items-center rounded-lg text-ink-faint transition-colors hover:bg-canvas-muted"
                  >
                    <X className="h-3.5 w-3.5" />
                  </button>
                </div>
              </div>
            )}
          </div>
        )}
      </div>

      {/* ── Main nav ── */}
      <nav className="flex-1 overflow-y-auto px-2.5 pb-4">
        {NAV_GROUPS.map((group) => (
          <div key={group.label} className="mb-5 last:mb-0">
            {!collapsed && (
              <p className="mb-1.5 px-2.5 text-[10px] font-bold uppercase tracking-[0.14em] text-chalk-dim/60">
                {group.label}
              </p>
            )}
            {collapsed && <div className="mx-2 mb-2 h-px bg-wall-edge" />}
            <div className="space-y-0.5">
              {group.items.map((item) => (
                <NavLink
                  key={item.href}
                  href={item.href}
                  label={item.label}
                  icon={item.icon}
                  active={isActive(item.href, item.exact)}
                  collapsed={collapsed}
                />
              ))}
            </div>
          </div>
        ))}
      </nav>

      {/* ── User row ── */}
      <div className={cn("shrink-0 border-t border-wall-edge", collapsed ? "px-2 py-3" : "p-3")}>
        {!collapsed ? (
          <div className="flex items-center gap-2.5 rounded-xl border border-wall-edge bg-wall-hover px-2.5 py-2">
            <span className="grid h-7 w-7 shrink-0 place-items-center rounded-full bg-brand-500/20 text-[11px] font-bold uppercase text-fire">
              {email[0]}
            </span>
            <span className="min-w-0 flex-1">
              <span className="block truncate text-[12px] font-medium text-chalk">{email.split("@")[0]}</span>
              <span className="block truncate text-[10px] text-chalk-dim">{email}</span>
            </span>
            <LogoutButton iconOnly />
          </div>
        ) : (
          <div className="flex flex-col items-center gap-2">
            <span className="grid h-7 w-7 place-items-center rounded-full bg-brand-500/20 text-[11px] font-bold uppercase text-fire">
              {email[0]}
            </span>
            <LogoutButton iconOnly />
          </div>
        )}
      </div>
    </aside>
  );
}

function NavLink({
  href,
  label,
  icon: Icon,
  active,
  collapsed = false,
}: {
  href: string;
  label: string;
  icon: React.ElementType;
  active: boolean;
  collapsed?: boolean;
}) {
  return (
    <Link
      href={href}
      title={collapsed ? label : undefined}
      aria-current={active ? "page" : undefined}
      data-active={active}
      className={cn("rail-link", collapsed && "justify-center px-0 py-2.5")}
    >
      <Icon
        className={cn("h-[18px] w-[18px] shrink-0", active && "text-fire")}
        strokeWidth={active ? 2.2 : 1.8}
      />
      {!collapsed && <span className="truncate">{label}</span>}
    </Link>
  );
}
