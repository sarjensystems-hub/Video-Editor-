import { describe, expect, it } from "vitest";
import {
  RENDER_JOB_STALE_MS,
  RENDER_POLL_LEASE_MS,
  canClaimRenderJobPoll,
  claimRenderJobPoll,
  isRenderJobRunning,
  isRenderJobStale,
  shouldRetryDetachedRender,
} from "./render-job";

const NOW = Date.parse("2026-08-27T14:00:00.000Z");
const at = (offsetMs: number) => new Date(NOW + offsetMs).toISOString();

describe("isRenderJobRunning", () => {
  it("treats queued and rendering as running", () => {
    expect(isRenderJobRunning("queued")).toBe(true);
    expect(isRenderJobRunning("rendering")).toBe(true);
  });

  it("treats finished and unknown states as not running", () => {
    expect(isRenderJobRunning("completed")).toBe(false);
    expect(isRenderJobRunning("failed")).toBe(false);
    expect(isRenderJobRunning(null)).toBe(false);
    expect(isRenderJobRunning(undefined)).toBe(false);
  });
});

describe("detached render retry", () => {
  it("retries one expired sandbox but not arbitrary render failures", () => {
    expect(shouldRetryDetachedRender("Render sandbox expired before producing output.", 0)).toBe(true);
    expect(shouldRetryDetachedRender("sandbox_stopped", 0)).toBe(true);
    expect(shouldRetryDetachedRender("Sandbox has stopped execution", 0)).toBe(true);
    expect(shouldRetryDetachedRender("Sandbox is no longer available", 0)).toBe(true);
    expect(shouldRetryDetachedRender("Render sandbox expired before producing output.", 1)).toBe(false);
    expect(shouldRetryDetachedRender("Composition crashed", 0)).toBe(false);
  });
});

describe("render poll serialization", () => {
  it("claims a rendering row with a queued compare-and-set transition", async () => {
    const calls: Array<[string, unknown]> = [];
    const query = {
      update(value: unknown) { calls.push(["update", value]); return this; },
      eq(column: string, value: unknown) { calls.push([column, value]); return this; },
      select() { return this; },
      async maybeSingle() { return { data: { id: "job-1" }, error: null }; },
    };
    const claimed = await claimRenderJobPoll({ from: () => query } as never, {
      jobId: "job-1", userId: "user-1", status: "rendering", updatedAt: "2026-01-01T00:00:00.000Z", metadata: {}, nowMs: 1000,
    });
    expect(claimed?.claimedAt).toBe("1970-01-01T00:00:01.000Z");
    expect(calls).toEqual(expect.arrayContaining([["status", "rendering"], ["updated_at", "2026-01-01T00:00:00.000Z"]]));
    expect(calls[0][1]).toMatchObject({ status: "queued", metadata: { phase: "polling-detached" } });
  });

  it("reclaims a polling lease after a dropped persistence response", () => {
    const polling = { status: "queued", updated_at: at(-RENDER_POLL_LEASE_MS - 1), metadata: { phase: "polling-detached" } };
    expect(canClaimRenderJobPoll(polling, NOW)).toBe(true);
    expect(canClaimRenderJobPoll({ ...polling, updated_at: at(-RENDER_POLL_LEASE_MS) }, NOW)).toBe(false);
    expect(canClaimRenderJobPoll({ ...polling, metadata: { phase: "restoring" } }, NOW)).toBe(false);
    expect(canClaimRenderJobPoll({ status: "rendering" }, NOW)).toBe(true);
  });
});

describe("isRenderJobStale", () => {
  it("keeps a job alive while its heartbeat is recent", () => {
    expect(isRenderJobStale({ status: "rendering", updated_at: at(-30_000) }, NOW)).toBe(false);
  });

  it("tolerates the quiet phases up to the threshold", () => {
    expect(isRenderJobStale({ status: "rendering", updated_at: at(-RENDER_JOB_STALE_MS) }, NOW)).toBe(false);
  });

  it("declares a job dead once the heartbeat stops past the threshold", () => {
    expect(isRenderJobStale({ status: "rendering", updated_at: at(-RENDER_JOB_STALE_MS - 1000) }, NOW)).toBe(true);
  });

  it("falls back to started_at when no progress was ever written", () => {
    expect(isRenderJobStale({ status: "rendering", started_at: at(-RENDER_JOB_STALE_MS - 1000) }, NOW)).toBe(true);
    expect(isRenderJobStale({ status: "rendering", started_at: at(-1000) }, NOW)).toBe(false);
  });

  it("never marks a finished job stale, however old it is", () => {
    expect(isRenderJobStale({ status: "completed", updated_at: at(-86_400_000) }, NOW)).toBe(false);
    expect(isRenderJobStale({ status: "failed", updated_at: at(-86_400_000) }, NOW)).toBe(false);
  });

  it("does not guess when there is no usable timestamp", () => {
    expect(isRenderJobStale({ status: "rendering" }, NOW)).toBe(false);
    expect(isRenderJobStale({ status: "rendering", updated_at: "not-a-date" }, NOW)).toBe(false);
  });
});
