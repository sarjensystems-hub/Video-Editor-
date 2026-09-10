import { redeemAuthorizationCode, redeemRefreshToken } from "@/lib/oauth/store";

export const runtime = "nodejs";

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization",
};

/** Accepts both encodings; MCP clients in the wild send either. */
async function readParams(request: Request): Promise<URLSearchParams> {
  const contentType = request.headers.get("content-type") ?? "";
  if (contentType.includes("application/json")) {
    const body = (await request.json().catch(() => ({}))) as Record<string, unknown>;
    const params = new URLSearchParams();
    for (const [key, value] of Object.entries(body)) {
      if (typeof value === "string") params.set(key, value);
    }
    return params;
  }
  return new URLSearchParams(await request.text());
}

export async function POST(request: Request) {
  const params = await readParams(request);
  const bad = (error: string, description: string, status = 400) =>
    Response.json({ error, error_description: description }, { status, headers: { ...CORS, "Cache-Control": "no-store" } });

  const grantType = params.get("grant_type");

  if (grantType === "refresh_token") {
    const refreshToken = params.get("refresh_token") ?? "";
    if (!refreshToken) return bad("invalid_request", "refresh_token is required.");

    const refreshed = await redeemRefreshToken(refreshToken);
    if (!refreshed.ok) return bad(refreshed.error, refreshed.description);

    return Response.json(
      {
        access_token: refreshed.accessToken,
        // Rotated on every use: the old refresh token is spent, and presenting
        // it again revokes the whole chain.
        refresh_token: refreshed.refreshToken,
        token_type: "Bearer",
        expires_in: refreshed.expiresInSeconds,
        scope: refreshed.scope,
      },
      { headers: { ...CORS, "Cache-Control": "no-store" } },
    );
  }

  if (grantType !== "authorization_code") {
    return bad("unsupported_grant_type", "Only the authorization_code and refresh_token grants are supported.");
  }

  const code = params.get("code") ?? "";
  const clientId = params.get("client_id") ?? "";
  const redirectUri = params.get("redirect_uri") ?? "";
  const codeVerifier = params.get("code_verifier") ?? "";

  if (!code || !clientId || !redirectUri || !codeVerifier) {
    return bad("invalid_request", "code, client_id, redirect_uri and code_verifier are all required.");
  }

  const result = await redeemAuthorizationCode({ code, clientId, redirectUri, codeVerifier });
  if (!result.ok) return bad(result.error, result.description);

  return Response.json(
    {
      access_token: result.accessToken,
      refresh_token: result.refreshToken,
      token_type: "Bearer",
      expires_in: result.expiresInSeconds,
      scope: result.scope,
    },
    { headers: { ...CORS, "Cache-Control": "no-store" } },
  );
}

export async function OPTIONS() {
  return new Response(null, { status: 204, headers: CORS });
}
