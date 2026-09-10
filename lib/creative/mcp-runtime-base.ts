import type { McpUserContext } from "@/lib/mcp-oauth";
import { runAfterResponse } from "./background";
import { chargeCreativeRenderCredits, getCreditServiceClient, refundCreativeRenderCredits, withCredits, InsufficientCreditsError } from "./metering";
import { CREDIT_COSTS, creativeFrameCost, creativeRenderCost } from "../credit-costs";
import { parseCreativeOperationInput } from "./operation-contract";
import {
  getCreativeDocumentAssetIds,
  getCreativeInputAssetMap,
  type CreativeRemotionAssetMap,
} from "./remotion";
import { RENDER_JOB_STALE_MESSAGE, canClaimRenderJobPoll, claimRenderJobPoll, isRenderJobStale, shouldRetryDetachedRender, updateClaimedRenderJob } from "./render-job";
import { resolveCreativeFrameAtTime } from "./frame-time";
import { extractSceneDocument, findSceneExportWindow } from "./scene-export";
import { CREATIVE_CANVAS_MAX_DIMENSION, type CreativeDocument } from "./schema";
import { resolveCreativeRenderOptions, type CreativeRenderQuality, type CreativeRenderWindowOptions } from "./render-options";
import type { CreativeTransaction } from "./transactions";
import {
  applyRuntimeCreativeTransaction,
  createRuntimeCreativeProject,
  CreativeTransactionRejectedError,
  getRuntimeCreativeProject,
  listRuntimeCreativeAssets,
  listRuntimeCreativeProjects,
  normalizeCreativeProjectTitle,
  registerRuntimeCreativeAsset,
  restoreRuntimeCreativeRevision,
  type CreativeCanvasOverrides,
  type CreativeRuntimeContext,
} from "./project-runtime";
import { validateCreativeDocument } from "./validate";
import { describeCreativeSchema, MAX_TRANSACTION_OPERATIONS, type CreativeSchemaGuideSection } from "./schema-guide";
import { creativeCapabilityDigest } from "./capability-map";

/**
 * The ChatGPT-facing Creative Studio surface.
 *
 * ChatGPT owns creative intelligence; Studio owns deterministic
 * creative execution. Every tool below is a validated, revisioned
 * operation on the canonical CreativeDocument or a render of it — no tool
 * here asks a second general-purpose model to reinterpret ChatGPT's
 * creative instructions.
 */
import {
  creativeDocumentPayload,
  parseCreativeReturnMode,
} from "./document-summary";

/** Whether this document's canvas is wider than it is tall. */
function canvasIsLandscape(document: { canvas: { width: number; height: number } }): boolean {
  return document.canvas.width > document.canvas.height;
}

export const CREATIVE_MCP_TOOL_NAMES = [
  "studio_describe_creative_schema",
  "studio_create_creative_project",
  "studio_import_creative_document",
  "studio_list_creative_projects",
  "studio_get_creative_project",
  "studio_edit_creative_project",
  "studio_render_creative_frame",
  "studio_compare_frame",
  "studio_render_creative_contact_sheet",
  "studio_render_creative_project",
  "studio_get_render_job",
  "studio_add_asset",
  "studio_generate_image_asset",
  "studio_promote_video_asset",
  "studio_generate_speech_asset",
  "studio_generate_music_asset",
  "studio_add_sfx_asset",
  "studio_import_svg",
  "studio_analyze_audio_asset",
  "studio_inspect_video_asset",
  "studio_inspect_timeline_state",
  "studio_critique_creative_project",
  "studio_analyze_reference_video",
  "studio_build_reference_skeleton",
  "studio_compare_creative_revisions",
  "studio_inspect_creative_layout",
  "studio_get_creative_changes",
  "studio_list_creative_revisions",
  "studio_restore_creative_revision",
] as const;

/** Upper bound on one contact-sheet request; keeps a single sandbox session bounded. */
export const MAX_CONTACT_SHEET_FRAMES = 12;

export type CreativeMcpToolName = (typeof CREATIVE_MCP_TOOL_NAMES)[number];

function objectInput(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("Input must be an object");
  return value as Record<string, unknown>;
}

/** An optional array-of-strings argument, rejected rather than coerced. */
function stringArrayInput(value: unknown, key: string): string[] | undefined {
  if (value === undefined || value === null) return undefined;
  if (!Array.isArray(value) || value.some((entry) => typeof entry !== "string" || !entry.trim())) {
    throw new Error(`${key} must be an array of non-empty strings`);
  }
  return value.map((entry) => (entry as string).trim());
}

function requiredString(input: Record<string, unknown>, key: string): string {
  const value = typeof input[key] === "string" ? input[key].trim() : "";
  if (!value) throw new Error(`${key} is required`);
  return value;
}

export function parseProjectId(value: unknown): string {
  return requiredString(objectInput(value), "project_id");
}

export function parseCreativeProjectCanvasInput(value: unknown): CreativeCanvasOverrides {
  const input = objectInput(value);
  const output: CreativeCanvasOverrides = {};
  for (const key of ["width", "height"] as const) {
    if (input[key] === undefined) continue;
    if (typeof input[key] !== "number" || !Number.isInteger(input[key]) || input[key] <= 0 || input[key] > CREATIVE_CANVAS_MAX_DIMENSION) {
      throw new Error(`${key} must be an integer from 1 to ${CREATIVE_CANVAS_MAX_DIMENSION}`);
    }
    output[key] = input[key];
  }
  if (input.fps !== undefined) {
    if (typeof input.fps !== "number" || !Number.isInteger(input.fps) || input.fps < 1 || input.fps > 120) {
      throw new Error("fps must be an integer from 1 to 120");
    }
    output.fps = input.fps;
  }
  return output;
}

export function parseCreativeTransactionInput(value: unknown): CreativeTransaction {
  const input = objectInput(value);
  const summary = typeof input.summary === "string" ? input.summary.trim() : "";
  if (!summary) throw new Error("transaction summary is required");
  if (!Array.isArray(input.operations) || input.operations.length === 0) throw new Error("transaction operations are required");
  // The advertised maxItems on the edit tool's operations array (kept equal
  // to this constant by a guard test in schema-guide.test.ts) is client-side
  // guidance only - nothing upstream of this parser enforces it, so a caller
  // that does not itself validate against the advertised schema could send
  // an unbounded array. This is the one place every transaction, from every
  // caller, is guaranteed to pass through, so this is where the cap is real.
  if (input.operations.length > MAX_TRANSACTION_OPERATIONS) {
    throw new Error(`transaction operations must not exceed ${MAX_TRANSACTION_OPERATIONS} (received ${input.operations.length})`);
  }
  const operations = input.operations.map((operation, index) => {
  try {
    return parseCreativeOperationInput(operation);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    throw new Error(`operations[${index}]: ${message}`);
  }
});
return { summary, operations };
}

export interface CreativeDocumentImportInput {
  title?: string;
  siteId?: string;
  document: CreativeDocument;
}

/**
 * Placeholder identity used only to validate an incoming document.
 *
 * Project identity is owned by Studio, not by the submitting client,
 * so a foreign or absent `id` must not fail validation — it is replaced
 * with the new owned project ID at persistence time by
 * `createRuntimeCreativeProject`.
 */
const IMPORT_IDENTITY_PLACEHOLDER = "incoming-creative-document";

/**
 * Validates a complete ChatGPT-authored CreativeDocument before anything is
 * written. Nothing here regenerates, redesigns or reinterprets the incoming
 * creative — it is accepted exactly as submitted or rejected with the first
 * concrete validation issue.
 */
export function parseCreativeDocumentImportInput(value: unknown): CreativeDocumentImportInput {
  const input = objectInput(value);
  const raw = input.document;
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
    throw new Error("document must be a complete CreativeDocument object");
  }

  const title = typeof input.title === "string" && input.title.trim() ? input.title.trim() : undefined;
  const candidate = { ...(raw as Record<string, unknown>) };
  if (typeof candidate.id !== "string" || !candidate.id.trim()) candidate.id = IMPORT_IDENTITY_PLACEHOLDER;
  candidate.title = normalizeCreativeProjectTitle(
    title ?? (typeof candidate.title === "string" ? candidate.title : undefined),
  );

  const validation = validateCreativeDocument(candidate);
  if (!validation.valid) {
    const issue = validation.issues[0];
    const where = issue?.path ? ` at ${issue.path}` : "";
    throw new Error(`document is not a valid CreativeDocument${where}: ${issue?.message ?? "unknown validation failure"}`);
  }

  return {
    title,
    siteId: typeof input.site_id === "string" && input.site_id.trim() ? input.site_id.trim() : undefined,
    document: candidate as unknown as CreativeDocument,
  };
}

export interface CreativeFrameRequestInput {
  projectId: string;
  timeMs: number;
}

function parseTimeMs(value: unknown, label: string): number {
  if (typeof value !== "number" || !Number.isFinite(value) || value < 0) {
    throw new Error(`${label} must be a finite number of milliseconds greater than or equal to zero`);
  }
  return value;
}

export function parseCreativeFrameRequestInput(value: unknown): CreativeFrameRequestInput {
  const input = objectInput(value);
  return { projectId: parseProjectId(input), timeMs: parseTimeMs(input.time_ms, "time_ms") };
}

export interface CreativeContactSheetInput {
  projectId: string;
  timesMs: number[];
}

export function parseCreativeContactSheetInput(value: unknown): CreativeContactSheetInput {
  const input = objectInput(value);
  const projectId = parseProjectId(input);
  const raw = input.times_ms;
  if (!Array.isArray(raw) || raw.length === 0) {
    throw new Error("times_ms must be a non-empty array of milliseconds");
  }
  if (raw.length > MAX_CONTACT_SHEET_FRAMES) {
    throw new Error(`times_ms supports at most ${MAX_CONTACT_SHEET_FRAMES} timestamps`);
  }
  const timesMs = raw.map((item, index) => parseTimeMs(item, `times_ms[${index}]`));
  if (new Set(timesMs).size !== timesMs.length) {
    throw new Error("times_ms must not contain duplicate timestamps");
  }
  return { projectId, timesMs };
}

function parseEditThumbnailTimes(input: Record<string, unknown>): number[] | null {
  if (input.thumbnail_times_ms === undefined) return null;
  const { timesMs } = parseCreativeContactSheetInput({ project_id: parseProjectId(input), times_ms: input.thumbnail_times_ms });
  if (timesMs.length > 3) throw new Error("thumbnail_times_ms supports at most 3 timestamps");
  return timesMs;
}

function parsePreviewImageBase64(value: unknown): Buffer {
  if (typeof value !== "string" || !value.trim()) throw new Error("preview_image_base64 is required");
  const encoded = value.trim().replace(/^data:image\/(?:png|jpeg|webp);base64,/i, "");
  if (!/^[A-Za-z0-9+/]*={0,2}$/.test(encoded)) throw new Error("preview_image_base64 must be valid base64 image data");
  const bytes = Buffer.from(encoded, "base64");
  if (!bytes.length) throw new Error("preview_image_base64 is empty");
  if (bytes.length > 25 * 1024 * 1024) throw new Error("preview_image_base64 must be 25 MB or smaller");
  return bytes;
}

export interface CreativeProjectRenderInput {
  projectId: string;
  sceneId: string | null;
  startMs?: number;
  endMs?: number;
  quality?: CreativeRenderQuality;
}

export function parseCreativeProjectRenderInput(value: unknown): CreativeProjectRenderInput {
  const input = objectInput(value);
  const quality = input.quality;
  if (quality !== undefined && quality !== "draft" && quality !== "final") throw new Error("quality must be draft or final");
  const optionalMs = (key: "start_ms" | "end_ms") => input[key] === undefined ? undefined : parseTimeMs(input[key], key);
  return {
    projectId: parseProjectId(input),
    sceneId: typeof input.scene_id === "string" && input.scene_id.trim() ? input.scene_id.trim() : null,
    startMs: optionalMs("start_ms"),
    endMs: optionalMs("end_ms"),
    quality: quality as CreativeRenderQuality | undefined,
  };
}

export interface CreativeAssetProbeInput {
  assetId: string;
  timesMs: number[];
}

export function parseCreativeAssetProbeInput(value: unknown): CreativeAssetProbeInput {
  const input = objectInput(value);
  const assetId = requiredString(input, "asset_id");
  const raw = input.times_ms;
  if (!Array.isArray(raw) || raw.length === 0) {
    throw new Error("times_ms must be a non-empty array of milliseconds");
  }
  if (raw.length > MAX_CONTACT_SHEET_FRAMES) {
    throw new Error(`times_ms supports at most ${MAX_CONTACT_SHEET_FRAMES} timestamps`);
  }
  const timesMs = raw.map((item, index) => parseTimeMs(item, `times_ms[${index}]`));
  if (new Set(timesMs).size !== timesMs.length) {
    throw new Error("times_ms must not contain duplicate timestamps");
  }
  return { assetId, timesMs };
}

async function resolveSiteId(context: McpUserContext, requested?: unknown): Promise<string | null> {
  if (typeof requested === "string" && requested.trim()) {
    const id = requested.trim();
    const { data } = await context.supabase.from("sites").select("id").eq("id", id).eq("user_id", context.user.id).maybeSingle();
    if (!data) throw new Error("site_id is not owned by the authenticated user");
    return id;
  }
  const { data } = await context.supabase
    .from("sites")
    .select("id")
    .eq("user_id", context.user.id)
    .order("is_default", { ascending: false })
    .order("created_at", { ascending: true })
    .limit(1)
    .maybeSingle();
  return data?.id ? String(data.id) : null;
}

async function runtimeContext(context: McpUserContext, requestedSiteId?: unknown): Promise<CreativeRuntimeContext> {
  return { supabase: context.supabase, userId: context.user.id, siteId: await resolveSiteId(context, requestedSiteId) };
}

/**
 * Resolves the exact owned asset URLs a document references.
 *
 * Preview and final rendering share this so a previewed frame is composed
 * from the same bytes the MP4 render will use.
 */
async function resolveOwnedAssetMap(
  context: McpUserContext,
  document: CreativeDocument,
): Promise<{ assets: CreativeRemotionAssetMap; requiredAssetIds: string[] }> {
  const requiredAssetIds = getCreativeDocumentAssetIds(document);
  let rows: Array<{ id: string; url: string; mime_type: string | null }> = [];
  if (requiredAssetIds.length) {
    const { data } = await context.supabase
      .from("creative_assets")
      .select("id, url, mime_type")
      .eq("user_id", context.user.id)
      .in("id", requiredAssetIds);
    rows = (data ?? []) as typeof rows;
  }
  return {
    assets: getCreativeInputAssetMap(rows.map((row) => ({ id: row.id, url: row.url, mimeType: row.mime_type }))),
    requiredAssetIds,
  };
}

/** Permanent, revision-scoped R2 key so a preview URL keeps resolving. */
function creativePreviewKey(userId: string, projectId: string, revisionId: string, suffix: string): string {
  return `creative-previews/${userId}/${projectId}/${revisionId}/${suffix}`;
}

async function renderProject(context: McpUserContext, request: CreativeProjectRenderInput) {
  const { projectId, sceneId, startMs, endMs, quality } = request;
  const runtime = await runtimeContext(context);
  const project = await getRuntimeCreativeProject(runtime, projectId);
  if (!project) throw new Error("Project not found");

  // A clip render is a one-scene document cut from the film. The scene is
  // resolved against the stored project so an unknown id fails here rather than
  // quietly rendering the whole thing instead.
  if (sceneId && !findSceneExportWindow(project.document, sceneId)) {
    throw new Error(`Scene ${sceneId} is not part of this project`);
  }
  const document = sceneId ? extractSceneDocument(project.document, sceneId) : project.document;
  const requestedOptions: CreativeRenderWindowOptions = { startMs, endMs, quality };
  const resolvedOptions = resolveCreativeRenderOptions(document, requestedOptions);
  const renderMetadata = {
    required_asset_ids: [] as string[], source: "mcp", scene_id: sceneId,
    start_ms: resolvedOptions.startMs, end_ms: resolvedOptions.endMs, duration_ms: resolvedOptions.durationMs,
    quality: quality ?? "final", output_width: Math.max(1, Math.round(document.canvas.width * resolvedOptions.scale)),
    output_height: Math.max(1, Math.round(document.canvas.height * resolvedOptions.scale)),
  };
  const { assets, requiredAssetIds } = await resolveOwnedAssetMap(context, document);
  const renderSupabase = await getCreditServiceClient(context);
  renderMetadata.required_asset_ids = requiredAssetIds;
  const renderCost = creativeRenderCost(resolvedOptions.durationMs);
  const { data: job, error } = await renderSupabase
    .from("creative_render_jobs")
    .insert({
      user_id: context.user.id,
      site_id: runtime.siteId,
      project_id: projectId,
      revision_id: project.currentRevisionId,
      status: "rendering",
      renderer: "remotion-vercel",
      format: "mp4",
      progress: 0.02,
      started_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
      metadata: renderMetadata,
    })
    .select("id")
    .single();
  if (error || !job) throw new Error(error?.message ?? "Could not create render job");

  // Charged before the response, not inside the background work: a caller with
  // too few credits has to learn that now, while there is still someone to tell.
  // The refund lives in the failure path below.
  try {
    await chargeCreativeRenderCredits(context, String(job.id), renderCost);
  } catch (chargeError) {
    await renderSupabase
      .from("creative_render_jobs")
      .update({
        status: "failed",
        error: chargeError instanceof InsufficientCreditsError ? chargeError.message : "Could not charge for this render.",
        finished_at: new Date().toISOString(),
      })
      .eq("id", job.id)
      .eq("user_id", context.user.id);
    throw chargeError;
  }

  // Launch only. The Remotion command itself is detached inside the sandbox;
  // later status polls reconnect by sandbox/cmd id, so the request function is
  // no longer the render's lifetime owner.
  runAfterResponse(async () => {
    try {
      const { creativeRenderAdapter } = await import("./render");
      const handle = await creativeRenderAdapter.startDetached({
        document,
        assets,
        options: requestedOptions,
        outputKey: `creative-renders/${context.user.id}/${job.id}.mp4`,
      });
      const now = new Date().toISOString();
      const { error: handleError } = await renderSupabase.from("creative_render_jobs").update({
        progress: 0.04,
        metadata: { ...renderMetadata, phase: "detached-rendering", detached_render: handle },
        updated_at: now,
      }).eq("id", job.id).eq("user_id", context.user.id);
      if (handleError) {
        await creativeRenderAdapter.stopDetached(handle);
        throw new Error(`Could not persist detached render handle: ${handleError.message}`);
      }
    } catch (renderError) {
      const message = renderError instanceof Error ? renderError.message : String(renderError);
      const finishedAt = new Date().toISOString();
      // Mark terminal first; the job-bound refund RPC only refunds terminal jobs.
      const { error: updateError } = await renderSupabase.from("creative_render_jobs").update({ status: "failed", error: message.slice(0, 4000), finished_at: finishedAt, updated_at: finishedAt }).eq("id", job.id).eq("user_id", context.user.id);
      if (!updateError) await refundCreativeRenderCredits(context, String(job.id)).catch(() => undefined);
    }
  });

  return {
    job_id: String(job.id),
    status: "rendering",
    progress: 0.02,
    scene_id: sceneId,
    scope: sceneId ? "clip" : "film",
    start_ms: resolvedOptions.startMs,
    end_ms: resolvedOptions.endMs,
    duration_ms: resolvedOptions.durationMs,
    quality: quality ?? "final",
    poll_with: "studio_get_render_job",
    estimated_completion_ms: null,
    note: "Rendering runs as a reconnectable sandbox command. Poll studio_get_render_job with this job_id until status is completed or failed; each poll advances progress/finalization and returns estimated_completion_ms once measurable.",
  };
}

/**
 * Renders exact still frames from the project's current validated revision
 * using the same Remotion composition, snapshot and `{ document, assets }`
 * input props as final MP4 rendering, and stores every image permanently in
 * Studio R2 storage.
 */
async function renderDocumentFrames(
  context: McpUserContext,
  projectId: string,
  document: CreativeDocument,
  revisionId: string | null,
  timesMs: number[],
  withContactSheet: boolean,
) {
  // The storage key needs some path segment; the reported revision stays
  // exactly what the project has, so a caller is never told a revision ID
  // that does not exist.
  const revisionKey = revisionId ?? "unversioned";
  const { assets } = await resolveOwnedAssetMap(context, document);

  // Frames resolve before any renderer work so an out-of-range timestamp is
  // an immediate, explainable error rather than a wasted sandbox restore.
  const { resolveCreativeFrameAtTime } = await import("./frame-time");
  const resolved = timesMs.map((timeMs) => resolveCreativeFrameAtTime(document, timeMs));

  const { creativeRenderAdapter } = await import("./render");
  // Every still is a sandbox restore and a render, so a twelve-frame contact
  // sheet costs twelve of them rather than one.
  const result = await withCredits(
    context,
    "creative_frame",
    creativeFrameCost(resolved.length),
    () =>
      creativeRenderAdapter.renderFrames({
        document,
        assets,
        timesMs,
        outputKeys: resolved.map((entry) => creativePreviewKey(context.user.id, projectId, revisionKey, `frame-${entry.frame}.png`)),
        contactSheetKey: withContactSheet
          ? creativePreviewKey(context.user.id, projectId, revisionKey, `sheet-${resolved.map((entry) => entry.frame).join("-")}.png`)
          : undefined,
      }),
  );

  return {
    revisionId,
    result,
    renderedDurationMs: resolved[0]?.renderedDurationMs ?? 0,
  };
}

async function renderProjectFrames(
  context: McpUserContext,
  projectId: string,
  timesMs: number[],
  withContactSheet: boolean,
) {
  const project = await getRuntimeCreativeProject(await runtimeContext(context), projectId);
  if (!project) throw new Error("Project not found");
  return { project, ...(await renderDocumentFrames(context, projectId, project.document, project.currentRevisionId, timesMs, withContactSheet)) };
}

export async function handleCreativeMcpTool(
  context: McpUserContext,
  name: CreativeMcpToolName,
  value: unknown,
): Promise<unknown> {
  const input = objectInput(value);

  // Answered from engine constants, so it needs no project, no runtime and no
  // credits. Placed first because it is the tool a caller reaches for before
  // they have anything to address.
  if (name === "studio_describe_creative_schema") {
    return describeCreativeSchema({
      sections: stringArrayInput(input.sections, "sections") as CreativeSchemaGuideSection[] | undefined,
      operations: stringArrayInput(input.operations, "operations"),
      elements: stringArrayInput(input.elements, "elements"),
    });
  }

  if (name === "studio_create_creative_project") {
    const runtime = await runtimeContext(context, input.site_id);
    const title = typeof input.title === "string" ? input.title : undefined;
    const project = await createRuntimeCreativeProject(runtime, title, undefined, parseCreativeProjectCanvasInput(input));
    return {
      project_id: project.id,
      title: project.title,
      status: project.status,
      current_revision_id: project.currentRevisionId,
      ...creativeDocumentPayload(project.document, parseCreativeReturnMode(input.return)),
      // The session-opening call, so the capability map rides along for free.
      // An agent whose client dropped the server instructions otherwise starts
      // authoring with no idea which primitives exist, and finds them four
      // round trips later.
      capabilities: creativeCapabilityDigest(),
    };
  }

  if (name === "studio_import_creative_document") {
    // Hashed exactly as it arrived, and before parsing. The parser normalizes
    // the title and fills a missing id, so the parsed document is no longer
    // the thing the caller hashed — only the raw input is. Checking first also
    // means a document that lost something in transcription is reported as
    // that, rather than as whatever downstream validation error the damage
    // happens to produce.
    const { assertDocumentSha256 } = await import("./document-hash");
    const documentSha256 = assertDocumentSha256(input.document, input.document_sha256);

    const parsed = parseCreativeDocumentImportInput(input);
    const runtime = await runtimeContext(context, parsed.siteId);
    const project = await createRuntimeCreativeProject(runtime, parsed.title, parsed.document);
    return {
      project_id: project.id,
      title: project.title,
      status: project.status,
      current_revision_id: project.currentRevisionId,
      // Returned whether or not one was supplied, so a caller can record it on
      // a first import and verify against it on the next.
      document_sha256: documentSha256,
      ...creativeDocumentPayload(project.document, parseCreativeReturnMode(input.return)),
    };
  }

  if (name === "studio_render_creative_frame") {
    const { projectId, timeMs } = parseCreativeFrameRequestInput(input);
    const { revisionId, result } = await renderProjectFrames(context, projectId, [timeMs], false);
    const frame = result.frames[0];
    return {
      project_id: projectId,
      revision_id: revisionId,
      time_ms: frame.timeMs,
      frame: frame.frame,
      output_url: frame.url,
      content_type: frame.contentType,
      size_bytes: frame.sizeBytes,
    };
  }

  if (name === "studio_compare_frame") {
    const { projectId, timeMs } = parseCreativeFrameRequestInput(input);
    const previewBytes = parsePreviewImageBase64(input.preview_image_base64);
    const { revisionId, result } = await renderProjectFrames(context, projectId, [timeMs], false);
    const frame = result.frames[0];
    const response = await fetch(frame.url, { cache: "no-store" });
    if (!response.ok) throw new Error(`Could not load rendered frame (${response.status})`);
    const { compareCreativeFrameImages } = await import("./frame-comparison");
    const comparison = await compareCreativeFrameImages(previewBytes, new Uint8Array(await response.arrayBuffer()));
    const { uploadAnyBytes } = await import("../storage");
    const differenceUrl = await uploadAnyBytes(comparison.diffPng, creativePreviewKey(context.user.id, projectId, revisionId ?? "unversioned", `parity-diff-${frame.frame}.png`), "image/png");
    if (!differenceUrl) throw new Error("Frame difference image could not be persisted");
    return { project_id: projectId, revision_id: revisionId, time_ms: frame.timeMs, frame: frame.frame, rendered_frame_url: frame.url, difference_url: differenceUrl, content_type: "image/png", ...comparison.metrics };
  }

  if (name === "studio_render_creative_contact_sheet") {
    const { projectId, timesMs } = parseCreativeContactSheetInput(input);
    const { revisionId, result, renderedDurationMs } = await renderProjectFrames(context, projectId, timesMs, true);
    return {
      project_id: projectId,
      revision_id: revisionId,
      rendered_duration_ms: renderedDurationMs,
      contact_sheet_url: result.contactSheet?.url ?? null,
      contact_sheet_columns: result.contactSheet?.columns ?? null,
      contact_sheet_rows: result.contactSheet?.rows ?? null,
      content_type: result.contactSheet?.contentType ?? "image/png",
      size_bytes: result.contactSheet?.sizeBytes ?? null,
      frames: result.frames.map((frame) => ({
        time_ms: frame.timeMs,
        frame: frame.frame,
        output_url: frame.url,
        content_type: frame.contentType,
        size_bytes: frame.sizeBytes,
      })),
    };
  }

  if (name === "studio_inspect_video_asset") {
    const { assetId, timesMs } = parseCreativeAssetProbeInput(input);
    const { data: asset } = await context.supabase
      .from("creative_assets")
      .select("id, url, mime_type, kind, width, height, duration_ms")
      .eq("user_id", context.user.id)
      .eq("id", assetId)
      .maybeSingle();
    if (!asset) throw new Error("Asset not found");
    if (asset.kind !== "video") throw new Error("inspect_video_asset only works on video assets");

    const { assertProbeTimeInRange, buildAssetProbeDocument } = await import("./asset-probe");
    for (const timeMs of timesMs) assertProbeTimeInRange(timeMs, asset.duration_ms);

    // A throwaway one-element document, never persisted, so the frames come
    // out of the same renderer that will cut the film.
    const document = buildAssetProbeDocument({
      id: asset.id,
      width: asset.width,
      height: asset.height,
      durationMs: asset.duration_ms,
    });

    const { resolveCreativeFrameAtTime } = await import("./frame-time");
    const resolved = timesMs.map((timeMs) => resolveCreativeFrameAtTime(document, timeMs));

    const { creativeRenderAdapter } = await import("./render");
    const probeKey = (suffix: string) => `creative-previews/${context.user.id}/asset-probes/${asset.id}/${suffix}`;
    const result = await withCredits(
      context,
      "creative_frame",
      creativeFrameCost(resolved.length),
      () =>
        creativeRenderAdapter.renderFrames({
          document,
          assets: getCreativeInputAssetMap([{ id: asset.id, url: asset.url, mimeType: asset.mime_type }]),
          timesMs,
          outputKeys: resolved.map((entry) => probeKey(`frame-${entry.frame}.png`)),
          contactSheetKey: probeKey(`sheet-${resolved.map((entry) => entry.frame).join("-")}.png`),
        }),
    );

    return {
      asset_id: asset.id,
      duration_ms: asset.duration_ms,
      width: asset.width,
      height: asset.height,
      contact_sheet_url: result.contactSheet?.url ?? null,
      contact_sheet_columns: result.contactSheet?.columns ?? null,
      contact_sheet_rows: result.contactSheet?.rows ?? null,
      content_type: result.contactSheet?.contentType ?? "image/png",
      size_bytes: result.contactSheet?.sizeBytes ?? null,
      frames: result.frames.map((frame) => ({
        // For a probe the timeline time is the source time, so this column is
        // directly the number to put in sourceStartMs.
        time_ms: frame.timeMs,
        source_ms: frame.timeMs,
        frame: frame.frame,
        output_url: frame.url,
        content_type: frame.contentType,
        size_bytes: frame.sizeBytes,
      })),
    };
  }

  if (name === "studio_analyze_audio_asset") {
    const assetId = requiredString(input, "asset_id");
    const { data, error } = await context.supabase
      .from("creative_assets")
      .select("id, kind, url, metadata")
      .eq("id", assetId)
      .eq("user_id", context.user.id)
      .maybeSingle();
    if (error || !data) throw new Error("Audio asset not found");
    if (data.kind !== "audio") throw new Error("Only audio assets can be analyzed");

    // Analysis is expensive relative to rendering, so a previous result is
    // reused unless the caller explicitly asks for a fresh one.
    const cached = (data.metadata as Record<string, unknown> | null)?.analysis;
    if (cached && input.refresh !== true) {
      return { asset_id: assetId, cached: true, ...(cached as Record<string, unknown>) };
    }

    const { analyzeAudioUrl } = await import("./audio-analysis");
    const analysis = await analyzeAudioUrl(String(data.url));
    const stored = {
      duration_ms: analysis.durationMs,
      sample_rate: analysis.sampleRate,
      peak_window_ms: analysis.peakWindowMs,
      peaks: analysis.peaks,
      transients_ms: analysis.transientsMs,
    };
    await context.supabase
      .from("creative_assets")
      .update({ metadata: { ...((data.metadata as Record<string, unknown>) ?? {}), analysis: stored } })
      .eq("id", assetId)
      .eq("user_id", context.user.id);

    return { asset_id: assetId, cached: false, ...stored };
  }

  if (name === "studio_inspect_timeline_state") {
    const runtime = await runtimeContext(context);
    const projectId = parseProjectId(input);
    const project = await getRuntimeCreativeProject(runtime, projectId);
    if (!project) throw new Error("Project not found");
    const timeMs = parseTimeMs(input.time_ms, "time_ms");
    const { inspectCreativeTimelineState } = await import("./timeline-state");
    return { project_id: projectId, revision_id: project.currentRevisionId, ...inspectCreativeTimelineState(project.document, timeMs) };
  }

  if (name === "studio_critique_creative_project") {
    const runtime = await runtimeContext(context);
    const projectId = parseProjectId(input);
    const project = await getRuntimeCreativeProject(runtime, projectId);
    if (!project) throw new Error("Project not found");
    const { critiqueCreativeProject } = await import("./structure-profile");
    return { project_id: projectId, revision_id: project.currentRevisionId, ...critiqueCreativeProject(project.document) };
  }

  if (name === "studio_analyze_reference_video") {
    const assetId = requiredString(input, "asset_id");
    const requestedInterval = input.sample_interval_ms === undefined ? 1000 : parseTimeMs(input.sample_interval_ms, "sample_interval_ms");
    if (requestedInterval < 250) throw new Error("sample_interval_ms must be at least 250");
    const { data: asset } = await context.supabase
      .from("creative_assets")
      .select("id, url, mime_type, kind, width, height, duration_ms, metadata")
      .eq("user_id", context.user.id)
      .eq("id", assetId)
      .maybeSingle();
    if (!asset) throw new Error("Asset not found");
    if (asset.kind !== "video") throw new Error("analyze_reference_video only works on video assets");
    const durationMs = Number(asset.duration_ms);
    if (!Number.isFinite(durationMs) || durationMs <= 0) throw new Error("Reference asset needs a measured duration_ms before analysis");
    const maxFrames = 24;
    const actualInterval = Math.max(requestedInterval, Math.ceil(durationMs / Math.max(1, maxFrames - 1)));
    const timesMs: number[] = [];
    for (let time = 0; time < durationMs && timesMs.length < maxFrames; time += actualInterval) timesMs.push(Math.round(time));
    const tail = Math.max(0, Math.floor(durationMs - 1));
    if (timesMs[timesMs.length - 1] !== tail && timesMs.length < maxFrames) timesMs.push(tail);
    if (timesMs.length < 2 && durationMs > 1) timesMs.push(tail);

    const { buildAssetProbeDocument } = await import("./asset-probe");
    const document = buildAssetProbeDocument({ id: asset.id, width: asset.width, height: asset.height, durationMs });
    const { resolveCreativeFrameAtTime } = await import("./frame-time");
    const resolved = timesMs.map((timeMs) => resolveCreativeFrameAtTime(document, timeMs));
    const { creativeRenderAdapter } = await import("./render");
    const probeKey = (suffix: string) => `creative-previews/${context.user.id}/reference-analysis/${asset.id}/${suffix}`;
    const rendered = await withCredits(context, "creative_frame", creativeFrameCost(resolved.length), () =>
      creativeRenderAdapter.renderFrames({
        document,
        assets: getCreativeInputAssetMap([{ id: asset.id, url: asset.url, mimeType: asset.mime_type }]),
        timesMs,
        outputKeys: resolved.map((entry) => probeKey(`frame-${entry.frame}.png`)),
        contactSheetKey: probeKey(`sheet-${resolved.map((entry) => entry.frame).join("-")}.png`),
      }),
    );
    const { measureReferenceFrame, analyzeReferenceFrameSeries } = await import("./reference-analysis");
    const measurements = await Promise.all(rendered.frames.map(async (frame) => {
      const response = await fetch(frame.url, { cache: "no-store" });
      if (!response.ok) throw new Error(`Could not read rendered reference frame (${response.status})`);
      return measureReferenceFrame(Buffer.from(await response.arrayBuffer()), frame.timeMs);
    }));
    const analysis = analyzeReferenceFrameSeries(measurements, durationMs);
    const storedAnalysis = { ...analysis, sample_interval_ms: actualInterval, sampled_frame_count: measurements.length };
    await context.supabase.from("creative_assets").update({
      metadata: { ...((asset.metadata as Record<string, unknown>) ?? {}), reference_analysis: storedAnalysis },
    }).eq("id", assetId).eq("user_id", context.user.id);
    return {
      asset_id: assetId,
      contact_sheet_url: rendered.contactSheet?.url ?? null,
      sampled_frames: rendered.frames.map((frame) => ({ time_ms: frame.timeMs, output_url: frame.url })),
      ...storedAnalysis,
    };
  }

  if (name === "studio_build_reference_skeleton") {
    const runtime = await runtimeContext(context);
    const projectId = parseProjectId(input);
    const referenceAssetId = requiredString(input, "reference_asset_id");
    const project = await getRuntimeCreativeProject(runtime, projectId);
    if (!project) throw new Error("Project not found");
    const { data: asset } = await context.supabase.from("creative_assets").select("id, metadata").eq("user_id", context.user.id).eq("id", referenceAssetId).maybeSingle();
    if (!asset) throw new Error("Reference asset not found");
    const analysis = ((asset.metadata as Record<string, unknown> | null)?.reference_analysis ?? null) as import("./reference-analysis").ReferenceVideoAnalysis | null;
    if (!analysis) throw new Error("Reference asset has no cached analysis; run studio_analyze_reference_video first");
    const { buildReferenceTimelineSkeleton } = await import("./reference-skeleton");
    const title = typeof input.title === "string" && input.title.trim() ? input.title.trim() : undefined;
    const document = buildReferenceTimelineSkeleton(project.document, analysis, title);
    return { project_id: projectId, source_revision_id: project.currentRevisionId, reference_asset_id: referenceAssetId, persisted: false, document, note: "Candidate only. Review it, then persist explicitly with an import/edit action." };
  }

  if (name === "studio_compare_creative_revisions") {
    const runtime = await runtimeContext(context);
    const projectId = parseProjectId(input);
    const leftRevisionId = requiredString(input, "left_revision_id");
    const { timesMs } = parseCreativeContactSheetInput({ project_id: projectId, times_ms: input.times_ms });
    const current = await getRuntimeCreativeProject(runtime, projectId);
    if (!current) throw new Error("Project not found");
    const loadRevision = async (revisionId: string): Promise<{ id: string; sequence: number; document: CreativeDocument }> => {
      const { data, error } = await context.supabase.from("creative_project_revisions").select("id, sequence, document").eq("id", revisionId).eq("project_id", projectId).eq("user_id", context.user.id).maybeSingle();
      if (error || !data) throw new Error(`Revision ${revisionId} not found`);
      return { id: String(data.id), sequence: Number(data.sequence), document: data.document as CreativeDocument };
    };
    const left = await loadRevision(leftRevisionId);
    const rightRevisionId = typeof input.right_revision_id === "string" && input.right_revision_id.trim() ? input.right_revision_id.trim() : current.currentRevisionId;
    if (!rightRevisionId) throw new Error("Current project has no revision to compare");
    const right = await loadRevision(rightRevisionId);
    const leftResolved = timesMs.map((timeMs) => resolveCreativeFrameAtTime(left.document, timeMs));
    const rightResolved = timesMs.map((timeMs) => resolveCreativeFrameAtTime(right.document, timeMs));
    const [leftAssets, rightAssets] = await Promise.all([resolveOwnedAssetMap(context, left.document), resolveOwnedAssetMap(context, right.document)]);
    const { creativeRenderAdapter } = await import("./render");
    const [leftRender, rightRender] = await withCredits(context, "creative_frame", creativeFrameCost(timesMs.length * 2), () => Promise.all([
      creativeRenderAdapter.renderFrames({ document: left.document, assets: leftAssets.assets, timesMs, outputKeys: leftResolved.map((entry) => creativePreviewKey(context.user.id, projectId, left.id, `compare-${entry.frame}.png`)), contactSheetKey: creativePreviewKey(context.user.id, projectId, left.id, `compare-sheet-${leftResolved.map((entry) => entry.frame).join("-")}.png`) }),
      creativeRenderAdapter.renderFrames({ document: right.document, assets: rightAssets.assets, timesMs, outputKeys: rightResolved.map((entry) => creativePreviewKey(context.user.id, projectId, right.id, `compare-${entry.frame}.png`)), contactSheetKey: creativePreviewKey(context.user.id, projectId, right.id, `compare-sheet-${rightResolved.map((entry) => entry.frame).join("-")}.png`) }),
    ]));
    const { diffCreativeDocuments } = await import("./document-diff");
    const { scoreCreativeStructureSimilarity } = await import("./structure-profile");
    return {
      project_id: projectId,
      times_ms: timesMs,
      left: { revision_id: left.id, revision: left.sequence, contact_sheet_url: leftRender.contactSheet?.url ?? null, frames: leftRender.frames },
      right: { revision_id: right.id, revision: right.sequence, contact_sheet_url: rightRender.contactSheet?.url ?? null, frames: rightRender.frames },
      changes: diffCreativeDocuments(left.document, right.document),
      structural_similarity: scoreCreativeStructureSimilarity(left.document, right.document),
    };
  }

  if (name === "studio_inspect_creative_layout") {
    const runtime = await runtimeContext(context);
    const projectId = parseProjectId(input);
    const project = await getRuntimeCreativeProject(runtime, projectId);
    if (!project) throw new Error("Project not found");
    const { inspectCreativeSafeAreas, defaultSafeAreaFor, REELS_SAFE_AREA, TITLE_SAFE_AREA } =
      await import("./safe-area");
    // Derived from the canvas rather than fixed at "reels": a landscape film
    // judged against a vertical phone reservation reports noise, and an author
    // who learns to ignore this tool ignores the real warning too.
    const fallback = canvasIsLandscape(project.document) ? "title" : "reels";
    const requested = typeof input.safe_area === "string" ? input.safe_area : fallback;
    const preset =
      requested === "none"
        ? undefined
        : requested === "title"
          ? TITLE_SAFE_AREA
          : requested === "reels"
            ? REELS_SAFE_AREA
            : defaultSafeAreaFor(project.document.canvas);
    const warnings = inspectCreativeSafeAreas(project.document, preset);

    // A clip that asks for source past the end of its asset renders black
    // without failing, which reads as a content mistake and costs a render
    // pass to find. The asset records are already here; the check is free.
    const { inspectClipCoverage } = await import("./clip-coverage");
    const projectAssets = await listRuntimeCreativeAssets(runtime, projectId);
    const coverage = inspectClipCoverage(
      project.document,
      new Map(projectAssets.map((asset) => [asset.id, asset.duration_ms])),
    );

    return {
      project_id: projectId,
      revision_id: project.currentRevisionId,
      safe_area: requested,
      warning_count: warnings.length + coverage.length,
      warnings: [
        ...warnings.map((warning) => ({
          code: warning.code,
          scene_id: warning.sceneId,
          element_id: warning.elementId,
          message: warning.message,
        })),
        ...coverage.map((warning) => ({
          code: warning.code,
          scene_id: warning.sceneId,
          element_id: warning.elementId,
          message: warning.message,
        })),
      ],
    };
  }

  if (name === "studio_list_creative_projects") {
    const runtime = await runtimeContext(context);
    const limit = typeof input.limit === "number" ? input.limit : 25;
    const projects = await listRuntimeCreativeProjects(runtime, limit);
    return {
      projects: projects.map((project) => ({
        project_id: project.id,
        title: project.title,
        status: project.status,
        current_revision_id: project.currentRevisionId,
        updated_at: project.updatedAt,
        duration_ms: project.durationMs,
        scene_count: project.sceneCount,
      })),
      // The other call that opens a session - a caller resuming yesterday's
      // film lists before it reads. Same reason as on create.
      capabilities: creativeCapabilityDigest(),
    };
  }

  if (name === "studio_get_creative_project") {
    const runtime = await runtimeContext(context);
    const project = await getRuntimeCreativeProject(runtime, parseProjectId(input));
    if (!project) throw new Error("Project not found");
    const assets = await listRuntimeCreativeAssets(runtime, project.id);
    // Reading part of a project rather than all of it. Filters on this tool
    // rather than five new ones: the same brief that asked for partial reads
    // also complained the tool list is too heavy to reload, and five more
    // schemas would make that worse to fix this.
    const { isSliceRequested, parseCreativeSliceRequest, sliceCreativeDocument } =
      await import("./document-slice");
    const sliceRequest = parseCreativeSliceRequest(input);
    if (isSliceRequested(sliceRequest)) {
      return {
        project_id: project.id,
        title: project.title,
        status: project.status,
        current_revision_id: project.currentRevisionId,
        ...sliceCreativeDocument(project.document, sliceRequest),
        assets,
      };
    }

    return {
      project_id: project.id,
      title: project.title,
      status: project.status,
      current_revision_id: project.currentRevisionId,
      // The one tool whose purpose is to hand back the document, so its
      // default stays "document"; `return: "summary"` is here for a caller
      // that only wants to know where the scenes now sit.
      ...creativeDocumentPayload(project.document, parseCreativeReturnMode(input.return, "document")),
      assets,
    };
  }

  if (name === "studio_edit_creative_project") {
    const runtime = await runtimeContext(context);
    const projectId = parseProjectId(input);
    const transaction = parseCreativeTransactionInput(input.transaction);
    const thumbnailTimesMs = parseEditThumbnailTimes(input);

    // A dry run answers "would this work, and what would it look like" without
    // spending a revision. Several revisions in a real editing session were
    // corrections of a misreading of the engine rather than changes of mind,
    // and each one made the history harder to read.
    if (input.dry_run === true) {
      const project = await getRuntimeCreativeProject(runtime, projectId);
      if (!project) throw new Error("Project not found");

      const { applyCreativeTransaction } = await import("./transactions");
      const attempt = applyCreativeTransaction(project.document, transaction);
      if (!attempt.ok) {
        return {
          project_id: projectId,
          dry_run: true,
          would_apply: false,
          error: {
            code: attempt.error.code,
            message: attempt.error.message,
            operation_index: attempt.error.operationIndex ?? null,
            // roadmap #71: operations [0, validated_count) already produced a
            // valid document on their own, so a caller fixing the failure can
            // resend from validated_count onward instead of the whole
            // transaction. Always a concrete number - unlike operation_index,
            // which is null for a transaction-level failure that never
            // reached a specific operation - so a caller can slice a retry
            // (operations.slice(validated_count)) without a null check.
            validated_count: attempt.error.operationIndex ?? 0,
          },
        };
      }

      // The same checks inspect_creative_layout runs, on the document this
      // transaction would produce — so exploring costs nothing but a call.
      const { inspectCreativeSafeAreas, REELS_SAFE_AREA } = await import("./safe-area");
      const { inspectClipCoverage } = await import("./clip-coverage");
      const projectAssets = await listRuntimeCreativeAssets(runtime, projectId);
      const { diffCreativeDocuments, changedDocumentPayload } = await import("./document-diff");
      const impact = diffCreativeDocuments(project.document, attempt.document);
      const warnings = [
        ...inspectCreativeSafeAreas(attempt.document, REELS_SAFE_AREA).map((warning) => ({
          code: warning.code,
          scene_id: warning.sceneId,
          element_id: warning.elementId,
          message: warning.message,
        })),
        ...inspectClipCoverage(
          attempt.document,
          new Map(projectAssets.map((asset) => [asset.id, asset.duration_ms])),
        ).map((warning) => ({
          code: warning.code,
          scene_id: warning.sceneId,
          element_id: warning.elementId,
          message: warning.message,
        })),
      ];

      return {
        project_id: projectId,
        dry_run: true,
        would_apply: true,
        // Nothing was written, so the revision is unchanged and is reported as
        // what it still is rather than what it would become.
        current_revision_id: project.currentRevisionId,
        operations: transaction.operations.length,
        warning_count: warnings.length,
        warnings,
        impact,
        ...(input.return === "changed"
          ? changedDocumentPayload(attempt.document, impact)
          : creativeDocumentPayload(attempt.document, parseCreativeReturnMode(input.return))),
      };
    }

    const beforeProject = input.return === "changed" ? await getRuntimeCreativeProject(runtime, projectId) : null;
    let result: Awaited<ReturnType<typeof applyRuntimeCreativeTransaction>>;
    try {
      result = await applyRuntimeCreativeTransaction(runtime, projectId, transaction);
    } catch (error) {
      // A rejected transaction is reported as data, the same way dry_run
      // already reports one, rather than as an exception the caller has to
      // catch and parse (roadmap #71) - "Project not found" and every other
      // failure keep throwing. The document is untouched either way: a
      // rejected transaction never partially writes.
      if (error instanceof CreativeTransactionRejectedError) {
        // No `applied` key here, unlike the success payload below where it is
        // an operation count: a bare `error` key (absent on every success
        // response) is the discriminant, so no field has to carry two
        // different meanings depending on outcome.
        return {
          project_id: projectId,
          error: {
            code: error.code,
            // The underlying validation message, matching what dry_run's
            // error.message already is - not error.message on this object,
            // which carries the legacy "Operation N: ..." sentence for the
            // one caller (app/api/creative/direct) that only reads .message.
            message: error.detail,
            operation_index: error.operationIndex ?? null,
            validated_count: error.validatedCount,
          },
        };
      }
      throw error;
    }
    let payload: Record<string, unknown>;
    if (input.return === "changed" && beforeProject) {
      const { diffCreativeDocuments, changedDocumentPayload } = await import("./document-diff");
      const impact = diffCreativeDocuments(beforeProject.document, result.project.document);
      payload = { impact, ...changedDocumentPayload(result.project.document, impact) };
    } else {
      payload = creativeDocumentPayload(result.project.document, parseCreativeReturnMode(input.return));
    }
    let thumbnails: Awaited<ReturnType<typeof renderDocumentFrames>> | null = null;
    let thumbnailError: string | null = null;
    if (thumbnailTimesMs) {
      try {
        thumbnails = await renderDocumentFrames(context, projectId, result.project.document, result.revisionId, thumbnailTimesMs, true);
      } catch (error) {
        thumbnailError = error instanceof Error ? error.message : String(error);
      }
    }
    return {
      project_id: projectId,
      revision_id: result.revisionId,
      revision: result.sequence,
      applied: transaction.operations.length,
      ...(thumbnails ? { thumbnails: {
        revision_id: thumbnails.revisionId,
        contact_sheet_url: thumbnails.result.contactSheet?.url ?? null,
        content_type: thumbnails.result.contactSheet?.contentType ?? "image/png",
        frames: thumbnails.result.frames.map((frame) => ({ time_ms: frame.timeMs, frame: frame.frame, output_url: frame.url, content_type: frame.contentType, size_bytes: frame.sizeBytes })),
      } } : {}),
      ...(thumbnailError ? { thumbnail_error: thumbnailError } : {}),
      ...payload,
    };
  }

  if (name === "studio_render_creative_project") {
    return renderProject(context, parseCreativeProjectRenderInput(input));
  }

  if (name === "studio_get_render_job") {
    const jobId = requiredString(input, "job_id");
    const { data, error } = await context.supabase
      .from("creative_render_jobs")
      .select("id, project_id, revision_id, status, progress, output_url, content_type, size_bytes, error, renderer, metadata, credits_charged, credits_refunded_at, created_at, updated_at")
      .eq("id", jobId)
      .eq("user_id", context.user.id)
      .maybeSingle();
    if (error || !data) throw new Error("Render job not found");
    const renderSupabase = await getCreditServiceClient(context);
    const metadata = (data.metadata ?? {}) as Record<string, unknown>;
    const detached = metadata.detached_render as import("./render").CreativeDetachedRenderHandle | undefined;
    if (canClaimRenderJobPoll(data, Date.now()) && detached?.sandboxId && detached?.cmdId && typeof data.updated_at === "string") {
      const { creativeRenderAdapter } = await import("./render");
      const claim = await claimRenderJobPoll(renderSupabase, {
        jobId, userId: context.user.id, status: data.status, updatedAt: data.updated_at, metadata,
      });
      if (!claim) return { ...data, poll_in_progress: true, output_asset_id: null };
      let advanced;
      try {
        advanced = await creativeRenderAdapter.pollDetached(detached);
      } catch (pollError) {
        const message = pollError instanceof Error ? pollError.message : String(pollError);
        const now = new Date().toISOString();
        await updateClaimedRenderJob(renderSupabase, {
          jobId, userId: context.user.id, claimedAt: claim.claimedAt,
          patch: { status: "rendering", metadata: { ...metadata, phase: "poll-error" }, error: message.slice(0, 4000), updated_at: now },
        });
        throw new Error("Could not poll render job");
      }
      const now = new Date().toISOString();
      if (advanced.status === "rendering") {
        const nextMetadata = { ...metadata, phase: advanced.phase, estimated_completion_ms: advanced.estimatedCompletionMs };
        await updateClaimedRenderJob(renderSupabase, { jobId, userId: context.user.id, claimedAt: claim.claimedAt, patch: { status: "rendering", progress: advanced.progress, metadata: nextMetadata, error: null, updated_at: now } });
        return { ...data, status: "rendering", progress: advanced.progress, metadata: nextMetadata, updated_at: now, estimated_completion_ms: advanced.estimatedCompletionMs, output_asset_id: null };
      }
      if (advanced.status === "failed") {
        const retryCount = typeof metadata.retry_count === "number" ? metadata.retry_count : 0;
        if (shouldRetryDetachedRender(advanced.error, retryCount)) {
          const { data: revision } = data.revision_id
            ? await context.supabase.from("creative_project_revisions").select("document").eq("id", data.revision_id).eq("user_id", context.user.id).maybeSingle()
            : { data: null };
          const fallbackProject = revision ? null : await getRuntimeCreativeProject(await runtimeContext(context), String(data.project_id));
          const stored = (revision?.document ?? fallbackProject?.document) as CreativeDocument | undefined;
          if (stored) {
            const retryDocument = metadata.scene_id ? extractSceneDocument(stored, String(metadata.scene_id)) : stored;
            const { assets } = await resolveOwnedAssetMap(context, retryDocument);
            try {
              const handle = await creativeRenderAdapter.startDetached({
                document: retryDocument, assets,
                options: {
                  startMs: typeof metadata.start_ms === "number" ? metadata.start_ms : undefined,
                  endMs: typeof metadata.end_ms === "number" ? metadata.end_ms : undefined,
                  quality: metadata.quality === "draft" ? "draft" : "final",
                },
                outputKey: detached.outputKey,
              });
              const nextMetadata = { ...metadata, phase: "retrying-detached-render", retry_count: retryCount + 1, detached_render: handle, estimated_completion_ms: null };
              try {
                await updateClaimedRenderJob(renderSupabase, { jobId, userId: context.user.id, claimedAt: claim.claimedAt, patch: { status: "rendering", progress: 0.04, metadata: nextMetadata, error: null, updated_at: now } });
              } catch (persistError) {
                await creativeRenderAdapter.stopDetached(handle);
                throw persistError;
              }
              return { ...data, status: "rendering", progress: 0.04, metadata: nextMetadata, updated_at: now, estimated_completion_ms: null, retry_count: retryCount + 1, output_asset_id: null };
            } catch (retryError) {
              advanced = { status: "failed", progress: advanced.progress, error: retryError instanceof Error ? retryError.message : String(retryError) };
            }
          }
        }
        await updateClaimedRenderJob(renderSupabase, { jobId, userId: context.user.id, claimedAt: claim.claimedAt, patch: { status: "failed", progress: advanced.progress, error: advanced.error.slice(0, 4000), finished_at: now, updated_at: now } });
        const refundPending = await refundCreativeRenderCredits(context, jobId).then(() => false).catch(() => true);
        return { ...data, status: "failed", progress: advanced.progress, error: advanced.error, finished_at: now, updated_at: now, estimated_completion_ms: null, output_asset_id: null, refund_pending: refundPending };
      }

      const nextMetadata = { ...metadata, phase: "completed", estimated_completion_ms: Date.now() };
      await updateClaimedRenderJob(renderSupabase, { jobId, userId: context.user.id, claimedAt: claim.claimedAt, patch: { status: "completed", progress: 1, output_url: advanced.url, content_type: advanced.contentType, size_bytes: advanced.sizeBytes, metadata: nextMetadata, finished_at: now, updated_at: now } });
      await creativeRenderAdapter.stopDetached(detached);
      let outputAssetId: string | null = null;
      try {
        const registered = await registerRuntimeCreativeAsset(await runtimeContext(context), {
          projectId: String(data.project_id), kind: "video", source: "render", url: advanced.url,
          mimeType: advanced.contentType, filename: `${metadata.scene_id ? "clip" : "film"}-${jobId}.mp4`,
          width: Number(metadata.output_width) || null, height: Number(metadata.output_height) || null,
          durationMs: Number(metadata.duration_ms) || null, sizeBytes: advanced.sizeBytes,
          metadata: { render_job_id: jobId, scene_id: metadata.scene_id ?? null, source: "mcp", start_ms: metadata.start_ms, end_ms: metadata.end_ms, quality: metadata.quality },
        });
        outputAssetId = String(registered.id);
      } catch { /* a persisted render is still successful */ }
      const completedMetadata = { ...nextMetadata, output_asset_id: outputAssetId };
      if (outputAssetId) {
        const { error: metadataError } = await renderSupabase.from("creative_render_jobs").update({ metadata: completedMetadata, updated_at: now }).eq("id", jobId).eq("user_id", context.user.id).eq("status", "completed");
        if (metadataError) outputAssetId = null;
      }
      return { ...data, status: "completed", progress: 1, output_url: advanced.url, content_type: advanced.contentType, size_bytes: advanced.sizeBytes, metadata: outputAssetId ? completedMetadata : nextMetadata, finished_at: now, updated_at: now, estimated_completion_ms: Date.now(), output_asset_id: outputAssetId };
    }

    if (data.status === "queued" && metadata.phase === "polling-detached") {
      return { ...data, poll_in_progress: true, output_asset_id: null };
    }

    // Same reasoning as the HTTP status route: a job whose worker was killed
    // has no other chance to be closed out, and would otherwise poll forever.
    if (isRenderJobStale(data, Date.now())) {
      const finishedAt = new Date().toISOString();
      const { data: claimed, error: staleError } = await renderSupabase
        .from("creative_render_jobs")
        .update({ status: "failed", error: RENDER_JOB_STALE_MESSAGE, finished_at: finishedAt, updated_at: finishedAt })
        .eq("id", jobId)
        .eq("user_id", context.user.id)
        .eq("status", data.status)
        .eq("updated_at", data.updated_at)
        .select("id")
        .maybeSingle();
      if (staleError) throw new Error(`Could not close stale render job: ${staleError.message}`);
      if (!claimed) return { ...data, poll_in_progress: true };
      const refundPending = await refundCreativeRenderCredits(context, jobId).then(() => false).catch(() => true);
      return { ...data, status: "failed", error: RENDER_JOB_STALE_MESSAGE, updated_at: finishedAt, refund_pending: refundPending };
    }
    if (data.status === "failed" && Number(data.credits_charged) > 0 && !data.credits_refunded_at) {
      const refundPending = await refundCreativeRenderCredits(context, jobId).then(() => false).catch(() => true);
      return { ...data, refund_pending: refundPending };
    }
    // Lifted out of metadata so a caller does not have to know it lives there:
    // this is the id to hand to studio_inspect_video_asset to look at the
    // film that was just rendered.
    return {
      ...data,
      estimated_completion_ms: typeof metadata.estimated_completion_ms === "number" ? metadata.estimated_completion_ms : null,
      output_asset_id: typeof metadata.output_asset_id === "string" ? metadata.output_asset_id : null,
    };
  }

  if (name === "studio_generate_image_asset") {
    const runtime = await runtimeContext(context, input.site_id);
    const projectId = parseProjectId(input);
    const prompt = requiredString(input, "prompt");
    const referenceImages = Array.isArray(input.reference_images)
      ? input.reference_images.map(String).filter((url) => /^https:\/\//i.test(url)).slice(0, 12)
      : [];
    const { generateCreativeImageAsset, normalizeCreativeImageFormat } = await import("./workers");
    const asset = await withCredits(context, "creative_image", CREDIT_COSTS.creative_image, () =>
      generateCreativeImageAsset(runtime, {
        projectId,
        prompt,
        format: normalizeCreativeImageFormat(input.format),
        label: typeof input.label === "string" ? input.label : undefined,
        referenceImages,
      }),
    );
    return { project_id: projectId, asset };
  }

  if (name === "studio_generate_speech_asset") {
    const runtime = await runtimeContext(context, input.site_id);
    const projectId = parseProjectId(input);
    const { generateCreativeSpeechAsset } = await import("./workers");
    const asset = await withCredits(context, "creative_speech", CREDIT_COSTS.creative_speech, () =>
      generateCreativeSpeechAsset(runtime, {
        projectId,
        text: requiredString(input, "text"),
        transcript: typeof input.transcript === "string" ? input.transcript : undefined,
        language: typeof input.language === "string" ? input.language : undefined,
        voice: typeof input.voice === "string" ? input.voice : undefined,
        label: typeof input.label === "string" ? input.label : undefined,
      }),
    );
    const assetMetadata = "metadata" in asset ? asset.metadata as Record<string, unknown> | null : null;
    const timing = assetMetadata?.voiceover_timing as import("./voiceover-timing").VoiceoverTiming | undefined;
    const granularity = input.marker_granularity === "words" || input.marker_granularity === "sentences" ? input.marker_granularity : "both";
    const offsetMs = input.marker_offset_ms === undefined ? 0 : parseTimeMs(input.marker_offset_ms, "marker_offset_ms");
    const markers = timing ? (await import("./voiceover-timing")).voiceoverTimingsToMarkers(String(asset.id), timing, { offsetMs, granularity }) : [];
    return { project_id: projectId, asset, timing, markers };
  }

  if (name === "studio_generate_music_asset") {
    const runtime = await runtimeContext(context, input.site_id);
    const projectId = parseProjectId(input);
    const { generateCreativeMusicAsset } = await import("./workers");
    const asset = await withCredits(context, "creative_music", CREDIT_COSTS.creative_music, () =>
      generateCreativeMusicAsset(runtime, {
        projectId,
        prompt: requiredString(input, "prompt"),
        label: typeof input.label === "string" ? input.label : undefined,
      }),
    );
    return { project_id: projectId, asset };
  }

  if (name === "studio_add_sfx_asset") {
    const runtime = await runtimeContext(context, input.site_id);
    const projectId = parseProjectId(input);
    const effectId = requiredString(input, "effect_id");
    const { CREATIVE_SFX_LIBRARY } = await import("./sfx-library");
    if (!CREATIVE_SFX_LIBRARY.some((effect) => effect.id === effectId)) throw new Error(`Unknown SFX ${effectId}`);
    const { addCreativeSfxAsset } = await import("./workers");
    const asset = await addCreativeSfxAsset(runtime, { projectId, effectId: effectId as import("./sfx-library").CreativeSfxId, label: typeof input.label === "string" ? input.label : undefined });
    return { project_id: projectId, asset, effect_id: effectId };
  }

  if (name === "studio_promote_video_asset") {
    const runtime = await runtimeContext(context, input.site_id);
    const projectId = parseProjectId(input);
    const generationId = requiredString(input, "generation_id");
    const { promoteCreativeVideoAsset } = await import("./workers");
    const asset = await promoteCreativeVideoAsset(runtime, {
      projectId,
      generationId,
      label: typeof input.label === "string" ? input.label : undefined,
    });
    return { project_id: projectId, asset };
  }

  if (name === "studio_import_svg") {
    const runtime = await runtimeContext(context, input.site_id);
    const svg = requiredString(input, "svg");
    const title = typeof input.title === "string" && input.title.trim() ? input.title.trim() : "Imported SVG";
    const { importBasicSvg } = await import("./import");
    const imported = importBasicSvg(svg, title);
    if (!imported.ok) throw new Error(imported.error);
    const project = await createRuntimeCreativeProject(runtime, title, imported.document);
    return {
      project_id: project.id,
      current_revision_id: project.currentRevisionId,
      warnings: imported.warnings,
      ...creativeDocumentPayload(project.document, parseCreativeReturnMode(input.return)),
    };
  }

  if (name === "studio_get_creative_changes") {
    const runtime = await runtimeContext(context);
    const projectId = parseProjectId(input);
    const project = await getRuntimeCreativeProject(runtime, projectId);
    if (!project) throw new Error("Project not found");
    const sinceRevisionId = requiredString(input, "since_revision_id");
    const { data, error } = await context.supabase
      .from("creative_project_revisions")
      .select("id, sequence, document, change_summary")
      .eq("id", sinceRevisionId)
      .eq("project_id", projectId)
      .eq("user_id", context.user.id)
      .maybeSingle();
    if (error || !data) throw new Error("Revision not found");
    const { diffCreativeDocuments, changedDocumentPayload } = await import("./document-diff");
    const changes = diffCreativeDocuments(data.document as CreativeDocument, project.document);
    return {
      project_id: projectId,
      since_revision_id: sinceRevisionId,
      since_revision: data.sequence,
      current_revision_id: project.currentRevisionId,
      changes,
      ...changedDocumentPayload(project.document, changes),
    };
  }

  if (name === "studio_list_creative_revisions") {
    const runtime = await runtimeContext(context);
    const projectId = parseProjectId(input);
    if (!await getRuntimeCreativeProject(runtime, projectId)) throw new Error("Project not found");
    const { data, error } = await context.supabase
      .from("creative_project_revisions")
      .select("id, sequence, change_summary, created_at")
      .eq("project_id", projectId)
      .eq("user_id", context.user.id)
      .order("sequence", { ascending: true });
    if (error) throw new Error(error.message);
    return { project_id: projectId, revisions: data ?? [] };
  }

  if (name === "studio_restore_creative_revision") {
    const runtime = await runtimeContext(context);
    const projectId = parseProjectId(input);
    const restored = await restoreRuntimeCreativeRevision(runtime, projectId, requiredString(input, "revision_id"));
    const project = await getRuntimeCreativeProject(runtime, projectId);
    if (!project) throw new Error("Project not found after restore");
    return {
      project_id: projectId,
      revision_id: restored.revisionId,
      revision: restored.sequence,
      // A restore is the case where the caller genuinely does not know the
      // state it just moved to, so this one defaults to the whole document.
      ...creativeDocumentPayload(project.document, parseCreativeReturnMode(input.return, "document")),
    };
  }

  // Unknown names never fall through to an asset write; the ChatGPT surface
  // dispatches exactly the tools it advertises.
  if (name !== "studio_add_asset") throw new Error(`Unknown creative tool: ${String(name)}`);

  const runtime = await runtimeContext(context, input.site_id);
  const url = typeof input.url === "string" ? input.url.trim() : "";
  const kind = typeof input.kind === "string" ? input.kind.trim() : "";
  if (!url || !kind) throw new Error("url and kind are required");
  const asset = await registerRuntimeCreativeAsset(runtime, {
    projectId: typeof input.project_id === "string" ? input.project_id.trim() || null : null,
    kind,
    source: typeof input.source === "string" ? input.source : "external",
    url,
    mimeType: typeof input.mime_type === "string" ? input.mime_type : null,
    filename: typeof input.filename === "string" ? input.filename : null,
    metadata: { added_via: "mcp" },
  });
  return { asset };
}
