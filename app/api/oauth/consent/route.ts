import { createClient } from "@/lib/supabase/server";
import { findClient, issueAuthorizationCode } from "@/lib/oauth/store";
import { buildRedirect, redirectUriIsRegistered } from "@/lib/oauth/protocol";

export const runtime = "nodejs";

/**
 * Records the user's decision and mints the authorization code.
 *
 * Every parameter is re-validated here rather than trusted from the consent
 * page's form: the page is just a screen, and a request can reach this endpoint
 * without ever having rendered it.
 */
export async function POST(request: Request) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return Response.json({ error: "Not signed in" }, { status: 401 });

  const body = (await request.json().catch(() => null)) as Record<string, string> | null;
  if (!body) return Response.json({ error: "Invalid request" }, { status: 400 });

  const { client_id: clientId, redirect_uri: redirectUri, code_challenge: codeChallenge } = body;
  const codeChallengeMethod = body.code_challenge_method || "S256";
  const scope = body.scope || "mcp";
  const state = body.state ?? "";

  if (!clientId || !redirectUri || !codeChallenge) {
    return Response.json({ error: "Missing authorization parameters" }, { status: 400 });
  }
  if (codeChallengeMethod !== "S256") {
    return Response.json({ error: "Unsupported code challenge method" }, { status: 400 });
  }

  const client = await findClient(clientId);
  if (!client) return Response.json({ error: "Unknown client" }, { status: 400 });
  if (!redirectUriIsRegistered(redirectUri, client.redirectUris)) {
    return Response.json({ error: "redirect_uri is not registered for this client" }, { status: 400 });
  }

  if (body.decision !== "approve") {
    return Response.json({
      redirect: buildRedirect(redirectUri, {
        error: "access_denied",
        error_description: "The user declined the request.",
        ...(state ? { state } : {}),
      }),
    });
  }

  const code = await issueAuthorizationCode({
    clientId,
    userId: user.id,
    redirectUri,
    codeChallenge,
    codeChallengeMethod,
    scope,
  });

  return Response.json({
    redirect: buildRedirect(redirectUri, { code, ...(state ? { state } : {}) }),
  });
}
