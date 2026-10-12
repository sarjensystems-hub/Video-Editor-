import { describe, expect, it } from "vitest";
import { UserVideoOrchestrator, type UserCreditLedger, type UserVideoJob, type UserVideoRepository } from "./user-orchestrator";
import type { GenerateVideoRequest, VideoProvider } from "./types";

function now() {
  return "2026-08-25T00:00:00.000Z";
}

function request(overrides: Partial<GenerateVideoRequest> = {}): GenerateVideoRequest {
  return {
    prompt: "Introduce  India",
    mode: "cinematic",
    references: [],
    aspectRatio: "9:16",
    resolution: "480p",
    duration: 10,
    generateAudio: false,
    provider: "openrouter",
    model: "bytedance/seedance-2.0-fast",
    idempotencyKey: "idem-1",
    ...overrides,
  };
}

function job(overrides: Partial<UserVideoJob> = {}): UserVideoJob {
  return {
    id: "11111111-1111-4111-8111-111111111111",
    userId: "user-1",
    provider: "openrouter",
    providerJobId: null,
    model: "bytedance/seedance-2.0-fast",
    mode: "cinematic",
    status: "pending",
    prompt: "Introduce  India",
    aspectRatio: "9:16",
    resolution: "480p",
    duration: 10,
    generateAudio: false,
    videoUrl: null,
    error: null,
    costUsd: null,
    creditsCharged: 0,
    refundedAt: null,
    mcpIdempotencyKey: "idem-1",
    createdAt: now(),
    updatedAt: now(),
    ...overrides,
  };
}

function harness(options: {
  existing?: UserVideoJob | null;
  deductAllowed?: boolean;
  providerSubmitThrows?: boolean;
  providerStatus?: "pending" | "in_progress" | "completed" | "failed";
  storedUrl?: string | null;
  ownedJob?: UserVideoJob | null;
  downloadThrows?: boolean;
  nowMs?: number;
  callbackUrlFor?: (jobId: string) => string | undefined;
} = {}) {
  const calls: string[] = [];
  let current = options.ownedJob ?? job();
  let refunded = false;

  const repo: UserVideoRepository = {
    async findByIdempotency() { calls.push("find-idem"); return options.existing ?? null; },
    async reserve(input) {
      calls.push("reserve");
      current = job({ userId: input.userId, mcpIdempotencyKey: input.idempotencyKey });
      return { job: current, created: true };
    },
    async deleteReservation() { calls.push("delete-reservation"); },
    async getById(userId) {
      calls.push("get");
      return current.userId === userId ? current : null;
    },
    async update(_userId, _id, patch) {
      calls.push(`update:${String(patch.status ?? "patch")}`);
      current = { ...current, ...patch, updatedAt: now() };
      return current;
    },
  };

  const credits: UserCreditLedger = {
    async deduct(_userId, amount) {
      calls.push("deduct");
      if (options.deductAllowed === false) {
        return { allowed: false, balance: 3, cost: amount, error: "Not enough credits." };
      }
      return { allowed: true, balance: 100 - amount, cost: amount };
    },
    async refundVideoOnce() {
      calls.push("refund-once");
      if (refunded) return false;
      refunded = true;
      current = { ...current, refundedAt: now() };
      return true;
    },
  };

  const provider: VideoProvider = {
    name: "openrouter",
    resolveModel: () => "bytedance/seedance-2.0-fast",
    async submit(_request, submitOptions) {
      calls.push("submit");
      if (submitOptions?.callbackUrl) calls.push(`callback:${submitOptions.callbackUrl}`);
      if (options.providerSubmitThrows) throw new Error("provider down");
      return { id: "provider-1", status: "pending" };
    },
    async getStatus() {
      calls.push("poll");
      const status = options.providerStatus ?? "completed";
      return { id: "provider-1", status, error: status === "failed" ? "failed upstream" : undefined, costUsd: 0.2 };
    },
    async download() {
      calls.push("download");
      if (options.downloadThrows) throw new Error("storage hiccup");
      return { bytes: Buffer.from("video"), contentType: "video/mp4" }; },
  };

  const orchestrator = new UserVideoOrchestrator(
    repo,
    credits,
    () => provider,
    (duration, resolution) => duration * (resolution === "480p" ? 4 : 6),
    async () => { calls.push("store"); return options.storedUrl === undefined ? "https://cdn.example.com/video.mp4" : options.storedUrl; },
    { nowMs: () => options.nowMs ?? Date.parse(now()), callbackUrlFor: options.callbackUrlFor },
  );

  return { orchestrator, calls, getCurrent: () => current };
}

describe("UserVideoOrchestrator", () => {
  it("returns an existing per-user idempotent job without charging or submitting", async () => {
    const existing = job({ status: "in_progress", providerJobId: "provider-old" });
    const { orchestrator, calls } = harness({ existing });
    const result = await orchestrator.start("user-1", request());
    expect(result).toBe(existing);
    expect(calls).toEqual(["find-idem"]);
  });

  it("reserves the canonical user job before charging and provider submission", async () => {
    const { orchestrator, calls } = harness();
    await orchestrator.start("user-1", request());
    expect(calls.indexOf("reserve")).toBeLessThan(calls.indexOf("deduct"));
    expect(calls.indexOf("deduct")).toBeLessThan(calls.indexOf("submit"));
  });

  it("removes an uncharged reservation when credits are insufficient", async () => {
    const { orchestrator, calls } = harness({ deductAllowed: false });
    await expect(orchestrator.start("user-1", request())).rejects.toThrow(/credits/i);
    expect(calls).toContain("delete-reservation");
    expect(calls).not.toContain("submit");
  });

  it("requests one atomic refund when provider submission fails after charging", async () => {
    const { orchestrator, calls } = harness({ providerSubmitThrows: true });
    await expect(orchestrator.start("user-1", request())).rejects.toThrow(/provider down/i);
    expect(calls.filter((c) => c === "refund-once")).toHaveLength(1);
  });

  it("stores a provider-completed video before marking it completed", async () => {
    const owned = job({ providerJobId: "provider-1", status: "in_progress", creditsCharged: 40 });
    const { orchestrator, calls } = harness({ ownedJob: owned, providerStatus: "completed" });
    const result = await orchestrator.get("user-1", owned.id);
    expect(result?.status).toBe("completed");
    expect(result?.videoUrl).toBe("https://cdn.example.com/video.mp4");
    expect(calls.indexOf("store")).toBeLessThan(calls.indexOf("update:completed"));
  });

  it("fails non-HTTPS storage and requests an idempotent refund only once", async () => {
    const owned = job({ providerJobId: "provider-1", status: "in_progress", creditsCharged: 40 });
    const { orchestrator, calls } = harness({ ownedJob: owned, providerStatus: "completed", storedUrl: "http://cdn.example.com/video.mp4" });
    const first = await orchestrator.get("user-1", owned.id);
    const second = await orchestrator.get("user-1", owned.id);
    expect(first?.status).toBe("failed");
    expect(second?.status).toBe("failed");
    expect(calls.filter((c) => c === "refund-once")).toHaveLength(1);
  });

  it("does not return another user's job", async () => {
    const foreign = job({ userId: "user-2" });
    const { orchestrator } = harness({ ownedJob: foreign });
    await expect(orchestrator.get("user-1", foreign.id)).resolves.toBeNull();
  });

  it("hands the provider a callback URL for the reserved job", async () => {
    const { orchestrator, calls } = harness({ callbackUrlFor: (id) => `https://app.example.com/api/videos/callback/${id}?token=t` });
    await orchestrator.start("user-1", request());
    expect(calls).toContain("callback:https://app.example.com/api/videos/callback/11111111-1111-4111-8111-111111111111?token=t");
  });

  it("keeps retrying a finished video that could not be saved instead of failing it", async () => {
    const owned = job({ providerJobId: "provider-1", status: "in_progress" });
    const { orchestrator, calls } = harness({ ownedJob: owned, providerStatus: "completed", downloadThrows: true });
    const result = await orchestrator.get("user-1", owned.id);
    expect(result?.status).toBe("in_progress");
    expect(result?.error).toMatch(/retrying/);
    expect(calls).not.toContain("refund-once");
  });

  it("gives up on a finished video that still cannot be saved after a day", async () => {
    const owned = job({ providerJobId: "provider-1", status: "in_progress" });
    const { orchestrator } = harness({
      ownedJob: owned, providerStatus: "completed", downloadThrows: true,
      nowMs: Date.parse(now()) + 25 * 60 * 60 * 1000,
    });
    await expect(orchestrator.get("user-1", owned.id)).resolves.toMatchObject({ status: "failed" });
  });

  it("waits a minute between save retries instead of re-downloading on every poll", async () => {
    const retrying = job({
      providerJobId: "provider-1", status: "in_progress",
      error: "Video is ready but could not be saved yet; retrying. storage hiccup",
      updatedAt: now(),
    });
    const soon = harness({ ownedJob: retrying, nowMs: Date.parse(now()) + 10_000 });
    await expect(soon.orchestrator.get("user-1", retrying.id)).resolves.toMatchObject({ status: "in_progress" });
    expect(soon.calls).not.toContain("poll");

    const later = harness({ ownedJob: retrying, nowMs: Date.parse(now()) + 61_000 });
    await expect(later.orchestrator.get("user-1", retrying.id)).resolves.toMatchObject({ status: "completed" });
  });
});
