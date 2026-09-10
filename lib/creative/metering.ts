import type { SupabaseClient } from "@supabase/supabase-js";
import { isBypassEmail } from "../credit-costs";

/**
 * Credit metering for work that costs a vendor or compute bill.
 *
 * This module charges through the authenticated Supabase client its caller
 * already holds. Refunds use the server-only service client because the
 * generic add_credits primitive is deliberately not callable by end users.
 * Keeping that import lazy is what leaves this module importable
 * from `lib/creative`: the cookie-based helpers in lib/credits.ts pull in
 * `next/headers` at module scope, which would drag a request-scoped Next
 * dependency into the pure runtime the MCP tests exercise. It also happens to
 * be correct for MCP, where there is no cookie to read a user from — the
 * caller has already authenticated the bearer token by the time it gets here.
 *
 * `deduct_credits` is SECURITY DEFINER and takes the user id explicitly, so it
 * works the same under a service-role client (first-party token) and a
 * user-scoped one (legacy Supabase JWT, cookie session).
 */

export interface CreditActor {
  supabase: SupabaseClient;
  /** Trusted server-only client; lazily created when the runtime omits it. */
  serviceSupabase?: SupabaseClient;
  user: { id: string; email?: string | null };
}

export async function getCreditServiceClient(actor: CreditActor): Promise<SupabaseClient> {
  return actor.serviceSupabase ?? (await import("../supabase/service")).createServiceClient();
}

export class InsufficientCreditsError extends Error {
  readonly required: number;
  readonly balance: number;

  constructor(required: number, balance: number) {
    super(
      `This needs ${required} credit${required === 1 ? "" : "s"} and your balance is ${balance}. ` +
        "Top up at /pricing to continue.",
    );
    this.name = "InsufficientCreditsError";
    this.required = required;
    this.balance = balance;
  }
}

async function currentBalance(actor: CreditActor): Promise<number> {
  const { data } = await actor.supabase
    .from("user_credits")
    .select("balance")
    .eq("user_id", actor.user.id)
    .maybeSingle();
  return Number((data as { balance?: number } | null)?.balance ?? 0);
}

/**
 * Charges `amount` credits, throwing `InsufficientCreditsError` when the
 * balance will not cover it.
 *
 * Deducting before the work runs is deliberate: checking a balance and
 * charging afterwards lets a caller fire several requests against the same
 * credits. `refundCredits` is what makes charging up front fair.
 */
export async function chargeCredits(actor: CreditActor, action: string, amount: number): Promise<void> {
  if (isBypassEmail(actor.user.email)) return;

  const { error } = await actor.supabase.rpc("deduct_credits", {
    p_user_id: actor.user.id,
    p_amount: amount,
    p_action: action,
  });
  if (!error) return;

  if (error.message.includes("insufficient_credits")) {
    throw new InsufficientCreditsError(amount, await currentBalance(actor));
  }
  throw new Error("Credit check failed. Please try again.");
}

/** Returns credits charged for work that then failed. */
export async function refundCredits(actor: CreditActor, action: string, amount: number): Promise<void> {
  if (isBypassEmail(actor.user.email)) return;
  const privileged = await getCreditServiceClient(actor);
  const { error } = await privileged.rpc("add_credits", {
    p_user_id: actor.user.id,
    p_amount: amount,
    p_type: "refund",
    p_action: action,
  });
  if (error) throw new Error(`Credit refund failed: ${error.message}`);
}

/** Atomically records the trusted charge amount on a specific render job. */
export async function chargeCreativeRenderCredits(actor: CreditActor, jobId: string, amount: number): Promise<void> {
  if (isBypassEmail(actor.user.email)) return;
  const privileged = await getCreditServiceClient(actor);
  const { data, error } = await privileged.rpc("charge_creative_render_once", {
    p_job_id: jobId,
    p_user_id: actor.user.id,
    p_amount: amount,
  });
  if (!error && data === true) return;
  if (!error) throw new Error("Render job was already charged; refusing to continue.");
  if (error.message.includes("insufficient_credits")) throw new InsufficientCreditsError(amount, await currentBalance(actor));
  throw new Error(`Render credit charge failed: ${error.message}`);
}

/** Refunds the database-recorded render charge once; no caller supplies an amount. */
export async function refundCreativeRenderCredits(actor: CreditActor, jobId: string): Promise<boolean> {
  if (isBypassEmail(actor.user.email)) return false;
  const privileged = await getCreditServiceClient(actor);
  const { data, error } = await privileged.rpc("refund_creative_render_once", {
    p_job_id: jobId,
    p_user_id: actor.user.id,
  });
  if (error) throw new Error(`Render credit refund failed: ${error.message}`);
  return data === true;
}

/** Charges for `work`, and gives the credits back if it throws. */
export async function withCredits<T>(
  actor: CreditActor,
  action: string,
  amount: number,
  work: () => Promise<T>,
): Promise<T> {
  await chargeCredits(actor, action, amount);
  try {
    return await work();
  } catch (error) {
    // A failed refund must not mask the original error: the caller needs to
    // see why the work failed, and an un-refunded credit is recoverable by
    // hand from the credit_transactions row.
    await refundCredits(actor, action, amount).catch(() => undefined);
    throw error;
  }
}
