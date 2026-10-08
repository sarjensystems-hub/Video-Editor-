"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { deleteMediaPaths } from "@/lib/media-library";

export type DeleteMediaResult =
  | { ok: true; deleted: number; failed: number; blocked: Array<{ path: string; projects: string[] }> }
  | { ok: false; error: string };

/** Deletes files picked in the media gallery, with the rows that describe them. */
export async function deleteMediaFiles(paths: string[]): Promise<DeleteMediaResult> {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return { ok: false, error: "Unauthorized" };
  if (!Array.isArray(paths) || paths.length === 0) return { ok: false, error: "Nothing selected" };
  if (paths.length > 500) return { ok: false, error: "Delete at most 500 files at a time" };
  try {
    const result = await deleteMediaPaths(supabase, user.id, paths);
    revalidatePath("/dashboard/media");
    return { ok: true, ...result };
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : "Could not delete those files" };
  }
}
