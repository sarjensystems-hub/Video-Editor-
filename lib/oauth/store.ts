import { createServiceClient } from "@/lib/supabase/service";
import {
  ACCESS_TOKEN_TTL_MS,
  AUTHORIZATION_CODE_TTL_MS,
  REFRESH_TOKEN_TTL_MS,
  hashToken,
  randomToken,
  verifyPkce,
} from "./protocol";

/**
 * Persistence for the authorization server.
 *
 * These tables are written with the service role because they are the auth
 * layer itself: a client registering, or a code being redeemed, happens before
 * any user session exists to scope by.
 */

export interface OAuthClient {
  clientId: string;
  clientName: string;
  redirectUris: string[];
}

export async function registerClient(input: {
  clientName: string;
  redirectUris: string[];
  clientUri?: string;
  logoUri?: string;
}): Promise<OAuthClient> {
  const supabase = createServiceClient();
  const clientId = `mcp_${randomToken(18)}`;
  const { error } = await supabase.from("mcp_oauth_clients").insert({
    client_id: clientId,
    client_name: input.clientName,
    redirect_uris: input.redirectUris,
    client_uri: input.clientUri ?? null,
    logo_uri: input.logoUri ?? null,
  });
  if (error) throw new Error(error.message);
  return { clientId, clientName: input.clientName, redirectUris: input.redirectUris };
}

export async function findClient(clientId: string): Promise<OAuthClient | null> {
  const supabase = createServiceClient();
  const { data } = await supabase
    .from("mcp_oauth_clients")
    .select("client_id, client_name, redirect_uris")
    .eq("client_id", clientId)
    .maybeSingle();
  if (!data) return null;
  return {
    clientId: String(data.client_id),
    clientName: String(data.client_name),
    redirectUris: (data.redirect_uris as string[]) ?? [],
  };
}

/** Issues a single-use authorization code and returns the plaintext to redirect with. */
export async function issueAuthorizationCode(input: {
  clientId: string;
  userId: string;
  redirectUri: string;
  codeChallenge: string;
  codeChallengeMethod: string;
  scope: string;
}): Promise<string> {
  const supabase = createServiceClient();
  const code = randomToken();
  const { error } = await supabase.from("mcp_oauth_codes").insert({
    code_hash: hashToken(code),
    client_id: input.clientId,
    user_id: input.userId,
    redirect_uri: input.redirectUri,
    code_challenge: input.codeChallenge,
    code_challenge_method: input.codeChallengeMethod,
    scope: input.scope,
    expires_at: new Date(Date.now() + AUTHORIZATION_CODE_TTL_MS).toISOString(),
  });
  if (error) throw new Error(error.message);
  return code;
}

export type RedeemResult =
  | { ok: true; accessToken: string; refreshToken: string; expiresInSeconds: number; scope: string }
  | { ok: false; error: "invalid_grant" | "invalid_request"; description: string };

/**
 * Exchanges an authorization code for an access token.
 *
 * The code is marked consumed before the token is minted, and the update is
 * conditional on it still being unconsumed — so two racing requests cannot both
 * redeem the same code and walk away with a token each.
 */
export async function redeemAuthorizationCode(input: {
  code: string;
  clientId: string;
  redirectUri: string;
  codeVerifier: string;
}): Promise<RedeemResult> {
  const supabase = createServiceClient();
  const codeHash = hashToken(input.code);

  const { data: record } = await supabase
    .from("mcp_oauth_codes")
    .select("id, client_id, user_id, redirect_uri, code_challenge, code_challenge_method, scope, expires_at, consumed_at")
    .eq("code_hash", codeHash)
    .maybeSingle();

  // One message for every failure mode below: distinguishing "no such code"
  // from "wrong client" tells an attacker which half of their guess was right.
  const reject: RedeemResult = {
    ok: false,
    error: "invalid_grant",
    description: "The authorization code is invalid, expired, or already used.",
  };

  if (!record) return reject;
  if (record.consumed_at) return reject;
  if (Date.parse(String(record.expires_at)) < Date.now()) return reject;
  if (String(record.client_id) !== input.clientId) return reject;
  if (String(record.redirect_uri) !== input.redirectUri) return reject;
  if (!verifyPkce(input.codeVerifier, String(record.code_challenge), String(record.code_challenge_method))) {
    return reject;
  }

  const { data: consumed } = await supabase
    .from("mcp_oauth_codes")
    .update({ consumed_at: new Date().toISOString() })
    .eq("id", record.id)
    .is("consumed_at", null)
    .select("id")
    .maybeSingle();
  if (!consumed) return reject;

  const issued = await mintTokenPair({
    clientId: input.clientId,
    userId: String(record.user_id),
    scope: String(record.scope),
  });
  if (!issued) return { ok: false, error: "invalid_request", description: "Could not issue a token." };

  return {
    ok: true,
    accessToken: issued.accessToken,
    refreshToken: issued.refreshToken,
    expiresInSeconds: Math.floor(ACCESS_TOKEN_TTL_MS / 1000),
    scope: String(record.scope),
  };
}

/**
 * Writes one access/refresh pair.
 *
 * `chainId` links every rotation back to the original grant so that a reused
 * refresh token can revoke the whole family in one statement. A brand-new
 * grant starts its own chain.
 */
async function mintTokenPair(input: {
  clientId: string;
  userId: string;
  scope: string;
  chainId?: string;
  rotatedFrom?: string;
}): Promise<{ accessToken: string; refreshToken: string } | null> {
  const supabase = createServiceClient();
  const accessToken = randomToken(36);
  const refreshToken = randomToken(36);
  const now = Date.now();

  const { data, error } = await supabase
    .from("mcp_access_tokens")
    .insert({
      token_hash: hashToken(accessToken),
      refresh_token_hash: hashToken(refreshToken),
      client_id: input.clientId,
      user_id: input.userId,
      scope: input.scope,
      expires_at: new Date(now + ACCESS_TOKEN_TTL_MS).toISOString(),
      refresh_expires_at: new Date(now + REFRESH_TOKEN_TTL_MS).toISOString(),
      rotated_from: input.rotatedFrom ?? null,
      chain_id: input.chainId ?? null,
    })
    .select("id")
    .single();
  if (error || !data) return null;

  // A new grant is its own chain root; the id is only known after the insert.
  if (!input.chainId) {
    await supabase.from("mcp_access_tokens").update({ chain_id: data.id }).eq("id", data.id);
  }

  return { accessToken, refreshToken };
}

export type RefreshResult =
  | { ok: true; accessToken: string; refreshToken: string; expiresInSeconds: number; scope: string }
  | { ok: false; error: "invalid_grant"; description: string };

/**
 * Exchanges a refresh token for a new pair, rotating it.
 *
 * OAuth 2.1 requires rotation for public clients — there is no client secret
 * here, so the refresh token is the only credential and must not be reusable.
 *
 * Presenting an already-rotated refresh token is the signature of a stolen
 * one: either the thief or the legitimate client is replaying a value the
 * other has already spent. There is no way to tell which, so the whole chain
 * is revoked and the user re-authorises. Rotation without this check is
 * theatre — it would let a stolen token be used indefinitely alongside the
 * real one.
 */
export async function redeemRefreshToken(refreshToken: string): Promise<RefreshResult> {
  const supabase = createServiceClient();
  // One message for every failure: a caller must not be able to tell an
  // unknown token from an expired or revoked one.
  const reject = {
    ok: false as const,
    error: "invalid_grant" as const,
    description: "The refresh token is invalid, expired or already used.",
  };

  const { data } = await supabase
    .from("mcp_access_tokens")
    .select("id, client_id, user_id, scope, revoked_at, refresh_expires_at, refresh_used_at, chain_id")
    .eq("refresh_token_hash", hashToken(refreshToken))
    .maybeSingle();
  if (!data) return reject;

  const chainId = data.chain_id ? String(data.chain_id) : String(data.id);

  if (data.refresh_used_at) {
    // Replay. Burn the family rather than guess who is legitimate.
    await supabase
      .from("mcp_access_tokens")
      .update({ revoked_at: new Date().toISOString() })
      .eq("chain_id", chainId)
      .is("revoked_at", null);
    return reject;
  }

  if (data.revoked_at) return reject;
  if (!data.refresh_expires_at || Date.parse(String(data.refresh_expires_at)) < Date.now()) return reject;

  // Claim this refresh token conditionally, so two concurrent refreshes cannot
  // both mint a pair — the loser sees the row already spent.
  const { data: claimed } = await supabase
    .from("mcp_access_tokens")
    .update({ refresh_used_at: new Date().toISOString(), revoked_at: new Date().toISOString() })
    .eq("id", data.id)
    .is("refresh_used_at", null)
    .select("id")
    .maybeSingle();
  if (!claimed) return reject;

  const issued = await mintTokenPair({
    clientId: String(data.client_id),
    userId: String(data.user_id),
    scope: String(data.scope),
    chainId,
    rotatedFrom: String(data.id),
  });
  if (!issued) return reject;

  return {
    ok: true,
    accessToken: issued.accessToken,
    refreshToken: issued.refreshToken,
    expiresInSeconds: Math.floor(ACCESS_TOKEN_TTL_MS / 1000),
    scope: String(data.scope),
  };
}

export interface ResolvedToken {
  userId: string;
  clientId: string;
  scope: string;
}

/** Resolves a bearer token to its owner, or null when it is unusable. */
export async function resolveAccessToken(token: string): Promise<ResolvedToken | null> {
  const supabase = createServiceClient();
  const { data } = await supabase
    .from("mcp_access_tokens")
    .select("id, user_id, client_id, scope, expires_at, revoked_at")
    .eq("token_hash", hashToken(token))
    .maybeSingle();

  if (!data) return null;
  if (data.revoked_at) return null;
  if (Date.parse(String(data.expires_at)) < Date.now()) return null;

  // Best-effort: a failed heartbeat must not fail the request it belongs to.
  void supabase
    .from("mcp_access_tokens")
    .update({ last_used_at: new Date().toISOString() })
    .eq("id", data.id)
    .then(() => undefined);

  return { userId: String(data.user_id), clientId: String(data.client_id), scope: String(data.scope) };
}
