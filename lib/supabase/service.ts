import { createClient } from "@supabase/supabase-js";

/**
 * Service-role Supabase client for trusted server contexts (cron jobs,
 * webhooks, deletion workers) that need to bypass RLS.
 *
 * Never expose this client to user request handlers — it has full access.
 */
export function createServiceClient() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url) throw new Error("NEXT_PUBLIC_SUPABASE_URL missing");
  if (!key) throw new Error("SUPABASE_SERVICE_ROLE_KEY missing");
  return createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } });
}
