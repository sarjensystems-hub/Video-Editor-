import type { SupabaseClient } from "@supabase/supabase-js";
import { isBypassEmail, videoGenerationCost } from "../credit-costs";
import type { McpUserContext } from "../mcp-oauth";
import { uploadAnyBytes } from "../storage";
import type { VideoJobState } from "../video-gen";
import { getVideoProvider } from "./provider";
import { parseGenerateVideoRequest, type VideoMode, type VideoProviderName } from "./types";
import {
  serializeUserVideoJob,
  UserVideoOrchestrator,
  type ReserveUserVideoJobInput,
  type UserCreditLedger,
  type UserVideoJob,
  type UserVideoRepository,
} from "./user-orchestrator";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function mapRow(row: Record<string, unknown>): UserVideoJob {
  return {
    id: String(row.id),
    userId: String(row.user_id),
    siteId: String(row.site_id),
    provider: (row.provider || "openrouter") as VideoProviderName,
    providerJobId: typeof row.openrouter_job_id === "string" ? row.openrouter_job_id : null,
    model: typeof row.model === "string" ? row.model : "bytedance/seedance-2.0-fast",
    mode: (typeof row.mode === "string" ? row.mode : "cinematic") as VideoMode,
    status: String(row.status) as VideoJobState,
    prompt: String(row.prompt),
    aspectRatio: row.aspect_ratio as UserVideoJob["aspectRatio"],
    resolution: row.resolution as UserVideoJob["resolution"],
    duration: Number(row.duration_seconds),
    generateAudio: row.generate_audio === true,
    videoUrl: typeof row.video_url === "string" ? row.video_url : null,
    error: typeof row.error === "string" ? row.error : null,
    costUsd: row.cost_usd === null || row.cost_usd === undefined ? null : Number(row.cost_usd),
    creditsCharged: Number(row.credits_charged ?? 0),
    refundedAt: typeof row.credits_refunded_at === "string" ? row.credits_refunded_at : null,
    mcpIdempotencyKey:
      typeof row.mcp_idempotency_key === "string" ? row.mcp_idempotency_key : null,
    createdAt: String(row.created_at),
    updatedAt: String(row.updated_at),
  };
}

function mapReferences(input: ReserveUserVideoJobInput) {
  return input.references.map((reference, index) => ({
    name: reference.label?.trim() || reference.role || `Reference ${index + 1}`,
    url: reference.url,
  }));
}

class SupabaseUserVideoRepository implements UserVideoRepository {
  private supabase: SupabaseClient;

  constructor(supabase: SupabaseClient) {
    this.supabase = supabase;
  }

  async resolveSite(userId: string, requestedSiteId?: string): Promise<string | null> {
    if (requestedSiteId) {
      const { data, error } = await this.supabase
        .from("sites")
        .select("id")
        .eq("user_id", userId)
        .eq("id", requestedSiteId)
        .maybeSingle();
      if (error) throw new Error(`Could not verify site: ${error.message}`);
      if (!data) throw new Error("site_id does not belong to the authenticated Studio user.");
      return String(data.id);
    }

    const { data: defaults, error: defaultError } = await this.supabase
      .from("sites")
      .select("id")
      .eq("user_id", userId)
      .eq("is_default", true)
      .order("created_at", { ascending: true })
      .limit(1);
    if (defaultError) throw new Error(`Could not resolve default site: ${defaultError.message}`);
    if (defaults?.[0]?.id) return String(defaults[0].id);

    const { data: oldest, error: oldestError } = await this.supabase
      .from("sites")
      .select("id")
      .eq("user_id", userId)
      .order("created_at", { ascending: true })
      .limit(1);
    if (oldestError) throw new Error(`Could not resolve site: ${oldestError.message}`);
    return oldest?.[0]?.id ? String(oldest[0].id) : null;
  }

  async findByIdempotency(userId: string, key: string): Promise<UserVideoJob | null> {
    const { data, error } = await this.supabase
      .from("video_generations")
      .select("*")
      .eq("user_id", userId)
      .eq("mcp_idempotency_key", key)
      .maybeSingle();
    if (error) throw new Error(`Could not check video idempotency: ${error.message}`);
    return data ? mapRow(data as Record<string, unknown>) : null;
  }

  async reserve(input: ReserveUserVideoJobInput): Promise<{ job: UserVideoJob; created: boolean }> {
    const { data, error } = await this.supabase
      .from("video_generations")
      .insert({
        user_id: input.userId,
        site_id: input.siteId,
        openrouter_job_id: null,
        status: "pending",
        prompt: input.prompt,
        characters: mapReferences(input),
        aspect_ratio: input.aspectRatio,
        resolution: input.resolution,
        duration_seconds: input.duration,
        generate_audio: input.generateAudio,
        credits_charged: 0,
        provider: input.provider,
        model: input.model,
        mode: input.mode,
        mcp_idempotency_key: input.idempotencyKey,
      })
      .select("*")
      .single();

    if (!error && data) return { job: mapRow(data as Record<string, unknown>), created: true };

    if (error?.code === "23505") {
      const existing = await this.findByIdempotency(input.userId, input.idempotencyKey);
      if (existing) return { job: existing, created: false };
    }

    throw new Error(`Could not reserve video job: ${error?.message ?? "Unknown database error"}`);
  }

  async deleteReservation(userId: string, id: string): Promise<void> {
    const { error } = await this.supabase
      .from("video_generations")
      .delete()
      .eq("user_id", userId)
      .eq("id", id)
      .is("openrouter_job_id", null)
      .eq("credits_charged", 0);
    if (error) throw new Error(`Could not remove unused video reservation: ${error.message}`);
  }

  async getById(userId: string, id: string): Promise<UserVideoJob | null> {
    const { data, error } = await this.supabase
      .from("video_generations")
      .select("*")
      .eq("user_id", userId)
      .eq("id", id)
      .maybeSingle();
    if (error) throw new Error(`Could not read video job: ${error.message}`);
    return data ? mapRow(data as Record<string, unknown>) : null;
  }

  async update(userId: string, id: string, patch: Partial<UserVideoJob>): Promise<UserVideoJob> {
    const dbPatch: Record<string, unknown> = { updated_at: new Date().toISOString() };
    if (patch.siteId !== undefined) dbPatch.site_id = patch.siteId;
    if (patch.provider !== undefined) dbPatch.provider = patch.provider;
    if (patch.providerJobId !== undefined) dbPatch.openrouter_job_id = patch.providerJobId;
    if (patch.model !== undefined) dbPatch.model = patch.model;
    if (patch.mode !== undefined) dbPatch.mode = patch.mode;
    if (patch.status !== undefined) dbPatch.status = patch.status;
    if (patch.prompt !== undefined) dbPatch.prompt = patch.prompt;
    if (patch.aspectRatio !== undefined) dbPatch.aspect_ratio = patch.aspectRatio;
    if (patch.resolution !== undefined) dbPatch.resolution = patch.resolution;
    if (patch.duration !== undefined) dbPatch.duration_seconds = patch.duration;
    if (patch.generateAudio !== undefined) dbPatch.generate_audio = patch.generateAudio;
    if (patch.videoUrl !== undefined) dbPatch.video_url = patch.videoUrl;
    if (patch.error !== undefined) dbPatch.error = patch.error;
    if (patch.costUsd !== undefined) dbPatch.cost_usd = patch.costUsd;
    if (patch.creditsCharged !== undefined) dbPatch.credits_charged = patch.creditsCharged;
    if (patch.refundedAt !== undefined) dbPatch.credits_refunded_at = patch.refundedAt;
    if (patch.mcpIdempotencyKey !== undefined) dbPatch.mcp_idempotency_key = patch.mcpIdempotencyKey;

    const { data, error } = await this.supabase
      .from("video_generations")
      .update(dbPatch)
      .eq("user_id", userId)
      .eq("id", id)
      .select("*")
      .single();
    if (error || !data) throw new Error(`Could not update video job: ${error?.message ?? "Not found"}`);
    return mapRow(data as Record<string, unknown>);
  }
}

class SupabaseUserCreditLedger implements UserCreditLedger {
  private context: McpUserContext;

  constructor(context: McpUserContext) {
    this.context = context;
  }

  async deduct(userId: string, amount: number, action: string) {
    if (userId !== this.context.user.id) throw new Error("Authenticated user mismatch.");
    if (isBypassEmail(this.context.user.email)) {
      return { allowed: true, balance: 999999, cost: 0 };
    }

    const { data, error } = await this.context.supabase.rpc("deduct_credits", {
      p_user_id: userId,
      p_amount: amount,
      p_action: action,
    });

    if (!error) return { allowed: true, balance: Number(data ?? 0), cost: amount };

    if (error.message.includes("insufficient_credits")) {
      const { data: row } = await this.context.supabase
        .from("user_credits")
        .select("balance")
        .eq("user_id", userId)
        .maybeSingle();
      const balance = Number(row?.balance ?? 0);
      return {
        allowed: false,
        balance,
        cost: amount,
        error: `Not enough credits. This action costs ${amount} credits and you have ${balance}. Top up your balance to continue.`,
      };
    }

    return { allowed: false, balance: 0, cost: amount, error: "Credit check failed. Please try again." };
  }

  async refundVideoOnce(userId: string, jobId: string): Promise<boolean> {
    if (userId !== this.context.user.id) throw new Error("Authenticated user mismatch.");
    const { data, error } = await this.context.supabase.rpc("refund_video_generation_once", {
      p_job_id: jobId,
    });
    if (error) throw new Error(`Could not refund video credits: ${error.message}`);
    return data === true;
  }
}

function extensionFromContentType(contentType: string): string {
  const value = contentType.toLowerCase();
  if (value.includes("webm")) return "webm";
  if (value.includes("quicktime")) return "mov";
  return "mp4";
}

function createUserOrchestrator(context: McpUserContext) {
  const repo = new SupabaseUserVideoRepository(context.supabase);
  const credits = new SupabaseUserCreditLedger(context);
  return new UserVideoOrchestrator(
    repo,
    credits,
    getVideoProvider,
    videoGenerationCost,
    async (job, bytes, contentType) => {
      const extension = extensionFromContentType(contentType);
      return uploadAnyBytes(bytes, `${job.userId}/video-${job.id}.${extension}`, contentType);
    },
  );
}

export async function startMcpUserVideoJob(context: McpUserContext, input: unknown) {
  // The upstream product gated video generation behind a paid entitlement and
  // charged per second. This deployment bills the company's own OpenRouter
  // account directly, so there is nothing to gate and nothing to meter — the
  // web route is ungated for the same reason.
  const request = parseGenerateVideoRequest(input);
  const job = await createUserOrchestrator(context).start(context.user.id, request);
  return serializeUserVideoJob(job);
}

export async function getMcpUserVideoJob(context: McpUserContext, id: string) {
  if (!UUID_RE.test(id)) return null;
  const job = await createUserOrchestrator(context).get(context.user.id, id);
  return job ? serializeUserVideoJob(job) : null;
}
