import { createHmac, timingSafeEqual } from "node:crypto";
import { deriveSubkey } from "@/lib/user-secrets";

/**
 * Signed callback URLs for work that finishes after the request that started
 * it has gone: a render sandbox reporting it is done, and OpenRouter
 * reporting a video job is done.
 *
 * Without them a job only moves when someone polls it, so a job nobody polls
 * keeps its sandbox running until the sandbox times out, and a finished video
 * is never downloaded before OpenRouter discards it.
 *
 * The token is an HMAC of the job id, so nothing is stored for it. It only
 * ever authorises "go and check this job now": the handler re-reads the job's
 * real state from the sandbox or from OpenRouter and trusts nothing in the
 * request body.
 */
export type JobCallbackKind = "render" | "video";

export function jobCallbackToken(kind: JobCallbackKind, jobId: string): string {
  return createHmac("sha256", deriveSubkey("job-callback")).update(`${kind}:${jobId}`).digest("base64url");
}

export function verifyJobCallbackToken(kind: JobCallbackKind, jobId: string, token: string | null | undefined): boolean {
  if (!token) return false;
  const expected = Buffer.from(jobCallbackToken(kind, jobId));
  const given = Buffer.from(token);
  return given.length === expected.length && timingSafeEqual(given, expected);
}

const CALLBACK_PATHS: Record<JobCallbackKind, (jobId: string) => string> = {
  render: (jobId) => `/api/creative/render/${encodeURIComponent(jobId)}/callback`,
  video: (jobId) => `/api/videos/callback/${encodeURIComponent(jobId)}`,
};

/**
 * The URL to hand out, or undefined when the app is not reachable from the
 * internet (local dev), where a callback could never arrive anyway.
 */
export function jobCallbackUrl(origin: string, kind: JobCallbackKind, jobId: string): string | undefined {
  if (!/^https:\/\//i.test(origin)) return undefined;
  let token: string;
  try {
    token = jobCallbackToken(kind, jobId);
  } catch {
    // No encryption key configured: the job still works, it just waits for a poll.
    return undefined;
  }
  const url = new URL(CALLBACK_PATHS[kind](jobId), origin);
  url.searchParams.set("token", token);
  return url.toString();
}
