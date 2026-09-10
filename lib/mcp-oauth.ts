import { createClient, type SupabaseClient, type User } from "@supabase/supabase-js";
import { parseBearerToken } from "./mcp-oauth-core";

export type McpUserContext = {
  accessToken: string;
  user: User;
  supabase: SupabaseClient;
  serviceSupabase?: SupabaseClient;
};

export function createMcpUserClient(accessToken: string): SupabaseClient {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!url) throw new Error("NEXT_PUBLIC_SUPABASE_URL missing");
  if (!key) throw new Error("NEXT_PUBLIC_SUPABASE_ANON_KEY missing");

  return createClient(url, key, {
    global: {
      headers: { Authorization: `Bearer ${accessToken}` },
    },
    auth: {
      persistSession: false,
      autoRefreshToken: false,
      detectSessionInUrl: false,
    },
  });
}

/**
 * Authenticates an MCP request.
 *
 * Two token shapes are accepted. A first-party opaque token, issued by
 * Studio's own authorization server, is the intended one: it is scoped to
 * MCP, stored hashed, and revocable on its own without touching the user's
 * sessions. A Supabase access token is still honoured because connections made
 * before the authorization server existed carry one, and breaking them on
 * deploy would silently disconnect anyone already set up.
 *
 * The Supabase path should be retired once those connections have been
 * re-authorised: it hands a third party a token that can also change the
 * account's email and password, which is precisely what the first-party token
 * exists to avoid.
 */
export async function authenticateMcpBearer(
  authorizationHeader: string | null,
): Promise<McpUserContext | null> {
  const accessToken = parseBearerToken(authorizationHeader);
  if (!accessToken) return null;

  const firstParty = await authenticateFirstPartyToken(accessToken);
  if (firstParty) return firstParty;

  const supabase = createMcpUserClient(accessToken);
  const {
    data: { user },
    error,
  } = await supabase.auth.getUser(accessToken);

  if (error || !user) return null;
  const { createServiceClient } = await import("./supabase/service");
  return { accessToken, user, supabase, serviceSupabase: createServiceClient() };
}

/**
 * Resolves a Studio-issued token.
 *
 * The resulting client carries the service role because an opaque token has no
 * Supabase session behind it to drive row-level security. Every query in the
 * MCP runtime scopes explicitly by `user_id`, and mcp-tenant-isolation.test.ts
 * asserts that this stays true — that test is what makes this safe, so it must
 * not be deleted along with a failing assertion.
 */
async function authenticateFirstPartyToken(token: string): Promise<McpUserContext | null> {
  // Only first-party tokens carry this prefix-free shape; a Supabase JWT has
  // dots, so this cheap check avoids a database round trip on every JWT.
  if (token.includes(".")) return null;

  const { resolveAccessToken } = await import("./oauth/store");
  const resolved = await resolveAccessToken(token).catch(() => null);
  if (!resolved) return null;

  const { createServiceClient } = await import("./supabase/service");
  const supabase = createServiceClient();
  const { data, error } = await supabase.auth.admin.getUserById(resolved.userId);
  if (error || !data.user) return null;

  return { accessToken: token, user: data.user, supabase, serviceSupabase: supabase };
}
