"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { createEmptyCreativeDocument } from "@/lib/creative/defaults";
import { CREATIVE_CANVAS_FORMATS, resolveCanvasFormat } from "@/lib/creative/canvas-formats";
import type { CreativeDocument } from "@/lib/creative/schema";
import { validateCreativeDocument } from "@/lib/creative/validate";
import { createRevisionSnapshot } from "@/lib/creative/persistence";
import { resolveAssetClass } from "@/lib/creative/asset-class";
import { deleteCreativeProjectWithFiles } from "@/lib/creative/project-delete";

export type CreativeActionResult<T = undefined> =
  | { ok: true; data: T }
  | { ok: false; error: string };

async function authenticatedClient() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return null;
  return { supabase, user };
}

/**
 * Creates a blank project in the chosen frame shape and opens it. Blank on
 * purpose: starter layers laid out for one ratio land in the wrong places in
 * every other, and the assistant builds into an empty scene anyway.
 */
export async function createCreativeProject(title = "Untitled creative", format?: string) {
  const auth = await authenticatedClient();
  if (!auth) redirect("/login");
  const { supabase, user } = auth;
  const projectId = crypto.randomUUID();
  const { width, height } = CREATIVE_CANVAS_FORMATS[resolveCanvasFormat(format)];
  const document = createEmptyCreativeDocument({
    id: projectId,
    title: title.trim().slice(0, 140) || "Untitled creative",
    width,
    height,
  });

  const validation = validateCreativeDocument(document);
  if (!validation.valid) throw new Error(validation.issues[0]?.message ?? "Invalid creative document");

  const { error: projectError } = await supabase.from("creative_projects").insert({
    id: projectId,
    user_id: user.id,
    title: document.title,
    status: "draft",
    document,
  });
  if (projectError) throw new Error(projectError.message);

  const snapshot = createRevisionSnapshot(document, 1, "Created project");
  const { data: revision, error: revisionError } = await supabase
    .from("creative_project_revisions")
    .insert({
      project_id: projectId,
      user_id: user.id,
      sequence: snapshot.sequence,
      change_summary: snapshot.changeSummary,
      document: snapshot.document,
    })
    .select("id")
    .single();

  if (revisionError || !revision) {
    await supabase.from("creative_projects").delete().eq("id", projectId).eq("user_id", user.id);
    throw new Error(revisionError?.message ?? "Could not create initial revision");
  }

  const { error: linkError } = await supabase
    .from("creative_projects")
    .update({ current_revision_id: revision.id })
    .eq("id", projectId)
    .eq("user_id", user.id);
  if (linkError) throw new Error(linkError.message);

  redirect(`/dashboard/creative-studio/${projectId}`);
}

export async function saveCreativeProject(
  projectId: string,
  document: CreativeDocument,
  changeSummary = "Updated creative",
): Promise<CreativeActionResult<{ revisionId: string; sequence: number }>> {
  const auth = await authenticatedClient();
  if (!auth) return { ok: false, error: "Unauthorized" };
  const { supabase, user } = auth;

  const validation = validateCreativeDocument(document);
  if (!validation.valid) {
    return { ok: false, error: validation.issues[0]?.message ?? "Invalid creative document" };
  }
  if (document.id !== projectId) return { ok: false, error: "Document does not belong to this project" };

  const { data: project } = await supabase
    .from("creative_projects")
    .select("id")
    .eq("id", projectId)
    .eq("user_id", user.id)
    .single();
  if (!project) return { ok: false, error: "Project not found" };

  const { data: latest } = await supabase
    .from("creative_project_revisions")
    .select("sequence")
    .eq("project_id", projectId)
    .eq("user_id", user.id)
    .order("sequence", { ascending: false })
    .limit(1)
    .maybeSingle();
  const nextSequence = Number(latest?.sequence ?? 0) + 1;
  const snapshot = createRevisionSnapshot(document, nextSequence, changeSummary);

  const { data: revision, error: revisionError } = await supabase
    .from("creative_project_revisions")
    .insert({
      project_id: projectId,
      user_id: user.id,
      sequence: snapshot.sequence,
      change_summary: snapshot.changeSummary,
      document: snapshot.document,
    })
    .select("id")
    .single();
  if (revisionError || !revision) return { ok: false, error: revisionError?.message ?? "Could not save revision" };

  const { error: updateError } = await supabase
    .from("creative_projects")
    .update({
      title: document.title.slice(0, 140),
      document,
      current_revision_id: revision.id,
      status: "ready",
      updated_at: new Date().toISOString(),
    })
    .eq("id", projectId)
    .eq("user_id", user.id);

  if (updateError) return { ok: false, error: updateError.message };
  revalidatePath("/dashboard/creative-studio");
  revalidatePath(`/dashboard/creative-studio/${projectId}`);
  return { ok: true, data: { revisionId: revision.id as string, sequence: nextSequence } };
}

export async function getCreativeProject(projectId: string): Promise<CreativeActionResult<{
  id: string;
  title: string;
  status: string;
  document: CreativeDocument;
  currentRevisionId: string | null;
}>> {
  const auth = await authenticatedClient();
  if (!auth) return { ok: false, error: "Unauthorized" };
  const { supabase, user } = auth;

  const { data, error } = await supabase
    .from("creative_projects")
    .select("id, title, status, document, current_revision_id")
    .eq("id", projectId)
    .eq("user_id", user.id)
    .single();
  if (error || !data) return { ok: false, error: error?.message ?? "Project not found" };

  const validation = validateCreativeDocument(data.document);
  if (!validation.valid) return { ok: false, error: "Stored CreativeDocument is invalid" };
  return {
    ok: true,
    data: {
      id: data.id as string,
      title: data.title as string,
      status: data.status as string,
      document: data.document as CreativeDocument,
      currentRevisionId: (data.current_revision_id ?? null) as string | null,
    },
  };
}

/**
 * Deletes the project, its revisions and render history, and the stored files
 * that belonged only to it — see lib/creative/project-delete.ts for exactly
 * what is kept and why.
 */
export async function deleteCreativeProject(projectId: string): Promise<CreativeActionResult> {
  const auth = await authenticatedClient();
  if (!auth) return { ok: false, error: "Unauthorized" };
  const { supabase, user } = auth;

  try {
    const { found } = await deleteCreativeProjectWithFiles(supabase, user.id, projectId);
    if (!found) return { ok: false, error: "Project not found" };
  } catch (cause) {
    return { ok: false, error: cause instanceof Error ? cause.message : "Could not delete the project" };
  }

  revalidatePath("/dashboard/creative-studio");
  return { ok: true, data: undefined };
}

/**
 * `folder` selects a view: omitted returns every project, "unfiled" returns
 * only those with no folder, and any other string filters to that folder id.
 *
 * `size_bytes` on each row is the most recent *completed* export's size —
 * projects have no byte size of their own, and that's the only real one
 * this app already tracks. A project that has never finished a render gets
 * null, sorted as smallest.
 */
export async function listCreativeProjects(folder?: string) {
  const auth = await authenticatedClient();
  if (!auth) return [];
  const { supabase, user } = auth;
  const query = supabase
    .from("creative_projects")
    .select("id, title, status, created_at, updated_at, current_revision_id, folder_id")
    .eq("user_id", user.id)
    .order("updated_at", { ascending: false });
  if (folder === "unfiled") query.is("folder_id", null);
  else if (folder) query.eq("folder_id", folder);
  const { data } = await query;
  const projects = data ?? [];

  const projectIds = projects.map((project) => project.id as string);
  const sizeByProject = new Map<string, number>();
  if (projectIds.length > 0) {
    const { data: renders } = await supabase
      .from("creative_render_jobs")
      .select("project_id, size_bytes, finished_at")
      .eq("user_id", user.id)
      .eq("status", "completed")
      .in("project_id", projectIds)
      .order("finished_at", { ascending: false });
    for (const render of renders ?? []) {
      const id = render.project_id as string;
      if (!sizeByProject.has(id) && render.size_bytes != null) sizeByProject.set(id, Number(render.size_bytes));
    }
  }

  return projects.map((project) => ({ ...project, size_bytes: sizeByProject.get(project.id as string) ?? null }));
}

/**
 * Renames a project everywhere its title is read from: both the `title`
 * column and the embedded `document.title`. Touching only the column would
 * make the next editor save (which writes `document.title` back into the
 * column) silently undo the rename.
 */
export async function renameCreativeProject(projectId: string, title: string): Promise<CreativeActionResult> {
  const auth = await authenticatedClient();
  if (!auth) return { ok: false, error: "Unauthorized" };
  const { supabase, user } = auth;
  const trimmed = title.trim().slice(0, 140);
  if (!trimmed) return { ok: false, error: "Title cannot be empty" };

  const { data: project, error: fetchError } = await supabase
    .from("creative_projects")
    .select("document")
    .eq("id", projectId)
    .eq("user_id", user.id)
    .single();
  if (fetchError || !project) return { ok: false, error: fetchError?.message ?? "Project not found" };

  const document = { ...(project.document as CreativeDocument), title: trimmed };
  const { error } = await supabase
    .from("creative_projects")
    .update({ title: trimmed, document, updated_at: new Date().toISOString() })
    .eq("id", projectId)
    .eq("user_id", user.id);
  if (error) return { ok: false, error: error.message };

  revalidatePath("/dashboard/creative-studio");
  revalidatePath(`/dashboard/creative-studio/${projectId}`);
  return { ok: true, data: undefined };
}

export async function listCreativeFolders() {
  const auth = await authenticatedClient();
  if (!auth) return [];
  const { supabase, user } = auth;
  const query = supabase
    .from("creative_folders")
    .select("id, name, created_at")
    .eq("user_id", user.id)
    .order("name", { ascending: true });
  const { data } = await query;
  return data ?? [];
}

export async function createCreativeFolder(name: string): Promise<CreativeActionResult<{ id: string }>> {
  const auth = await authenticatedClient();
  if (!auth) return { ok: false, error: "Unauthorized" };
  const { supabase, user } = auth;
  const trimmed = name.trim().slice(0, 80);
  if (!trimmed) return { ok: false, error: "Folder name cannot be empty" };

  const { data, error } = await supabase
    .from("creative_folders")
    .insert({ user_id: user.id, name: trimmed })
    .select("id")
    .single();
  if (error || !data) return { ok: false, error: error?.message ?? "Could not create folder" };

  revalidatePath("/dashboard/creative-studio");
  return { ok: true, data: { id: data.id as string } };
}

export async function renameCreativeFolder(folderId: string, name: string): Promise<CreativeActionResult> {
  const auth = await authenticatedClient();
  if (!auth) return { ok: false, error: "Unauthorized" };
  const { supabase, user } = auth;
  const trimmed = name.trim().slice(0, 80);
  if (!trimmed) return { ok: false, error: "Folder name cannot be empty" };

  const { error, count } = await supabase
    .from("creative_folders")
    .update({ name: trimmed, updated_at: new Date().toISOString() }, { count: "exact" })
    .eq("id", folderId)
    .eq("user_id", user.id);
  if (error) return { ok: false, error: error.message };
  if (!count) return { ok: false, error: "Folder not found" };

  revalidatePath("/dashboard/creative-studio");
  return { ok: true, data: undefined };
}

/** Deleting a folder never deletes the projects in it — they just lose the folder_id, same as creative_assets does when its project goes away. */
export async function deleteCreativeFolder(folderId: string): Promise<CreativeActionResult> {
  const auth = await authenticatedClient();
  if (!auth) return { ok: false, error: "Unauthorized" };
  const { supabase, user } = auth;

  const { error, count } = await supabase
    .from("creative_folders")
    .delete({ count: "exact" })
    .eq("id", folderId)
    .eq("user_id", user.id);
  if (error) return { ok: false, error: error.message };
  if (!count) return { ok: false, error: "Folder not found" };

  revalidatePath("/dashboard/creative-studio");
  return { ok: true, data: undefined };
}

export async function moveCreativeProjectToFolder(
  projectId: string,
  folderId: string | null,
): Promise<CreativeActionResult> {
  const auth = await authenticatedClient();
  if (!auth) return { ok: false, error: "Unauthorized" };
  const { supabase, user } = auth;

  const { error, count } = await supabase
    .from("creative_projects")
    .update({ folder_id: folderId, updated_at: new Date().toISOString() }, { count: "exact" })
    .eq("id", projectId)
    .eq("user_id", user.id);
  if (error) return { ok: false, error: error.message };
  if (!count) return { ok: false, error: "Project not found" };

  revalidatePath("/dashboard/creative-studio");
  return { ok: true, data: undefined };
}

export async function listCreativeRevisions(projectId: string) {
  const auth = await authenticatedClient();
  if (!auth) return [];
  const { supabase, user } = auth;
  const { data } = await supabase
    .from("creative_project_revisions")
    .select("id, sequence, change_summary, created_at")
    .eq("project_id", projectId)
    .eq("user_id", user.id)
    .order("sequence", { ascending: false });
  return data ?? [];
}

export async function listCreativeAssets(projectId?: string) {
  const auth = await authenticatedClient();
  if (!auth) return [];
  const { supabase, user } = auth;
  const query = supabase
    .from("creative_assets")
    .select("id, project_id, kind, asset_class, source, url, mime_type, filename, width, height, duration_ms, size_bytes, metadata, created_at")
    .eq("user_id", user.id)
    .order("created_at", { ascending: false });
  if (projectId) query.eq("project_id", projectId);
  const { data } = await query;
  return data ?? [];
}

/**
 * Re-files an asset under another class, or changes the note left for the
 * assistant. The class must suit the file: a PNG cannot become music.
 */
export async function updateCreativeAssetTags(
  assetId: string,
  input: { assetClass?: string; description?: string },
): Promise<CreativeActionResult<{ assetClass: string; description: string | null }>> {
  const auth = await authenticatedClient();
  if (!auth) return { ok: false, error: "Unauthorized" };
  const { supabase, user } = auth;
  const { data: asset } = await supabase
    .from("creative_assets")
    .select("id, kind, asset_class, metadata")
    .eq("id", assetId)
    .eq("user_id", user.id)
    .maybeSingle();
  if (!asset) return { ok: false, error: "Asset not found" };

  let assetClass = String(asset.asset_class);
  try {
    if (input.assetClass !== undefined) assetClass = resolveAssetClass(input.assetClass, String(asset.kind));
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : String(error) };
  }
  const metadata = { ...((asset.metadata ?? {}) as Record<string, unknown>) };
  if (input.description !== undefined) {
    const description = input.description.trim().slice(0, 1000);
    if (description) metadata.description = description;
    else delete metadata.description;
  }
  const { error } = await supabase
    .from("creative_assets")
    .update({ asset_class: assetClass, metadata })
    .eq("id", assetId)
    .eq("user_id", user.id);
  if (error) return { ok: false, error: error.message };
  return {
    ok: true,
    data: { assetClass, description: typeof metadata.description === "string" ? metadata.description : null },
  };
}
