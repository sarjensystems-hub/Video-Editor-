import { createClient } from "@/lib/supabase/server";
import { getActiveSiteId } from "@/lib/active-site";
import SettingsClient from "@/components/SettingsClient";
import PageHeader from "@/components/ui/PageHeader";
import { readOpenRouterKeyStatus } from "@/lib/openrouter-key";

export default async function SettingsPage() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();

  const [sitesResult, activeSiteId, keyStatus] = await Promise.all([
    supabase.from("sites").select("id, name, url").eq("user_id", user!.id).order("created_at", { ascending: true }),
    getActiveSiteId(),
    readOpenRouterKeyStatus(supabase, user!.id),
  ]);

  return (
    <div className="mx-auto w-full max-w-5xl px-4 py-6 sm:px-8 sm:py-10">
      <PageHeader
        eyebrow="Account"
        title="Settings"
        description="Your API keys, appearance, sign-in details and workspaces."
      />
      <SettingsClient
        email={user?.email ?? ""}
        sites={sitesResult.data ?? []}
        activeSiteId={activeSiteId}
        keyStatus={keyStatus}
      />
    </div>
  );
}
