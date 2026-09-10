"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useState } from "react";
import {
  LayoutDashboard,
  Clapperboard,
  Settings,
  ChevronDown,
  Plus,
  Globe,
  Check,
  X,
  PanelLeftClose,
  PanelLeftOpen,
  Video,
} from "lucide-react";
import BrandLogo from "@/components/BrandLogo";
import LogoutButton from "@/components/LogoutButton";
import { switchSite, createSite } from "@/app/actions/sites";

type Site = {
  id: string;
  name: string;
  url: string | null;
  platform: string | null;
  is_default: boolean;
};

const NAV_ITEMS = [
  { href: "/dashboard",                 label: "Dashboard",       icon: LayoutDashboard, exact: true },
  { href: "/dashboard/creative-studio", label: "Creative Studio", icon: Clapperboard },
  { href: "/dashboard/videos",          label: "Videos",          icon: Video },
];

const BOTTOM_ITEMS = [
  { href: "/dashboard/settings", label: "Settings", icon: Settings },
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
      className={[
        // Desktop only: phones navigate through MobileTopBar and MobileTabBar.
        "fixed inset-y-0 left-0 z-40 hidden flex-col lg:flex",
        "border-r transition-all duration-200 ease-in-out",
        collapsed ? "w-16" : "w-60",
      ].join(" ")}
      style={{ backgroundColor: "var(--wall)", borderColor: "var(--wall-edge)" }}
    >
      {/* ── Logo row ── */}
      <div
        className="h-14 flex items-center px-3 border-b flex-shrink-0"
        style={{ borderColor: "var(--wall-edge)" }}
      >
        <Link
          href="/dashboard"
          className={`flex items-center gap-2.5 flex-1 min-w-0 ${collapsed ? "justify-center" : ""}`}
        >
          {collapsed ? (
            <div className="w-8 h-8 rounded-lg bg-orange-500 flex items-center justify-center shrink-0 text-white font-black text-[15px]">S</div>
          ) : (
            <BrandLogo className="h-8" />
          )}
        </Link>

        {/* Collapse toggle — desktop only */}
        {!collapsed && (
          <button
            onClick={onToggleCollapse}
            className="hidden lg:flex p-1.5 rounded-lg transition-colors ml-1 shrink-0"
            style={{ color: "var(--chalk-dim)" }}
            onMouseEnter={e => (e.currentTarget.style.backgroundColor = "var(--wall-hover)")}
            onMouseLeave={e => (e.currentTarget.style.backgroundColor = "transparent")}
            title="Collapse sidebar"
          >
            <PanelLeftClose className="w-4 h-4" />
          </button>
        )}

      </div>

      {/* Expand button when collapsed (desktop) */}
      {collapsed && (
        <div className="px-2 pt-2 border-b pb-2 hidden lg:block" style={{ borderColor: "var(--wall-edge)" }}>
          <button
            onClick={onToggleCollapse}
            className="w-full flex justify-center p-2 rounded-lg transition-colors"
            style={{ color: "var(--chalk-dim)" }}
            onMouseEnter={e => (e.currentTarget.style.backgroundColor = "var(--wall-hover)")}
            onMouseLeave={e => (e.currentTarget.style.backgroundColor = "transparent")}
            title="Expand sidebar"
          >
            <PanelLeftOpen className="w-4 h-4" />
          </button>
        </div>
      )}

      {/* ── Site switcher ── */}
      {!collapsed ? (
        <div className="px-3 py-2.5 border-b relative" style={{ borderColor: "var(--wall-edge)" }}>
          <button
            onClick={() => setSiteMenuOpen(!siteMenuOpen)}
            className="w-full flex items-center gap-2.5 px-2.5 py-2 rounded-lg transition-colors text-left"
            style={{ backgroundColor: "var(--wall-active)" }}
            onMouseEnter={e => (e.currentTarget.style.backgroundColor = "var(--wall-hover)")}
            onMouseLeave={e => (e.currentTarget.style.backgroundColor = "var(--wall-active)")}
          >
            <div className="w-6 h-6 rounded-md bg-orange-500/20 flex items-center justify-center shrink-0">
              <Globe className="w-3.5 h-3.5 text-orange-500" strokeWidth={1.8} />
            </div>
            <div className="flex-1 min-w-0">
              <p className="text-[12px] font-medium truncate" style={{ color: "var(--chalk)" }}>
                {activeSite?.name ?? "No site yet"}
              </p>
              <p className="text-[10px] truncate" style={{ color: "var(--chalk-dim)" }}>
                {activeSite?.url ?? "Add your first site"}
              </p>
            </div>
            <ChevronDown
              className={`w-3.5 h-3.5 shrink-0 transition-transform ${siteMenuOpen ? "rotate-180" : ""}`}
              style={{ color: "var(--chalk-dim)" }}
            />
          </button>

          {siteMenuOpen && (
            <div
              className="absolute left-3 right-3 top-full mt-1 rounded-xl shadow-xl z-30 overflow-hidden border"
              style={{ backgroundColor: "var(--surface)", borderColor: "var(--edge)" }}
            >
              {sites.map((site) => (
                <button
                  key={site.id}
                  onClick={() => handleSwitchSite(site.id)}
                  className="w-full flex items-center gap-2.5 px-3 py-2.5 transition-colors text-left"
                  onMouseEnter={e => (e.currentTarget.style.backgroundColor = "var(--bg-subtle)")}
                  onMouseLeave={e => (e.currentTarget.style.backgroundColor = "transparent")}
                >
                  <div className="w-5 h-5 rounded bg-orange-500/15 flex items-center justify-center shrink-0">
                    <Globe className="w-3 h-3 text-orange-500" strokeWidth={1.8} />
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className="text-[12px] font-medium truncate" style={{ color: "var(--ink)" }}>{site.name}</p>
                  </div>
                  {site.id === activeSiteId && (
                    <Check className="w-3.5 h-3.5 text-orange-500 shrink-0" />
                  )}
                </button>
              ))}

              {!addingSite ? (
                <button
                  onClick={() => setAddingSite(true)}
                  className="w-full flex items-center gap-2.5 px-3 py-2.5 border-t transition-colors text-left"
                  style={{ borderColor: "var(--edge)" }}
                  onMouseEnter={e => (e.currentTarget.style.backgroundColor = "var(--bg-subtle)")}
                  onMouseLeave={e => (e.currentTarget.style.backgroundColor = "transparent")}
                >
                  <Plus className="w-3.5 h-3.5" style={{ color: "var(--ink-faint)" }} />
                  <span className="text-[12px]" style={{ color: "var(--ink-faint)" }}>Add new site</span>
                </button>
              ) : (
                <div className="p-3 border-t space-y-2" style={{ borderColor: "var(--edge)" }}>
                  <input
                    autoFocus
                    type="text"
                    placeholder="Site name (e.g. My Store)"
                    value={newSiteName}
                    onChange={(e) => setNewSiteName(e.target.value)}
                    className="w-full rounded-lg px-2.5 py-1.5 text-[12px] outline-none border"
                    style={{
                      backgroundColor: "var(--bg-subtle)",
                      borderColor: "var(--edge)",
                      color: "var(--ink)",
                    }}
                    onFocus={e => (e.currentTarget.style.borderColor = "var(--fire)")}
                    onBlur={e => (e.currentTarget.style.borderColor = "var(--edge)")}
                  />
                  <input
                    type="text"
                    placeholder="URL (optional)"
                    value={newSiteUrl}
                    onChange={(e) => setNewSiteUrl(e.target.value)}
                    className="w-full rounded-lg px-2.5 py-1.5 text-[12px] outline-none border"
                    style={{
                      backgroundColor: "var(--bg-subtle)",
                      borderColor: "var(--edge)",
                      color: "var(--ink)",
                    }}
                    onFocus={e => (e.currentTarget.style.borderColor = "var(--fire)")}
                    onBlur={e => (e.currentTarget.style.borderColor = "var(--edge)")}
                  />
                  {siteError && (
                    <p className="text-[11px] text-red-500 px-0.5">{siteError}</p>
                  )}
                  <div className="flex gap-2">
                    <button
                      onClick={handleAddSite}
                      disabled={saving || !newSiteName.trim()}
                      className="flex-1 bg-orange-500 hover:bg-orange-600 disabled:opacity-40 text-white text-[12px] font-medium py-1.5 rounded-lg transition-colors"
                    >
                      {saving ? "Saving…" : "Add Site"}
                    </button>
                    <button
                      onClick={() => { setAddingSite(false); setNewSiteName(""); setNewSiteUrl(""); setSiteError(null); }}
                      className="w-8 h-8 flex items-center justify-center rounded-lg transition-colors"
                      onMouseEnter={e => (e.currentTarget.style.backgroundColor = "var(--bg-muted)")}
                      onMouseLeave={e => (e.currentTarget.style.backgroundColor = "transparent")}
                    >
                      <X className="w-3.5 h-3.5" style={{ color: "var(--ink-faint)" }} />
                    </button>
                  </div>
                </div>
              )}
            </div>
          )}
        </div>
      ) : (
        /* Icon-only site pill */
        <div className="px-2 py-2.5 border-b" style={{ borderColor: "var(--wall-edge)" }}>
          <button
            onClick={() => setSiteMenuOpen(!siteMenuOpen)}
            className="w-full flex justify-center p-2 rounded-lg transition-colors"
            onMouseEnter={e => (e.currentTarget.style.backgroundColor = "var(--wall-hover)")}
            onMouseLeave={e => (e.currentTarget.style.backgroundColor = "transparent")}
            title={activeSite?.name ?? "Sites"}
          >
            <Globe className="w-4 h-4 text-orange-500" />
          </button>
        </div>
      )}

      {/* ── Main nav ── */}
      <nav className="flex-1 px-2 py-4 overflow-y-auto">
        {!collapsed && (
          <p
            className="text-[10px] font-bold uppercase tracking-widest px-2.5 mb-2"
            style={{ color: "var(--chalk-dim)", opacity: 0.5 }}
          >
            Workspace
          </p>
        )}
        <div className="space-y-0.5">
          {NAV_ITEMS.map((item) => (
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
      </nav>

      {/* ── Bottom pinned ── */}
      <div className="px-2 pb-3 border-t pt-3" style={{ borderColor: "var(--wall-edge)" }}>
        <div className="space-y-0.5 mb-2">
          {BOTTOM_ITEMS.map((item) => (
            <NavLink
              key={item.href}
              href={item.href}
              label={item.label}
              icon={item.icon}
              active={isActive(item.href)}
              collapsed={collapsed}
            />
          ))}
        </div>

        {/* User row */}
        {!collapsed ? (
          <div className="flex items-center gap-2.5 px-2.5 py-2 rounded-lg">
            <div className="w-7 h-7 rounded-full bg-orange-500/20 flex items-center justify-center text-orange-500 text-[11px] font-bold uppercase shrink-0">
              {email[0]}
            </div>
            <p className="text-[11px] truncate flex-1" style={{ color: "var(--chalk-dim)" }}>{email}</p>
            <LogoutButton iconOnly />
          </div>
        ) : (
          <div className="flex flex-col items-center gap-2 pt-1">
            <div className="w-7 h-7 rounded-full bg-orange-500/20 flex items-center justify-center text-orange-500 text-[11px] font-bold uppercase">
              {email[0]}
            </div>
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
      className={[
        "flex items-center rounded-lg text-[13px] font-medium transition-all",
        collapsed ? "justify-center p-2" : "gap-2.5 px-2.5 py-[7px]",
        active ? "border-l-[2px] border-orange-500" : "border-l-[2px] border-transparent",
      ].join(" ")}
      style={{
        backgroundColor: active ? "var(--wall-active)" : "transparent",
        color: active ? "var(--chalk)" : "var(--chalk-dim)",
        paddingLeft: active && !collapsed ? "calc(0.625rem - 2px)" : undefined,
      }}
      onMouseEnter={e => {
        if (!active) e.currentTarget.style.backgroundColor = "var(--wall-hover)";
        if (!active) e.currentTarget.style.color = "var(--chalk)";
      }}
      onMouseLeave={e => {
        if (!active) e.currentTarget.style.backgroundColor = "transparent";
        if (!active) e.currentTarget.style.color = "var(--chalk-dim)";
      }}
    >
      <Icon
        className={`shrink-0 ${collapsed ? "w-[18px] h-[18px]" : "w-4 h-4"} ${active ? "text-orange-500" : ""}`}
        strokeWidth={active ? 2.2 : 1.8}
      />
      {!collapsed && <span className="truncate">{label}</span>}
      {!collapsed && active && (
        <span className="ml-auto w-1.5 h-1.5 rounded-full bg-orange-500 shrink-0" />
      )}
    </Link>
  );
}
