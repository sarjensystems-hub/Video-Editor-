import type { VideoAspectRatio, VideoJobState, VideoResolution } from "../video-gen";
import type {
  VideoMode,
  GenerateVideoRequest,
  VideoProvider,
  VideoProviderName,
  VideoReference,
} from "./types";

export interface UserVideoJob {
  id: string;
  userId: string;
  siteId: string;
  provider: VideoProviderName;
  providerJobId: string | null;
  model: string;
  mode: VideoMode;
  status: VideoJobState;
  prompt: string;
  aspectRatio: VideoAspectRatio;
  resolution: VideoResolution;
  duration: number;
  generateAudio: boolean;
  videoUrl: string | null;
  error: string | null;
  costUsd: number | null;
  creditsCharged: number;
  refundedAt: string | null;
  mcpIdempotencyKey: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface ReserveUserVideoJobInput {
  userId: string;
  siteId: string;
  provider: VideoProviderName;
  model: string;
  mode: VideoMode;
  prompt: string;
  aspectRatio: VideoAspectRatio;
  resolution: VideoResolution;
  duration: number;
  generateAudio: boolean;
  references: VideoReference[];
  idempotencyKey: string;
}

export interface UserVideoRepository {
  resolveSite(userId: string, requestedSiteId?: string): Promise<string | null>;
  findByIdempotency(userId: string, key: string): Promise<UserVideoJob | null>;
  reserve(input: ReserveUserVideoJobInput): Promise<{ job: UserVideoJob; created: boolean }>;
  deleteReservation(userId: string, id: string): Promise<void>;
  getById(userId: string, id: string): Promise<UserVideoJob | null>;
  update(userId: string, id: string, patch: Partial<UserVideoJob>): Promise<UserVideoJob>;
}

export interface UserCreditLedger {
  deduct(
    userId: string,
    amount: number,
    action: string,
  ): Promise<{ allowed: boolean; balance: number; cost: number; error?: string }>;
  refundVideoOnce(userId: string, jobId: string): Promise<boolean>;
}

type ProviderResolver = (name: VideoProviderName) => VideoProvider;
type CostResolver = (duration: number, resolution: VideoResolution) => number;
type StoreVideo = (job: UserVideoJob, bytes: Buffer, contentType: string) => Promise<string | null>;

const CREDIT_ACTION = "video_generation";
const TERMINAL_FAILURES = new Set<VideoJobState>(["failed", "cancelled", "expired"]);

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function isHttpsUrl(value: string | null | undefined): value is string {
  if (!value) return false;
  try {
    return new URL(value).protocol === "https:";
  } catch {
    return false;
  }
}

export class UserVideoOrchestrator {
  private repo: UserVideoRepository;
  private credits: UserCreditLedger;
  private resolveProvider: ProviderResolver;
  private resolveCost: CostResolver;
  private storeVideo: StoreVideo;

  constructor(
    repo: UserVideoRepository,
    credits: UserCreditLedger,
    resolveProvider: ProviderResolver,
    resolveCost: CostResolver,
    storeVideo: StoreVideo,
  ) {
    this.repo = repo;
    this.credits = credits;
    this.resolveProvider = resolveProvider;
    this.resolveCost = resolveCost;
    this.storeVideo = storeVideo;
  }

  private async refundOnce(job: UserVideoJob): Promise<void> {
    if (job.creditsCharged <= 0) return;
    await this.credits.refundVideoOnce(job.userId, job.id);
  }

  async start(userId: string, request: GenerateVideoRequest): Promise<UserVideoJob> {
    const existing = await this.repo.findByIdempotency(userId, request.idempotencyKey);
    if (existing) return existing;

    const siteId = await this.repo.resolveSite(userId, request.siteId);
    if (!siteId) {
      throw new Error("No Studio site is available. Create a site in Studio first.");
    }

    const provider = this.resolveProvider(request.provider);
    const model = provider.resolveModel(request);
    const reservation = await this.repo.reserve({
      userId,
      siteId,
      provider: request.provider,
      model,
      mode: request.mode,
      prompt: request.prompt,
      aspectRatio: request.aspectRatio,
      resolution: request.resolution,
      duration: request.duration,
      generateAudio: request.generateAudio,
      references: request.references,
      idempotencyKey: request.idempotencyKey,
    });
    if (!reservation.created) return reservation.job;

    const quotedCost = this.resolveCost(request.duration, request.resolution);
    const credit = await this.credits.deduct(userId, quotedCost, CREDIT_ACTION);
    if (!credit.allowed) {
      await this.repo.deleteReservation(userId, reservation.job.id);
      throw new Error(credit.error || "Not enough credits.");
    }

    try {
      const submission = await provider.submit(request);
      const updated = await this.repo.update(userId, reservation.job.id, {
        providerJobId: submission.id,
        status: submission.status === "in_progress" ? "in_progress" : submission.status,
        creditsCharged: credit.cost,
        error: null,
      });
      if (TERMINAL_FAILURES.has(updated.status)) await this.refundOnce(updated);
      return updated;
    } catch (error) {
      const failed = await this.repo.update(userId, reservation.job.id, {
        status: "failed",
        error: errorMessage(error),
        creditsCharged: credit.cost,
      });
      await this.refundOnce(failed);
      throw error;
    }
  }

  async get(userId: string, id: string): Promise<UserVideoJob | null> {
    const current = await this.repo.getById(userId, id);
    if (!current) return null;
    if (current.status === "completed" && current.videoUrl) return current;
    if (TERMINAL_FAILURES.has(current.status)) return current;

    if (!current.providerJobId) {
      const failed = await this.repo.update(userId, current.id, {
        status: "failed",
        error: "Provider job was not created.",
      });
      await this.refundOnce(failed);
      return failed;
    }

    const provider = this.resolveProvider(current.provider);
    const upstream = await provider.getStatus(current.providerJobId);

    if (upstream.status === "pending" || upstream.status === "in_progress") {
      if (upstream.status === current.status && upstream.costUsd === undefined) return current;
      return this.repo.update(userId, current.id, {
        status: upstream.status,
        error: null,
        costUsd: upstream.costUsd ?? current.costUsd,
      });
    }

    if (upstream.status === "completed") {
      try {
        const { bytes, contentType } = await provider.download(current.providerJobId);
        const url = await this.storeVideo(current, bytes, contentType);
        if (!isHttpsUrl(url)) {
          throw new Error("Durable video storage did not return a public HTTPS URL.");
        }
        return this.repo.update(userId, current.id, {
          status: "completed",
          videoUrl: url,
          error: null,
          costUsd: upstream.costUsd ?? current.costUsd,
        });
      } catch (error) {
        const failed = await this.repo.update(userId, current.id, {
          status: "failed",
          error: errorMessage(error),
          costUsd: upstream.costUsd ?? current.costUsd,
        });
        await this.refundOnce(failed);
        return failed;
      }
    }

    const failed = await this.repo.update(userId, current.id, {
      status: upstream.status,
      error: upstream.error ?? "Video generation failed.",
      costUsd: upstream.costUsd ?? current.costUsd,
    });
    await this.refundOnce(failed);
    return failed;
  }
}

export function serializeUserVideoJob(job: UserVideoJob) {
  return {
    job_id: job.id,
    status: job.status,
    provider: job.provider,
    model: job.model,
    mode: job.mode,
    video_url: job.videoUrl,
    error: job.error,
    cost_usd: job.costUsd,
    credits_charged: job.creditsCharged,
    site_id: job.siteId,
    created_at: job.createdAt,
    updated_at: job.updatedAt,
  };
}
