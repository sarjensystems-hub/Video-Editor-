import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * Refresh-token rotation, tested against an in-memory stand-in for the table.
 *
 * The interesting behaviour here is not the happy path — it is what happens
 * when a refresh token is presented twice. Rotation without reuse detection
 * is theatre: a stolen token would keep working alongside the real one. That
 * is what these tests are for.
 */

type Row = Record<string, unknown>;
const rows: Row[] = [];

function match(row: Row, filters: Array<[string, unknown]>, nulls: string[]): boolean {
  return filters.every(([key, value]) => row[key] === value) && nulls.every((key) => row[key] == null);
}

/** Minimal chainable stand-in for the query shapes the store uses. */
function table() {
  const state = { filters: [] as Array<[string, unknown]>, nulls: [] as string[], payload: null as Row | null, mode: "select" as string };
  const api: Record<string, unknown> = {
    select: () => api,
    insert: (payload: Row) => { state.mode = "insert"; state.payload = payload; return api; },
    update: (payload: Row) => { state.mode = "update"; state.payload = payload; return api; },
    eq: (key: string, value: unknown) => { state.filters.push([key, value]); return api; },
    is: (key: string, value: unknown) => { if (value === null) state.nulls.push(key); return api; },
    maybeSingle: async () => run(state),
    single: async () => run(state),
    then: (resolve: (v: unknown) => unknown) => Promise.resolve(run(state)).then(resolve),
  };
  return api;
}

function run(state: { filters: Array<[string, unknown]>; nulls: string[]; payload: Row | null; mode: string }) {
  if (state.mode === "insert") {
    const row = { id: `tok-${rows.length + 1}`, ...state.payload };
    rows.push(row);
    return { data: row, error: null };
  }
  const matched = rows.filter((row) => match(row, state.filters, state.nulls));
  if (state.mode === "update") {
    for (const row of matched) Object.assign(row, state.payload);
    return { data: matched[0] ?? null, error: null };
  }
  return { data: matched[0] ?? null, error: null };
}

vi.mock("@/lib/supabase/service", () => ({
  createServiceClient: () => ({ from: () => table() }),
}));

const { redeemRefreshToken } = await import("./store");
const { hashToken, randomToken } = await import("./protocol");

function seedGrant(): { refreshToken: string; id: string } {
  const refreshToken = randomToken(36);
  const id = `tok-seed-${rows.length + 1}`;
  rows.push({
    id,
    chain_id: id,
    token_hash: hashToken(randomToken(36)),
    refresh_token_hash: hashToken(refreshToken),
    client_id: "client-1",
    user_id: "user-1",
    scope: "mcp",
    expires_at: new Date(Date.now() + 60_000).toISOString(),
    refresh_expires_at: new Date(Date.now() + 600_000).toISOString(),
    refresh_used_at: null,
    revoked_at: null,
  });
  return { refreshToken, id };
}

describe("refresh token rotation", () => {
  beforeEach(() => {
    rows.length = 0;
  });

  it("exchanges a refresh token for a new pair", async () => {
    const { refreshToken } = seedGrant();
    const result = await redeemRefreshToken(refreshToken);

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.accessToken).toBeTruthy();
    expect(result.refreshToken).toBeTruthy();
    // Rotated, not reissued.
    expect(result.refreshToken).not.toBe(refreshToken);
    expect(result.scope).toBe("mcp");
  });

  it("spends the old refresh token so it cannot be used twice", async () => {
    const { refreshToken } = seedGrant();
    const first = await redeemRefreshToken(refreshToken);
    expect(first.ok).toBe(true);

    const replay = await redeemRefreshToken(refreshToken);
    expect(replay.ok).toBe(false);
  });

  it("revokes the whole chain when a spent refresh token is replayed", async () => {
    const { refreshToken } = seedGrant();
    const rotated = await redeemRefreshToken(refreshToken);
    expect(rotated.ok).toBe(true);
    if (!rotated.ok) return;

    // Someone replays the original. We cannot tell thief from client, so the
    // family dies and the user re-authorises.
    await redeemRefreshToken(refreshToken);

    // The token minted by the legitimate rotation must now be dead too.
    const afterBurn = await redeemRefreshToken(rotated.refreshToken);
    expect(afterBurn.ok).toBe(false);
    expect(rows.every((row) => row.revoked_at != null)).toBe(true);
  });

  it("keeps every rotation in one chain", async () => {
    const { refreshToken, id } = seedGrant();
    const second = await redeemRefreshToken(refreshToken);
    if (!second.ok) return;
    const third = await redeemRefreshToken(second.refreshToken);
    expect(third.ok).toBe(true);
    // Three rows, one family — which is what makes the burn above a single query.
    expect(rows).toHaveLength(3);
    expect(rows.every((row) => row.chain_id === id)).toBe(true);
  });

  it("refuses an expired refresh token", async () => {
    const { refreshToken } = seedGrant();
    rows[0].refresh_expires_at = new Date(Date.now() - 1000).toISOString();
    expect((await redeemRefreshToken(refreshToken)).ok).toBe(false);
  });

  it("refuses a refresh token whose grant was revoked", async () => {
    const { refreshToken } = seedGrant();
    rows[0].revoked_at = new Date().toISOString();
    expect((await redeemRefreshToken(refreshToken)).ok).toBe(false);
  });

  it("refuses an unknown refresh token", async () => {
    seedGrant();
    expect((await redeemRefreshToken(randomToken(36))).ok).toBe(false);
  });

  it("says the same thing however it failed", async () => {
    const { refreshToken } = seedGrant();
    rows[0].revoked_at = new Date().toISOString();
    const revoked = await redeemRefreshToken(refreshToken);
    const unknown = await redeemRefreshToken(randomToken(36));
    if (revoked.ok || unknown.ok) throw new Error("expected both to fail");
    // A caller must not be able to tell an unknown token from a revoked one.
    expect(revoked.description).toBe(unknown.description);
    expect(revoked.error).toBe(unknown.error);
  });
});
