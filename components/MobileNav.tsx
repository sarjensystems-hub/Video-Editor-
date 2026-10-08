"use client";

import { useState } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { Clapperboard, LayoutDashboard, Settings, Video } from "lucide-react";
import BrandLogo from "@/components/BrandLogo";
import LogoutButton from "@/components/LogoutButton";
import Sheet from "@/components/ui/Sheet";
import { cn } from "@/components/ui/cn";

const TABS = [
  { href: "/dashboard", label: "Home", icon: LayoutDashboard, exact: true },
  { href: "/dashboard/creative-studio", label: "Studio", icon: Clapperboard },
  { href: "/dashboard/videos", label: "Videos", icon: Video },
  { href: "/dashboard/settings", label: "Settings", icon: Settings },
];

export function MobileTopBar({ email }: { email: string }) {
  const [accountOpen, setAccountOpen] = useState(false);

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
            aria-label="Account"
            className="grid h-9 w-9 place-items-center rounded-full bg-gradient-to-br from-brand-400 to-brand-600 text-sm font-bold uppercase text-white"
          >
            {email[0] ?? "?"}
          </button>
        </div>
      </header>

      <Sheet open={accountOpen} onClose={() => setAccountOpen(false)} title="Account">
        <div className="grid gap-4 pb-2">
          <div>
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
