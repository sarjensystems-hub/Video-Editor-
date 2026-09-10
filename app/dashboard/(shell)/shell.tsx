"use client";

import { useState } from "react";
import SidebarNav from "@/components/SidebarNav";
import { MobileTabBar, MobileTopBar, type Workspace } from "@/components/MobileNav";
import { cn } from "@/components/ui/cn";

export default function DashboardShell({
  children,
  email,
  sites,
  activeSiteId,
}: {
  children: React.ReactNode;
  email: string;
  sites: Workspace[];
  activeSiteId: string | null;
}) {
  const [collapsed, setCollapsed] = useState(false);

  return (
    <div className="min-h-[100dvh] bg-canvas">
      {/* Phones get a top bar and thumb-reachable tabs rather than a drawer:
          a hidden hamburger menu costs two taps to reach anything. */}
      <MobileTopBar
        email={email}
        workspaces={sites}
        activeWorkspaceId={activeSiteId}
      />

      <SidebarNav
        email={email}
        sites={sites}
        activeSiteId={activeSiteId}
        collapsed={collapsed}
        onToggleCollapse={() => setCollapsed(!collapsed)}
      />

      <main
        className={cn(
          "flex min-h-[calc(100dvh-7rem)] flex-col transition-[margin-left] duration-200 ease-in-out lg:min-h-[100dvh]",
          // Both widths are written out so Tailwind's scanner keeps them.
          collapsed ? "lg:ml-16" : "lg:ml-60",
        )}
      >
        {children}
      </main>

      <MobileTabBar />
    </div>
  );
}
