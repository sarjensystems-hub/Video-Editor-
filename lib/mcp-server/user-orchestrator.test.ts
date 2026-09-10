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
    siteId: "site-1",
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
} = {}) {
  const calls: string[] = [];
  let current = options.ownedJob ?? job();
  let refunded = false;

  const repo: UserVideoRepository = {
    async resolveSite() { calls.push("resolve-site"); return "site-1"; },
    async findByIdempotency() { calls.push("find-idem"); return options.existing ?? null; },
    async reserve(input) {
      calls.push("reserve");
      current = job({ userId: input.userId, siteId: input.siteId, mcpIdempotencyKey: input.idempotencyKey });
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
    async submit() {
      calls.push("submit");
      if (options.providerSubmitThrows) throw new Error("provider down");
      return { id: "provider-1", status: "pending" };
    },
    async getStatus() {
      calls.push("poll");
      const status = options.providerStatus ?? "completed";
      return { id: "provider-1", status, error: status === "failed" ? "failed upstream" : undefined, costUsd: 0.2 };
    },
    async download() { calls.push("download"); return { bytes: Buffer.from("video"), contentType: "video/mp4" }; },
  };

  const orchestrator = new UserVideoOrchestrator(
    repo,
    credits,
    () => provider,
    (duration, resolution) => duration * (resolution === "480p" ? 4 : 6),
    async () => { calls.push("store"); return options.storedUrl === undefined ? "https://cdn.example.com/video.mp4" : options.storedUrl; },
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
});
