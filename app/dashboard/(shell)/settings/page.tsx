import { createClient } from "@/lib/supabase/server";
import SettingsClient from "@/components/SettingsClient";
import PageHeader from "@/components/ui/PageHeader";
import { readOpenRouterKeyStatus } from "@/lib/openrouter-key";

export default async function SettingsPage() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();

  const keyStatus = await readOpenRouterKeyStatus(supabase, user!.id);

  return (
    <div className="mx-auto w-full max-w-5xl px-4 py-6 sm:px-8 sm:py-10">
      <PageHeader
        eyebrow="Account"
        title="Settings"
        description="Your API keys, appearance and sign-in details."
      />
      <SettingsClient
        email={user?.email ?? ""}
        keyStatus={keyStatus}
      />
    </div>
  );
}
