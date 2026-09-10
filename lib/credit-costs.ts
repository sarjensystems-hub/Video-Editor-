/**
 * Credit costs — disabled for this deployment.
 *
 * The upstream product metered every call that carried a vendor or compute
 * bill and charged the account for it. This is an internal tool billed
 * directly to the company's own OpenRouter and Vercel accounts, so there is
 * nothing to meter: every action is free and every balance is unlimited.
 *
 * The shape is kept so the call sites that price work — the creative routes
 * and the MCP workers — compile and read unchanged. If per-seat limits are
 * ever wanted, put real numbers back here and metering starts working again
 * without touching anything else.
 */

export type CreditAction =
  | "creative_image"
  | "creative_speech"
  | "creative_music"
  | "creative_frame"
  | "creative_direct"
  | "creative_decompose";

export const CREDIT_COSTS: Record<CreditAction, number> = {
  creative_image: 0,
  creative_speech: 0,
  creative_music: 0,
  creative_frame: 0,
  creative_direct: 0,
  creative_decompose: 0,
};

/* Every price below is zero. The parameters are kept so the call sites that
   compute a cost read unchanged, and are deliberately unused. */

export function videoGenerationCost(
  _durationSeconds?: number,
  _resolution?: "480p" | "720p",
): number {
  return 0;
}

export function creativeRenderCost(_durationMs?: number): number {
  return 0;
}

export function creativeFrameCost(_frameCount?: number): number {
  return 0;
}

export const ACTION_LABELS: Record<CreditAction, string> = {
  creative_image: "Generate image asset",
  creative_speech: "Generate voiceover",
  creative_music: "Generate music",
  creative_frame: "Render preview frame",
  creative_direct: "Plan an edit from an intent",
  creative_decompose: "Decompose an image into layers",
};

/**
 * Every account runs uncharged here, so this is always true. The parameter is
 * kept so the metering call sites read unchanged; it is deliberately unused.
 */
export function isBypassEmail(_email?: string | null): boolean {
  return true;
}
