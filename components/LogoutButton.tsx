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
        className="text-orange-500 hover:text-orange-400 transition-colors"
      >
        <LogOut className="w-3.5 h-3.5" strokeWidth={1.8} />
      </button>
    );
  }

  return (
    <button
      onClick={handleLogout}
      className="w-full text-left text-sm text-gray-500 hover:text-red-600 font-medium transition-colors"
    >
      Sign out
    </button>
  );
}
