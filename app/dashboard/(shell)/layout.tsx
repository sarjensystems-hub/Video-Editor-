import { createClient } from "@/lib/supabase/server";
import { redirect } from "next/navigation";
import { cookies } from "next/headers";
import DashboardShell from "./shell";

export default async function DashboardLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();

  if (!user) redirect("/login");

  const sitesResult = await supabase
    .from("sites")
    .select("id, name, url, platform, is_default")
    .eq("user_id", user.id)
    .order("created_at", { ascending: true });

  const sites = sitesResult.data ?? [];
  const cookieStore = await cookies();
  const activeSiteId = cookieStore.get("active_site_id")?.value ?? sites[0]?.id ?? null;

  return (
    <DashboardShell
      email={user.email ?? ""}
      sites={sites}
      activeSiteId={activeSiteId}
    >
      {children}
    </DashboardShell>
  );
}
