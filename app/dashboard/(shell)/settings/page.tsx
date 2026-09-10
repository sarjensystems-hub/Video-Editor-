import { createClient } from "@/lib/supabase/server";
import { getActiveSiteId } from "@/lib/active-site";
import SettingsClient from "@/components/SettingsClient";

export default async function SettingsPage() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();

  const [sitesResult, activeSiteId] = await Promise.all([
    supabase.from("sites").select("id, name, url, platform").eq("user_id", user!.id).order("created_at", { ascending: true }),
    getActiveSiteId(),
  ]);

  return (
    <div className="p-8 max-w-3xl">
      <div className="mb-8">
        <h1 className="text-[22px] font-semibold text-gray-900 dark:text-white">Settings</h1>
        <p className="text-sm text-gray-400 mt-0.5">
          Manage your account and appearance.
        </p>
      </div>
      <SettingsClient
        email={user?.email ?? ""}
        sites={sitesResult.data ?? []}
        activeSiteId={activeSiteId}
      />
    </div>
  );
}
