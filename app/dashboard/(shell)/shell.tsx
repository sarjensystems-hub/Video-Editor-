"use client";

import { useState } from "react";
import SidebarNav from "@/components/SidebarNav";
import { MobileTabBar, MobileTopBar } from "@/components/MobileNav";
import { cn } from "@/components/ui/cn";

export default function DashboardShell({
  children,
  email,
}: {
  children: React.ReactNode;
  email: string;
}) {
  const [collapsed, setCollapsed] = useState(false);

  return (
    <div className="min-h-[100dvh] bg-canvas">
      {/* Phones get a top bar and thumb-reachable tabs rather than a drawer:
          a hidden hamburger menu costs two taps to reach anything. */}
      <MobileTopBar email={email} />

      <SidebarNav
        email={email}
        collapsed={collapsed}
        onToggleCollapse={() => setCollapsed(!collapsed)}
      />

      <main
        className={cn(
          "flex min-h-[calc(100dvh-7rem)] flex-col transition-[margin-left] duration-200 ease-in-out lg:min-h-[100dvh]",
          // Both widths are written out so Tailwind's scanner keeps them.
          collapsed ? "lg:ml-[68px]" : "lg:ml-64",
        )}
      >
        {children}
      </main>

      <MobileTabBar />
    </div>
  );
}
