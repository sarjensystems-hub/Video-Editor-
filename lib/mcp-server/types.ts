import {
  MAX_VIDEO_CHARACTERS,
  VIDEO_ASPECT_RATIOS,
  VIDEO_MAX_DURATION,
  VIDEO_MIN_DURATION,
  VIDEO_RESOLUTIONS,
} from "../video-gen";
import type { VideoAspectRatio, VideoJobState, VideoResolution } from "../video-gen";

export const VIDEO_MODES = ["cinematic", "automotive_broll", "image_to_video", "avatar"] as const;
export type VideoMode = (typeof VIDEO_MODES)[number];

export const VIDEO_REFERENCE_ROLES = ["vehicle", "person", "product", "brand", "first_frame", "style"] as const;
export type VideoReferenceRole = (typeof VIDEO_REFERENCE_ROLES)[number];

export type VideoProviderName = "openrouter";

export interface VideoReference {
  url: string;
  label?: string;
  role?: VideoReferenceRole;
}

export interface GenerateVideoRequest {
  prompt: string;
  mode: VideoMode;
  references: VideoReference[];
  aspectRatio: VideoAspectRatio;
  resolution: VideoResolution;
  duration: number;
  generateAudio: boolean;
  provider: VideoProviderName;
  model?: string;
  idempotencyKey: string;
  siteId?: string;
}

export interface ProviderSubmission {
  id: string;
  status: VideoJobState;
}

export interface ProviderStatus {
  id: string;
  status: VideoJobState;
  error?: string;
  costUsd?: number | null;
}

export interface VideoProvider {
  readonly name: VideoProviderName;
  resolveModel(request: GenerateVideoRequest): string;
  submit(request: GenerateVideoRequest): Promise<ProviderSubmission>;
  getStatus(providerJobId: string): Promise<ProviderStatus>;
  download(providerJobId: string): Promise<{ bytes: Buffer; contentType: string }>;
}

export interface VideoJob {
  id: string;
  idempotencyKey: string;
  provider: VideoProviderName;
  providerJobId: string | null;
  model: string;
  mode: VideoMode;
  status: VideoJobState;
  prompt: string;
  references: VideoReference[];
  aspectRatio: VideoAspectRatio;
  resolution: VideoResolution;
  duration: number;
  generateAudio: boolean;
  videoUrl: string | null;
  error: string | null;
  costUsd: number | null;
  createdAt: string;
  updatedAt: string;
}

export interface CreatePendingVideoJob {
  idempotencyKey: string;
  provider: VideoProviderName;
  model: string;
  mode: VideoMode;
  prompt: string;
  references: VideoReference[];
  aspectRatio: VideoAspectRatio;
  resolution: VideoResolution;
  duration: number;
  generateAudio: boolean;
}

export interface VideoJobRepository {
  findByIdempotencyKey(key: string): Promise<VideoJob | null>;
  createPending(input: CreatePendingVideoJob): Promise<{ job: VideoJob; created: boolean }>;
  getById(id: string): Promise<VideoJob | null>;
  update(id: string, patch: Partial<VideoJob>): Promise<VideoJob>;
}

export class VideoValidationError extends Error {}

function record(input: unknown): Record<string, unknown> {
  if (!input || typeof input !== "object" || Array.isArray(input)) {
    throw new VideoValidationError("Video request must be an object.");
  }
  return input as Record<string, unknown>;
}

function nonEmptyString(value: unknown, name: string): string {
  if (typeof value !== "string" || !value.trim()) {
    throw new VideoValidationError(`${name} is required.`);
  }
  return value.trim();
}

function optionalString(value: unknown, name: string): string | undefined {
  if (value === undefined || value === null || value === "") return undefined;
  if (typeof value !== "string" || !value.trim()) {
    throw new VideoValidationError(`${name} must be a non-empty string.`);
  }
  return value.trim();
}

function oneOf<T extends readonly string[]>(
  value: unknown,
  allowed: T,
  name: string,
  fallback: T[number],
): T[number] {
  if (value === undefined || value === null || value === "") return fallback;
  if (typeof value !== "string" || !allowed.includes(value as T[number])) {
    throw new VideoValidationError(`${name} must be one of: ${allowed.join(", ")}.`);
  }
  return value as T[number];
}

function parseReference(value: unknown, index: number): VideoReference {
  const r = record(value);
  const url = nonEmptyString(r.url, `references[${index}].url`);
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    throw new VideoValidationError(`references[${index}].url must be a valid HTTP(S) URL.`);
  }
  if (parsed.protocol !== "https:" && parsed.protocol !== "http:") {
    throw new VideoValidationError(`references[${index}].url must be a valid HTTP(S) URL.`);
  }

  const label = optionalString(r.label, `references[${index}].label`);
  const role = r.role === undefined
    ? undefined
    : oneOf(r.role, VIDEO_REFERENCE_ROLES, `references[${index}].role`, "vehicle");
  return { url, label, role };
}

export function parseGenerateVideoRequest(input: unknown): GenerateVideoRequest {
  const r = record(input);
  const prompt = nonEmptyString(r.prompt, "prompt");
  const idempotencyKey = nonEmptyString(r.idempotency_key ?? r.idempotencyKey, "idempotency_key");
  const mode = oneOf(r.mode, VIDEO_MODES, "mode", "cinematic");
  if (mode === "avatar") {
    throw new VideoValidationError("Avatar video generation is not configured yet.");
  }

  const provider = oneOf(r.provider, ["openrouter"] as const, "provider", "openrouter");
  const aspectRatio = oneOf(r.aspect_ratio ?? r.aspectRatio, VIDEO_ASPECT_RATIOS, "aspect_ratio", "9:16");
  const resolution = oneOf(r.resolution, VIDEO_RESOLUTIONS, "resolution", "720p");
  const durationRaw = r.duration ?? r.duration_seconds ?? 5;
  if (
    typeof durationRaw !== "number" ||
    !Number.isInteger(durationRaw) ||
    durationRaw < VIDEO_MIN_DURATION ||
    durationRaw > VIDEO_MAX_DURATION
  ) {
    throw new VideoValidationError(
      `duration must be an integer from ${VIDEO_MIN_DURATION} to ${VIDEO_MAX_DURATION} seconds.`,
    );
  }

  const audioRaw = r.generate_audio ?? r.generateAudio ?? true;
  if (typeof audioRaw !== "boolean") {
    throw new VideoValidationError("generate_audio must be a boolean.");
  }

  const refsRaw = r.references ?? [];
  if (!Array.isArray(refsRaw)) throw new VideoValidationError("references must be an array.");
  if (refsRaw.length > MAX_VIDEO_CHARACTERS) {
    throw new VideoValidationError(`references supports at most ${MAX_VIDEO_CHARACTERS} images.`);
  }
  const references = refsRaw.map(parseReference);
  const model = optionalString(r.model, "model");
  const siteId = optionalString(r.site_id ?? r.siteId, "site_id");

  return {
    prompt,
    idempotencyKey,
    mode,
    provider,
    aspectRatio,
    resolution,
    duration: durationRaw,
    generateAudio: audioRaw,
    references,
    model,
    siteId,
  };
}

export function serializeVideoJob(job: VideoJob) {
  return {
    job_id: job.id,
    status: job.status,
    provider: job.provider,
    model: job.model,
    mode: job.mode,
    video_url: job.videoUrl,
    error: job.error,
    cost_usd: job.costUsd,
    created_at: job.createdAt,
    updated_at: job.updatedAt,
  };
}

export const TERMINAL_VIDEO_STATES = new Set<VideoJobState>([
  "completed",
  "failed",
  "cancelled",
  "expired",
]);
