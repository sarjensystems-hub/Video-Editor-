import { registerClient } from "@/lib/oauth/store";
import { parseClientRegistration } from "@/lib/oauth/protocol";

export const runtime = "nodejs";

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type",
};

/**
 * RFC 7591 dynamic client registration.
 *
 * Open registration is deliberate and is how every MCP client is expected to
 * onboard: registering only mints an identifier and records the redirect URIs
 * it may use. It grants no access to anything — a registered client still has
 * to send a real person through consent before it can touch any data.
 */
export async function POST(request: Request) {
  const body = await request.json().catch(() => null);
  const parsed = parseClientRegistration(body);

  if (!parsed.ok) {
    return Response.json(
      { error: parsed.error, error_description: parsed.description },
      { status: 400, headers: CORS },
    );
  }

  try {
    const client = await registerClient(parsed.value);
    return Response.json(
      {
        client_id: client.clientId,
        client_name: client.clientName,
        redirect_uris: client.redirectUris,
        grant_types: ["authorization_code", "refresh_token"],
        response_types: ["code"],
        token_endpoint_auth_method: "none",
      },
      { status: 201, headers: CORS },
    );
  } catch (error) {
    return Response.json(
      { error: "server_error", error_description: error instanceof Error ? error.message : "Registration failed" },
      { status: 500, headers: CORS },
    );
  }
}

export async function OPTIONS() {
  return new Response(null, { status: 204, headers: CORS });
}
