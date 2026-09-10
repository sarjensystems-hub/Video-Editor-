/**
 * Supabase client for use in Browser (Client Components).
 * Use this when you need to call Supabase from a React component
 * that runs in the user's browser.
 */
import { createBrowserClient } from "@supabase/ssr";

export function createClient() {
  return createBrowserClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
  );
}
