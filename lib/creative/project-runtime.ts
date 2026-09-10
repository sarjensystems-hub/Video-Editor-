import type { SupabaseClient } from "@supabase/supabase-js";
import { getCreativeDurationMs } from "./evaluate";
import { createEmptyCreativeDocument } from "./defaults";
import { createRevisionSnapshot } from "./persistence";
import type { CreativeDocument } from "./schema";
import {
  applyCreativeTransaction,
  type CreativeTransaction,
  type CreativeTransactionResult,
} from "./transactions";
import { validateCreativeDocument } from "./validate";

export interface CreativeRuntimeContext {
  supabase: SupabaseClient;
  userId: string;
  siteId?: string | null;
}

export interface CreativeRuntimeProject {
  id: string;
  title: string;
  status: string;
  document: CreativeDocument;
  currentRevisionId: string | null;
}

export type CreativeCanvasOverrides = Partial<
  Pick<CreativeDocument["canvas"], "width" | "height" | "fps">
>;

export function getNextRevisionSequence(latest: number | null | undefined): number {
  return Math.max(0, Number(latest ?? 0)) + 1;
}

export function normalizeCreativeProjectTitle(title: string | null | undefined): string {
  return (title ?? "").trim().slice(0, 140) || "Untitled creative";
}

export function prepareCreativeProjectTransaction(
  document: CreativeDocument,
  transaction: CreativeTransaction,
): CreativeTransactionResult {
  return applyCreativeTransaction(document, transaction);
}

async function latestRevisionSequence(context: CreativeRuntimeContext, projectId: string): Promise<number> {
  const { data } = await context.supabase
    .from("creative_project_revisions")
    .select("sequence")
    .eq("project_id", projectId)
    .eq("user_id", context.userId)
    .order("sequence", { ascending: false })
    .limit(1)
    .maybeSingle();
  return Number(data?.sequence ?? 0);
}

/**
 * Lists the caller's projects, newest first.
 *
 * Every other read and edit tool needs a project_id, and until this existed
 * nothing returned one except create and import at the moment of creation. An
 * assistant opening a fresh conversation could therefore only ever make
 * something new — it had no way to reach yesterday's work.
 *
 * Deliberately does not return documents: a list of twenty full
 * CreativeDocuments would be enormous, and the caller wants an id.
 */
export async function listRuntimeCreativeProjects(
  context: CreativeRuntimeContext,
  limit = 25,
): Promise<Array<{
  id: string;
  title: string;
  status: string;
  currentRevisionId: string | null;
  updatedAt: string | null;
  durationMs: number | null;
  sceneCount: number | null;
}>> {
  const { data, error } = await context.supabase
    .from("creative_projects")
    .select("id, title, status, current_revision_id, updated_at, document")
    .eq("user_id", context.userId)
    .order("updated_at", { ascending: false })
    .limit(Math.max(1, Math.min(100, Math.round(limit))));
  if (error) throw new Error(error.message);

  return (data ?? []).map((row) => {
    // A stored document that fails validation must not break the listing —
    // the point of the list is to help a caller find and repair such a project.
    const document = row.document as CreativeDocument | null;
    const scenes = Array.isArray(document?.scenes) ? document.scenes : null;
    return {
      id: String(row.id),
      title: String(row.title),
      status: String(row.status),
      currentRevisionId: row.current_revision_id ? String(row.current_revision_id) : null,
      updatedAt: row.updated_at ? String(row.updated_at) : null,
      durationMs: scenes ? getCreativeDurationMs(document as CreativeDocument) : null,
      sceneCount: scenes ? scenes.length : null,
    };
  });
}

export async function getRuntimeCreativeProject(
  context: CreativeRuntimeContext,
  projectId: string,
): Promise<CreativeRuntimeProject | null> {
  const { data, error } = await context.supabase
    .from("creative_projects")
    .select("id, title, status, document, current_revision_id")
    .eq("id", projectId)
    .eq("user_id", context.userId)
    .maybeSingle();
  if (error || !data) return null;
  const validation = validateCreativeDocument(data.document);
  if (!validation.valid) throw new Error("Stored CreativeDocument is invalid");
  return {
    id: String(data.id),
    title: String(data.title),
    status: String(data.status),
    document: data.document as CreativeDocument,
    currentRevisionId: data.current_revision_id ? String(data.current_revision_id) : null,
  };
}

/**
 * What a project with no submitted document starts as.
 *
 * This used to be a complete car-care social ad: four elements, a themed
 * palette, and a mediaDirection block about "cinematic premium automotive
 * photography" that any agent reading the document would reasonably take as
 * art direction for the film it was about to make. A caller had to discover
 * all of it and delete it, and nothing in the tool description said it was
 * there. A new project is now one empty 5000ms scene-1 and a neutral design
 * system, which is what every caller was doing by hand anyway. The sample
 * document survives as createCanonicalCreativeFixture for the web editor,
 * where a starter layout is a feature rather than a surprise. (roadmap #66)
 */
export function createSeedCreativeDocument(projectId: string): CreativeDocument {
  return createEmptyCreativeDocument({ id: projectId });
}

export async function createRuntimeCreativeProject(
  context: CreativeRuntimeContext,
  title?: string,
  sourceDocument?: CreativeDocument,
  canvasOverrides?: CreativeCanvasOverrides,
): Promise<CreativeRuntimeProject> {
  const projectId = crypto.randomUUID();
  const document = sourceDocument
    ? JSON.parse(JSON.stringify(sourceDocument)) as CreativeDocument
    : createSeedCreativeDocument(projectId);
  if (canvasOverrides?.width !== undefined) document.canvas.width = canvasOverrides.width;
  if (canvasOverrides?.height !== undefined) document.canvas.height = canvasOverrides.height;
  if (canvasOverrides?.fps !== undefined) document.canvas.fps = canvasOverrides.fps;
  document.id = projectId;
  document.title = normalizeCreativeProjectTitle(title ?? document.title);
  const validation = validateCreativeDocument(document);
  if (!validation.valid) throw new Error(validation.issues[0]?.message ?? "Invalid CreativeDocument");

  const { error: projectError } = await context.supabase.from("creative_projects").insert({
    id: projectId,
    user_id: context.userId,
    site_id: context.siteId ?? null,
    title: document.title,
    status: "draft",
    document,
  });
  if (projectError) throw new Error(projectError.message);

  try {
    const revision = await saveRuntimeCreativeRevision(context, projectId, document, "Created project", 1);
    await context.supabase
      .from("creative_projects")
      .update({ current_revision_id: revision.id })
      .eq("id", projectId)
      .eq("user_id", context.userId);
    return {
      id: projectId,
      title: document.title,
      status: "draft",
      document,
      currentRevisionId: revision.id,
    };
  } catch (error) {
    await context.supabase.from("creative_projects").delete().eq("id", projectId).eq("user_id", context.userId);
    throw error;
  }
}

export async function saveRuntimeCreativeRevision(
  context: CreativeRuntimeContext,
  projectId: string,
  document: CreativeDocument,
  summary: string,
  forcedSequence?: number,
): Promise<{ id: string; sequence: number }> {
  if (document.id !== projectId) throw new Error("Document does not belong to this project");
  const validation = validateCreativeDocument(document);
  if (!validation.valid) throw new Error(validation.issues[0]?.message ?? "Invalid CreativeDocument");
  const project = await getRuntimeCreativeProject(context, projectId);
  if (!project) throw new Error("Project not found");
  const sequence = forcedSequence ?? getNextRevisionSequence(await latestRevisionSequence(context, projectId));
  const snapshot = createRevisionSnapshot(document, sequence, summary.trim() || "Updated creative");

  const { data: revision, error: revisionError } = await context.supabase
    .from("creative_project_revisions")
    .insert({
      project_id: projectId,
      user_id: context.userId,
      sequence,
      change_summary: snapshot.changeSummary,
      document: snapshot.document,
    })
    .select("id")
    .single();
  if (revisionError || !revision) throw new Error(revisionError?.message ?? "Could not create revision");

  const { error: updateError } = await context.supabase
    .from("creative_projects")
    .update({
      title: normalizeCreativeProjectTitle(document.title),
      document,
      current_revision_id: revision.id,
      status: "ready",
      updated_at: new Date().toISOString(),
    })
    .eq("id", projectId)
    .eq("user_id", context.userId);
  if (updateError) throw new Error(updateError.message);
  return { id: String(revision.id), sequence };
}

/**
 * Thrown by applyRuntimeCreativeTransaction when the transaction itself is
 * rejected - as opposed to the project not existing, which stays a plain
 * Error, since that is a different caller mistake entirely.
 *
 * Carries the same evidence a dry run already hands back as data rather than
 * an exception (roadmap #71): `operationIndex` names the failing operation,
 * and `validatedCount` is how many leading operations, applied together, had
 * already produced a valid document before it - the count of operations a
 * caller does not need to touch on retry. The two are almost always the same
 * number read two ways (operationIndex is 0-based, so operations
 * `[0, operationIndex)` are exactly the ones that validated), but
 * `validatedCount` is always a concrete number rather than possibly
 * undefined, so a caller can slice a retry without a null check. The
 * document itself needs no such bookkeeping to recover: a rejected
 * transaction never partially writes, so it is simply unchanged.
 */
export class CreativeTransactionRejectedError extends Error {
  readonly code: string;
  /** The underlying validation message, unprefixed - what a dry run's error.message already is. */
  readonly detail: string;
  readonly operationIndex: number | undefined;
  readonly validatedCount: number;

  constructor(error: { code: string; message: string; operationIndex?: number }) {
    // .message stays "Operation N: <detail>", the sentence this already threw
    // before roadmap #71, so the one other caller of
    // applyRuntimeCreativeTransaction (app/api/creative/direct/route.ts, which
    // only ever reads .message) is unaffected by this becoming a subclass.
    super(`Operation ${error.operationIndex ?? 0}: ${error.message}`);
    this.name = "CreativeTransactionRejectedError";
    this.code = error.code;
    this.detail = error.message;
    this.operationIndex = error.operationIndex;
    this.validatedCount = error.operationIndex ?? 0;
  }
}

export async function applyRuntimeCreativeTransaction(
  context: CreativeRuntimeContext,
  projectId: string,
  transaction: CreativeTransaction,
): Promise<{ project: CreativeRuntimeProject; revisionId: string; sequence: number }> {
  const project = await getRuntimeCreativeProject(context, projectId);
  if (!project) throw new Error("Project not found");
  const result = applyCreativeTransaction(project.document, transaction);
  if (!result.ok) throw new CreativeTransactionRejectedError(result.error);
  const revision = await saveRuntimeCreativeRevision(context, projectId, result.document, result.summary);
  return {
    project: { ...project, document: result.document, title: result.document.title, status: "ready", currentRevisionId: revision.id },
    revisionId: revision.id,
    sequence: revision.sequence,
  };
}

export async function restoreRuntimeCreativeRevision(
  context: CreativeRuntimeContext,
  projectId: string,
  revisionId: string,
): Promise<{ revisionId: string; sequence: number }> {
  const { data, error } = await context.supabase
    .from("creative_project_revisions")
    .select("document, sequence")
    .eq("id", revisionId)
    .eq("project_id", projectId)
    .eq("user_id", context.userId)
    .maybeSingle();
  if (error || !data) throw new Error("Revision not found");
  const document = data.document as CreativeDocument;
  const restored = await saveRuntimeCreativeRevision(context, projectId, document, `Restored revision ${data.sequence}`);
  return { revisionId: restored.id, sequence: restored.sequence };
}

export async function listRuntimeCreativeAssets(
  context: CreativeRuntimeContext,
  projectId?: string,
) {
  let query = context.supabase
    .from("creative_assets")
    .select("id, project_id, kind, source, url, mime_type, filename, width, height, duration_ms, size_bytes, metadata, created_at")
    .eq("user_id", context.userId)
    .order("created_at", { ascending: false });
  if (projectId) query = query.eq("project_id", projectId);
  const { data, error } = await query;
  if (error) throw new Error(error.message);
  return data ?? [];
}

export async function registerRuntimeCreativeAsset(
  context: CreativeRuntimeContext,
  input: {
    projectId?: string | null;
    kind: string;
    source: string;
    url: string;
    mimeType?: string | null;
    filename?: string | null;
    width?: number | null;
    height?: number | null;
    durationMs?: number | null;
    sizeBytes?: number | null;
    storagePath?: string | null;
    metadata?: Record<string, unknown>;
  },
) {
  if (!/^https:\/\//i.test(input.url)) throw new Error("Asset URL must use HTTPS");
  if (input.projectId) {
    const project = await getRuntimeCreativeProject(context, input.projectId);
    if (!project) throw new Error("Project not found");
  }
  const { data, error } = await context.supabase
    .from("creative_assets")
    .insert({
      user_id: context.userId,
      site_id: context.siteId ?? null,
      project_id: input.projectId ?? null,
      kind: input.kind,
      source: input.source,
      url: input.url,
      mime_type: input.mimeType ?? null,
      filename: input.filename ?? null,
      width: input.width ?? null,
      height: input.height ?? null,
      duration_ms: input.durationMs ?? null,
      size_bytes: input.sizeBytes ?? null,
      storage_path: input.storagePath ?? null,
      metadata: input.metadata ?? {},
    })
    .select("id, project_id, kind, source, url, mime_type, filename, width, height, duration_ms, size_bytes, metadata, created_at")
    .single();
  if (error || !data) throw new Error(error?.message ?? "Could not register asset");
  return data;
}