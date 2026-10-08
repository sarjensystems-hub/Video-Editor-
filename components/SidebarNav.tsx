"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import {
  LayoutDashboard,
  Clapperboard,
  Settings,
  PanelLeftClose,
  PanelLeftOpen,
  Video,
  Images,
} from "lucide-react";
import BrandLogo from "@/components/BrandLogo";
import LogoutButton from "@/components/LogoutButton";
import { cn } from "@/components/ui/cn";

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
      { href: "/dashboard/media", label: "Media", icon: Images },
    ],
  },
  {
    label: "Account",
    items: [{ href: "/dashboard/settings", label: "Settings", icon: Settings }],
  },
];

type Props = {
  email: string;
  collapsed: boolean;
  onToggleCollapse: () => void;
};

export default function SidebarNav({
  email,
  collapsed, onToggleCollapse,
}: Props) {
  const pathname = usePathname();
  const isActive = (href: string, exact = false) =>
    exact ? pathname === href : pathname.startsWith(href);

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
