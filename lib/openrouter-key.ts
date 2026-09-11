import { AsyncLocalStorage } from "node:async_hooks";
import type { SupabaseClient } from "@supabase/supabase-js";
import { decryptSecret, encryptSecret, secretLast4 } from "./user-secrets";

/**
 * Whose OpenRouter key pays for a given call.
 *
 * Every account brings its own key. The alternative — threading a key
 * parameter down through the video provider, the image and audio workers and
 * the director — would have meant changing perhaps forty signatures, most of
 * them in code that has nothing to do with authentication, and every new call
 * site would have been one forgotten argument away from silently falling back
 * to someone else's key.
 *
 * So the key is request-scoped instead: an entry point (an API route, an MCP
 * tool call) opens a context for the signed-in user, and anything that
 * eventually needs a key asks for the one in scope. Node's AsyncLocalStorage
 * carries it across awaits, including into work that outlives the response.
 *
 * The loader is lazy: a request that never reaches OpenRouter never pays for
 * the database read, and one that reaches it ten times reads once.
 */

type KeyContext = {
  load: () => Promise<string | null>;
  /** Memoised across the request; `undefined` means "not resolved yet". */
  resolved?: Promise<string | null>;
};

const storage = new AsyncLocalStorage<KeyContext>();

/** Thrown when neither the signed-in user nor the deployment has a key. */
export class MissingOpenRouterKeyError extends Error {
  constructor() {
    super(
      "No OpenRouter API key is configured for this account. " +
        "Add your own key in Settings → API keys to start generating.",
    );
    this.name = "MissingOpenRouterKeyError";
  }
}

/** Runs `fn` with `load` as the key source for everything it calls. */
export function runWithOpenRouterKey<T>(load: () => Promise<string | null>, fn: () => Promise<T>): Promise<T> {
  return storage.run({ load }, fn);
}

/**
 * Runs `fn` with this user's stored key in scope.
 *
 * This is the call an entry point makes. Read paths that never generate
 * anything can skip it — they simply never resolve a key.
 */
export function withUserOpenRouterKey<T>(
  supabase: SupabaseClient,
  userId: string,
  fn: () => Promise<T>,
): Promise<T> {
  return runWithOpenRouterKey(() => loadUserOpenRouterKey(supabase, userId), fn);
}

/**
 * The key for the current request, or null if the account has not added one.
 *
 * There is no deployment-wide fallback by design: a shared key would bill
 * whoever deployed the app for everyone's generation, which is the
 * arrangement bring-your-own-key exists to end. An account with no key
 * cannot generate, and is told so.
 */
export async function getOpenRouterKey(): Promise<string | null> {
  const context = storage.getStore();
  if (!context) return null;
  context.resolved ??= context.load();
  return context.resolved;
}

/** As `getOpenRouterKey`, but throws the message the user needs to act on. */
export async function requireOpenRouterKey(): Promise<string> {
  const key = await getOpenRouterKey();
  if (!key) throw new MissingOpenRouterKeyError();
  return key;
}

/* ── Storage ─────────────────────────────────────────────────────────────── */

export type OpenRouterKeyStatus = {
  configured: boolean;
  /** Last four characters of the stored key — enough to recognise it by. */
  last4: string | null;
  setAt: string | null;
};

/** What Settings shows. Never decrypts, so it cannot leak the key. */
export async function readOpenRouterKeyStatus(
  supabase: SupabaseClient,
  userId: string,
): Promise<OpenRouterKeyStatus> {
  const { data } = await supabase
    .from("user_api_keys")
    .select("openrouter_key_cipher, openrouter_key_last4, openrouter_key_set_at")
    .eq("user_id", userId)
    .maybeSingle();

  return {
    configured: Boolean(data?.openrouter_key_cipher),
    last4: (data?.openrouter_key_last4 as string | null) ?? null,
    setAt: (data?.openrouter_key_set_at as string | null) ?? null,
  };
}

/**
 * Decrypts this user's key, or returns null.
 *
 * A key that fails to decrypt — a rotated encryption key, a corrupted row — is
 * treated as absent rather than fatal: the user gets the "add your key"
 * message, which is the action that fixes it either way.
 */
export async function loadUserOpenRouterKey(
  supabase: SupabaseClient,
  userId: string,
): Promise<string | null> {
  const { data, error } = await supabase
    .from("user_api_keys")
    .select("openrouter_key_cipher")
    .eq("user_id", userId)
    .maybeSingle();

  if (error || !data?.openrouter_key_cipher) return null;

  try {
    return decryptSecret(String(data.openrouter_key_cipher));
  } catch (cause) {
    console.error("[openrouter-key] stored key could not be decrypted", cause);
    return null;
  }
}

export async function saveUserOpenRouterKey(
  supabase: SupabaseClient,
  userId: string,
  key: string,
): Promise<void> {
  const trimmed = key.trim();
  const { error } = await supabase.from("user_api_keys").upsert(
    {
      user_id: userId,
      openrouter_key_cipher: encryptSecret(trimmed),
      openrouter_key_last4: secretLast4(trimmed),
      openrouter_key_set_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    },
    { onConflict: "user_id" },
  );
  if (error) throw new Error(error.message);
}

export async function clearUserOpenRouterKey(
  supabase: SupabaseClient,
  userId: string,
): Promise<void> {
  const { error } = await supabase
    .from("user_api_keys")
    .update({
      openrouter_key_cipher: null,
      openrouter_key_last4: null,
      openrouter_key_set_at: null,
      updated_at: new Date().toISOString(),
    })
    .eq("user_id", userId);
  if (error) throw new Error(error.message);
}

/* ── Verification ────────────────────────────────────────────────────────── */

export type OpenRouterKeyCheck =
  | { ok: true; label: string | null; creditsRemaining: number | null }
  | { ok: false; error: string };

/**
 * Asks OpenRouter whether a key works, before we store it.
 *
 * `/api/v1/key` is the cheapest call that proves authentication — it returns
 * the key's own metadata and generates nothing.
 */
export async function verifyOpenRouterKey(key: string): Promise<OpenRouterKeyCheck> {
  let response: Response;
  try {
    response = await fetch("https://openrouter.ai/api/v1/key", {
      headers: { Authorization: `Bearer ${key.trim()}` },
    });
  } catch {
    return { ok: false, error: "Could not reach OpenRouter. Check your connection and try again." };
  }

  if (response.status === 401 || response.status === 403) {
    return { ok: false, error: "OpenRouter rejected this key. Check you copied all of it." };
  }
  if (!response.ok) {
    return { ok: false, error: `OpenRouter returned ${response.status}. Try again in a moment.` };
  }

  const payload = await response.json().catch(() => null) as
    | { data?: { label?: string; limit_remaining?: number | null } }
    | null;

  return {
    ok: true,
    label: payload?.data?.label ?? null,
    creditsRemaining:
      typeof payload?.data?.limit_remaining === "number" ? payload.data.limit_remaining : null,
  };
}
