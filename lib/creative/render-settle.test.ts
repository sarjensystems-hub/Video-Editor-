import { describe, expect, it, vi } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import { assertRenderCapacity, MAX_ACTIVE_RENDERS_PER_USER } from "./render-job";
import { settleRenderJob, type RenderSettleDeps, type SettleableRenderJob } from "./render-settle";

/** Records every update and lets each CAS'd update succeed or not. */
function fakeSupabase(options: { casSucceeds?: boolean } = {}) {
  const updates: Array<{ table: string; patch: Record<string, unknown>; filters: Record<string, unknown> }> = [];
  const from = (table: string) => {
    const filters: Record<string, unknown> = {};
    let patch: Record<string, unknown> | null = null;
    const builder = {
      update(value: Record<string, unknown>) { patch = value; return builder; },
      eq(column: string, value: unknown) { filters[column] = value; return builder; },
      select() { return builder; },
      async maybeSingle() {
        if (patch) updates.push({ table, patch, filters: { ...filters } });
        return { data: options.casSucceeds === false ? null : { id: "job-1" }, error: null };
      },
      then(resolve: (value: { data: null; error: null }) => void) {
        if (patch) updates.push({ table, patch, filters: { ...filters } });
        resolve({ data: null, error: null });
      },
    };
    return builder;
  };
  return { client: { from } as unknown as SupabaseClient, updates };
}

const NOW = Date.parse("2026-10-12T12:00:00.000Z");
const HANDLE = { sandboxId: "sbx-1", cmdId: "cmd-1", outputFile: "/tmp/o.mp4", outputKey: "u/renders/job-1.mp4", startedAtMs: NOW - 5 * 60_000 };

function job(overrides: Partial<SettleableRenderJob> = {}): SettleableRenderJob {
  return {
    id: "job-1", user_id: "user-1", project_id: "project-1", status: "rendering",
    updated_at: new Date(NOW - 60_000).toISOString(), started_at: new Date(NOW - 5 * 60_000).toISOString(),
    metadata: { detached_render: HANDLE },
    ...overrides,
  };
}

function deps(poll: RenderSettleDeps["pollDetached"]) {
  return {
    pollDetached: vi.fn(poll),
    stopDetached: vi.fn(async () => undefined),
    stopSandboxByName: vi.fn(async () => undefined),
    nowMs: () => NOW,
  } satisfies RenderSettleDeps;
}

describe("settleRenderJob", () => {
  it("records a finished render, stops its sandbox and frees the project", async () => {
    const { client, updates } = fakeSupabase();
    const d = deps(async () => ({ status: "completed", url: "https://app/media/x.mp4", contentType: "video/mp4", sizeBytes: 10 }));
    await expect(settleRenderJob(client, job(), d)).resolves.toBe("completed");
    const final = updates.find((u) => u.table === "creative_render_jobs" && u.patch.status === "completed");
    expect(final?.patch).toMatchObject({ output_url: "https://app/media/x.mp4", progress: 1 });
    expect(d.stopDetached).toHaveBeenCalledWith(HANDLE);
    expect(updates.some((u) => u.table === "creative_projects" && u.patch.status === "ready")).toBe(true);
  });

  it("records a failed render and stops its sandbox", async () => {
    const { client, updates } = fakeSupabase();
    const d = deps(async () => ({ status: "failed", progress: 0.3, error: "Render stopped making progress" }));
    await expect(settleRenderJob(client, job(), d)).resolves.toBe("failed");
    expect(updates.some((u) => u.patch.status === "failed")).toBe(true);
    expect(d.stopDetached).toHaveBeenCalledOnce();
  });

  it("leaves a render that is still going running and its sandbox alone", async () => {
    const { client } = fakeSupabase();
    const d = deps(async () => ({ status: "rendering", progress: 0.5, phase: "rendering", estimatedCompletionMs: null }));
    await expect(settleRenderJob(client, job(), d)).resolves.toBe("rendering");
    expect(d.stopDetached).not.toHaveBeenCalled();
  });

  it("does nothing when someone else holds the poll", async () => {
    const { client } = fakeSupabase({ casSucceeds: false });
    const d = deps(async () => { throw new Error("must not poll"); });
    await expect(settleRenderJob(client, job(), d)).resolves.toBe("busy");
    expect(d.pollDetached).not.toHaveBeenCalled();
  });

  it("ignores finished jobs", async () => {
    const { client, updates } = fakeSupabase();
    const d = deps(async () => { throw new Error("must not poll"); });
    await expect(settleRenderJob(client, job({ status: "completed" }), d)).resolves.toBe("not-running");
    expect(updates).toEqual([]);
  });

  it("closes a launch that died before recording its render and stops the sandbox it made", async () => {
    const { client, updates } = fakeSupabase();
    const d = deps(async () => { throw new Error("must not poll"); });
    const dead = job({ metadata: { sandbox_name: "sbx-orphan" }, updated_at: new Date(NOW - 30 * 60_000).toISOString() });
    await expect(settleRenderJob(client, dead, d)).resolves.toBe("failed");
    expect(d.stopSandboxByName).toHaveBeenCalledWith("sbx-orphan");
    expect(updates.some((u) => u.patch.status === "failed")).toBe(true);
  });

  it("gives a launch still in progress time before closing it", async () => {
    const { client, updates } = fakeSupabase();
    const d = deps(async () => { throw new Error("must not poll"); });
    const launching = job({ metadata: { sandbox_name: "sbx-new" }, updated_at: new Date(NOW - 60_000).toISOString() });
    await expect(settleRenderJob(client, launching, d)).resolves.toBe("rendering");
    expect(d.stopSandboxByName).not.toHaveBeenCalled();
    expect(updates).toEqual([]);
  });
});

describe("assertRenderCapacity", () => {
  function counting(count: number | null, error: unknown = null) {
    const builder = {
      select() { return builder; }, eq() { return builder; }, in() { return builder; },
      gt() { return Promise.resolve({ count, error }); },
    };
    return { from: () => builder } as unknown as SupabaseClient;
  }

  it("allows a render below the limit and refuses one at it", async () => {
    await expect(assertRenderCapacity(counting(MAX_ACTIVE_RENDERS_PER_USER - 1), "user-1")).resolves.toBeUndefined();
    await expect(assertRenderCapacity(counting(MAX_ACTIVE_RENDERS_PER_USER), "user-1")).rejects.toThrow(/renders running/);
  });

  it("never blocks a render because the count failed", async () => {
    await expect(assertRenderCapacity(counting(null, { message: "db down" }), "user-1")).resolves.toBeUndefined();
  });
});
