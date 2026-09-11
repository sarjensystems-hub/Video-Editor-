"use client";

import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { LogOut } from "lucide-react";

export default function LogoutButton({ iconOnly = false }: { iconOnly?: boolean }) {
  const router = useRouter();
  const supabase = createClient();

  async function handleLogout() {
    await supabase.auth.signOut();
    router.push("/");
    router.refresh();
  }

  if (iconOnly) {
    return (
      <button
        onClick={handleLogout}
        title="Sign out"
        aria-label="Sign out"
        className="rounded-md p-1 text-chalk-dim transition-colors hover:bg-wall-active hover:text-danger"
      >
        <LogOut className="h-3.5 w-3.5" strokeWidth={1.8} />
      </button>
    );
  }

  return (
    <button
      onClick={handleLogout}
      className="w-full text-left text-sm font-medium text-ink-muted transition-colors hover:text-danger"
    >
      Sign out
    </button>
  );
}
