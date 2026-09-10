import {
  DEFAULT_VIDEO_MODEL,
  downloadVideoContent,
  pollVideoJob,
  submitVideoJob,
} from "../video-gen-api";
import type { SubmitVideoJobParams } from "../video-gen-api";
import type { VideoJobState } from "../video-gen";
import type {
  GenerateVideoRequest,
  ProviderStatus,
  VideoProvider,
  VideoProviderName,
} from "./types";

type OpenRouterApi = {
  submitVideoJob: (params: SubmitVideoJobParams) => Promise<{ id: string; status: string }>;
  pollVideoJob: (jobId: string) => Promise<{
    id: string;
    status: VideoJobState;
    error?: string;
    usage?: { cost: number | null; is_byok: boolean };
  }>;
  downloadVideoContent: (jobId: string, index?: number) => Promise<{ bytes: Buffer; contentType: string }>;
};

const DEFAULT_API: OpenRouterApi = { submitVideoJob, pollVideoJob, downloadVideoContent };

function normalizeSubmissionStatus(status: string): VideoJobState {
  if (
    status === "in_progress" ||
    status === "pending" ||
    status === "failed" ||
    status === "cancelled" ||
    status === "expired"
  ) {
    return status;
  }
  return "pending";
}

function referenceName(reference: GenerateVideoRequest["references"][number], index: number): string {
  return reference.label?.trim() || reference.role || `Reference ${index + 1}`;
}

export function createOpenRouterVideoProvider(api: OpenRouterApi = DEFAULT_API): VideoProvider {
  return {
    name: "openrouter",

    resolveModel(request) {
      return (
        request.model?.trim() ||
        process.env.VIDEO_DEFAULT_MODEL?.trim() ||
        DEFAULT_VIDEO_MODEL
      );
    },

    async submit(request) {
      const result = await api.submitVideoJob({
        prompt: request.prompt,
        aspectRatio: request.aspectRatio,
        resolution: request.resolution,
        duration: request.duration,
        characters: request.references.map((reference, index) => ({
          name: referenceName(reference, index),
          url: reference.url,
        })),
        generateAudio: request.generateAudio,
        model: this.resolveModel(request),
        referenceInstruction:
          "Match each referenced subject or object to its reference image while preserving identity and appearance.",
      });

      return { id: result.id, status: normalizeSubmissionStatus(result.status) };
    },

    async getStatus(providerJobId) {
      const status = await api.pollVideoJob(providerJobId);
      const result: ProviderStatus = { id: status.id, status: status.status };
      if (status.error) result.error = status.error;
      if (status.usage) result.costUsd = status.usage.cost;
      return result;
    },

    async download(providerJobId) {
      return api.downloadVideoContent(providerJobId);
    },
  };
}

const OPENROUTER_PROVIDER = createOpenRouterVideoProvider();

export function getVideoProvider(name: VideoProviderName = "openrouter"): VideoProvider {
  if (name !== "openrouter") throw new Error(`Unsupported video provider: ${name}`);
  return OPENROUTER_PROVIDER;
}
