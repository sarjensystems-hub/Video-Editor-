"use server";

import { cookies } from "next/headers";
import { createClient } from "@/lib/supabase/server";
import { revalidatePath } from "next/cache";
import { deleteWorkspaceWithFiles } from "@/lib/workspace-delete";

export async function switchSite(siteId: string) {
  const cookieStore = await cookies();
  cookieStore.set("active_site_id", siteId, {
    path: "/",
    maxAge: 60 * 60 * 24 * 365,
  });
  // Revalidate the entire layout so every nested dashboard page gets fresh data
  revalidatePath("/", "layout");
}

export async function createSite(formData: FormData) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return { error: "Not authenticated" };

  const name = formData.get("name") as string;
  const url = formData.get("url") as string;

  if (!name?.trim()) return { error: "Site name is required" };

  const { data, error } = await supabase
    .from("sites")
    .insert({ user_id: user.id, name: name.trim(), url: url?.trim() || null })
    .select("id")
    .single();

  if (error) return { error: error.message };

  // Set as active site
  const cookieStore = await cookies();
  cookieStore.set("active_site_id", data.id, {
    path: "/",
    maxAge: 60 * 60 * 24 * 365,
  });

  revalidatePath("/dashboard");
  return { id: data.id };
}

export async function deleteSite(siteId: string) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return { error: "Not authenticated" };

  try {
    const { found } = await deleteWorkspaceWithFiles(supabase, user.id, siteId);
    if (!found) return { error: "Workspace not found" };
  } catch (cause) {
    return { error: cause instanceof Error ? cause.message : "Could not delete the workspace" };
  }

  // If deleted site was active, switch to another or clear the cookie
  const cookieStore = await cookies();
  if (cookieStore.get("active_site_id")?.value === siteId) {
    const { data: remaining } = await supabase
      .from("sites")
      .select("id")
      .eq("user_id", user.id)
      .order("created_at", { ascending: true })
      .limit(1)
      .single();

    if (remaining) {
      cookieStore.set("active_site_id", remaining.id, { path: "/", maxAge: 60 * 60 * 24 * 365 });
    } else {
      cookieStore.delete("active_site_id");
    }
  }

  revalidatePath("/", "layout");
  return { success: true };
}
