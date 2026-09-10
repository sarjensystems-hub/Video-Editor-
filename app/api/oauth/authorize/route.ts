import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { findClient } from "@/lib/oauth/store";
import { buildRedirect, redirectUriIsRegistered } from "@/lib/oauth/protocol";

export const runtime = "nodejs";

/**
 * The authorization endpoint.
 *
 * Two classes of failure are handled differently on purpose. If the client or
 * the redirect URI is untrustworthy, the error is rendered here and nothing is
 * redirected — bouncing to an unverified URI is how open redirects happen.
 * Once the redirect URI is known to be registered, every later error goes back
 * to the client as the spec requires.
 */
export async function GET(request: Request) {
  const url = new URL(request.url);
  const params = url.searchParams;

  const clientId = params.get("client_id")?.trim() ?? "";
  const redirectUri = params.get("redirect_uri")?.trim() ?? "";
  const state = params.get("state") ?? "";
  const codeChallenge = params.get("code_challenge")?.trim() ?? "";
  const codeChallengeMethod = params.get("code_challenge_method")?.trim() || "S256";
  const responseType = params.get("response_type")?.trim() ?? "";
  const scope = params.get("scope")?.trim() || "mcp";

  const fail = (message: string) =>
    new Response(`Authorization request rejected: ${message}`, {
      status: 400,
      headers: { "Content-Type": "text/plain; charset=utf-8" },
    });

  if (!clientId) return fail("client_id is required.");
  const client = await findClient(clientId);
  if (!client) return fail("Unknown client_id. Register the client first.");
  if (!redirectUri) return fail("redirect_uri is required.");
  if (!redirectUriIsRegistered(redirectUri, client.redirectUris)) {
    return fail("redirect_uri does not exactly match a registered URI for this client.");
  }

  // From here the redirect URI is trusted, so errors travel back to the client.
  const bounce = (error: string, description: string) =>
    redirect(buildRedirect(redirectUri, { error, error_description: description, ...(state ? { state } : {}) }));

  if (responseType !== "code") bounce("unsupported_response_type", "Only response_type=code is supported.");
  if (codeChallengeMethod !== "S256") bounce("invalid_request", "Only code_challenge_method=S256 is supported.");
  if (!codeChallenge) bounce("invalid_request", "PKCE code_challenge is required.");

  // Consent needs a signed-in person. Send them to log in and come straight
  // back to this exact request, so the client never sees the detour.
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) {
    const back = `${url.pathname}${url.search}`;
    redirect(`/login?redirect=${encodeURIComponent(back)}`);
  }

  const consent = new URLSearchParams({
    client_id: clientId,
    redirect_uri: redirectUri,
    code_challenge: codeChallenge,
    code_challenge_method: codeChallengeMethod,
    scope,
    ...(state ? { state } : {}),
  });
  redirect(`/oauth/consent?${consent.toString()}`);
}
