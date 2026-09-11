"use server";

import { createClient } from "@/lib/supabase/server";
import { headers } from "next/headers";
import { appUrl } from "@/lib/app-url";

export async function sendPasswordReset(email: string): Promise<{ error: string | null }> {
  const supabase = await createClient();
  const headersList = await headers();
  const origin = headersList.get("origin") ?? appUrl();

  const { error } = await supabase.auth.resetPasswordForEmail(email, {
    redirectTo: `${origin}/api/auth/reset-callback`,
  });

  return { error: error?.message ?? null };
}
