"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import {
  clearUserOpenRouterKey,
  readOpenRouterKeyStatus,
  saveUserOpenRouterKey,
  verifyOpenRouterKey,
  type OpenRouterKeyStatus,
} from "@/lib/openrouter-key";
import { isLikelyOpenRouterKey } from "@/lib/user-secrets";

export type SaveKeyResult =
  | { ok: true; label: string | null; last4: string }
  | { ok: false; error: string };

/**
 * Stores the account's OpenRouter key, after checking it actually works.
 *
 * Verifying before storing matters more than it looks: a key is pasted once
 * and then used by background renders hours later, where a 401 surfaces as a
 * failed export with no obvious cause. One round trip here turns that into a
 * message next to the field.
 */
export async function saveOpenRouterKey(key: string): Promise<SaveKeyResult> {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return { ok: false, error: "Not authenticated" };

  const trimmed = key.trim();
  if (!trimmed) return { ok: false, error: "Paste your OpenRouter key first." };
  if (!isLikelyOpenRouterKey(trimmed)) {
    return { ok: false, error: "That does not look like an OpenRouter key — they start with sk-or-." };
  }

  const check = await verifyOpenRouterKey(trimmed);
  if (!check.ok) return { ok: false, error: check.error };

  try {
    await saveUserOpenRouterKey(supabase, user.id, trimmed);
  } catch (cause) {
    return { ok: false, error: cause instanceof Error ? cause.message : "Could not save the key." };
  }

  revalidatePath("/dashboard/settings");
  return { ok: true, label: check.label, last4: trimmed.slice(-4) };
}

export async function removeOpenRouterKey(): Promise<{ ok: true } | { ok: false; error: string }> {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return { ok: false, error: "Not authenticated" };

  try {
    await clearUserOpenRouterKey(supabase, user.id);
  } catch (cause) {
    return { ok: false, error: cause instanceof Error ? cause.message : "Could not remove the key." };
  }

  revalidatePath("/dashboard/settings");
  return { ok: true };
}

/** Re-checks the stored key against OpenRouter without revealing it. */
export async function testStoredOpenRouterKey(): Promise<{ ok: true; label: string | null } | { ok: false; error: string }> {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return { ok: false, error: "Not authenticated" };

  const { loadUserOpenRouterKey } = await import("@/lib/openrouter-key");
  const stored = await loadUserOpenRouterKey(supabase, user.id);
  if (!stored) return { ok: false, error: "No key is stored for this account." };

  const check = await verifyOpenRouterKey(stored);
  return check.ok ? { ok: true, label: check.label } : { ok: false, error: check.error };
}

export async function getOpenRouterKeyStatus(): Promise<OpenRouterKeyStatus | null> {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return null;
  return readOpenRouterKeyStatus(supabase, user.id);
}
