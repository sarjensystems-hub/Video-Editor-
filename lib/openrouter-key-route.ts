import { createClient } from "@/lib/supabase/server";
import { loadUserOpenRouterKey, runWithOpenRouterKey } from "@/lib/openrouter-key";

/**
 * Wraps a route handler so anything it calls generates on the signed-in
 * account's own OpenRouter key.
 *
 * The user is resolved lazily, inside the loader, rather than here: a request
 * that never generates anything never pays for the extra `getUser()` round
 * trip, and one that generates several times pays for it once. That is also
 * why this can wrap a whole route without touching the handler body — the
 * handler keeps doing its own auth, and this only decides whose key pays.
 */
export function withOpenRouterKeyScope<A extends unknown[], R>(
  handler: (...args: A) => Promise<R>,
): (...args: A) => Promise<R> {
  return (...args: A) =>
    runWithOpenRouterKey(async () => {
      const supabase = await createClient();
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) return null;
      return loadUserOpenRouterKey(supabase, user.id);
    }, () => handler(...args));
}
