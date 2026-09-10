import { createHash, randomBytes, timingSafeEqual } from "node:crypto";

/**
 * The parts of the OAuth 2.1 authorization-code flow that must be exactly
 * right, kept pure so they can be tested without a database or a browser.
 *
 * Everything here is security-critical: a loose redirect check is an account
 * takeover, and a PKCE verifier compared with `===` leaks timing.
 */

export const SUPPORTED_CODE_CHALLENGE_METHODS = ["S256"] as const;

/** Authorization codes are single-use and short-lived by design. */
export const AUTHORIZATION_CODE_TTL_MS = 60_000;

/** Access tokens last a working month; clients re-authorise rather than refresh. */
export const ACCESS_TOKEN_TTL_MS = 30 * 24 * 60 * 60 * 1000;

/**
 * How long a refresh token stays usable.
 *
 * Longer than the access token by design: the access token is the thing that
 * gets sent on every request and so the thing worth expiring often, while the
 * refresh token is presented once per rotation. Six months means a connection
 * a user actually uses never lapses, and one they abandon eventually does.
 */
export const REFRESH_TOKEN_TTL_MS = 180 * 24 * 60 * 60 * 1000;

export function base64Url(buffer: Buffer): string {
  return buffer.toString("base64").replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

/** 32 bytes of CSPRNG output, URL-safe. Used for codes, tokens and client ids. */
export function randomToken(bytes = 32): string {
  return base64Url(randomBytes(bytes));
}

/**
 * Tokens are stored as hashes, never in plaintext: a database leak should not
 * hand the attacker working credentials. SHA-256 without a salt is correct
 * here — these are already high-entropy random values, not user passwords, so
 * the slow-hash and per-entry-salt reasoning does not apply.
 */
export function hashToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

/** Compares two strings without leaking where they diverge. */
export function secretsMatch(a: string, b: string): boolean {
  const left = Buffer.from(a);
  const right = Buffer.from(b);
  if (left.length !== right.length) return false;
  return timingSafeEqual(left, right);
}

/** RFC 7636: 43-128 characters from the unreserved set. */
export function isValidCodeVerifier(verifier: string): boolean {
  return /^[A-Za-z0-9\-._~]{43,128}$/.test(verifier);
}

/**
 * Verifies a PKCE code verifier against the challenge stored at authorize time.
 *
 * `plain` is deliberately unsupported: it offers no protection against a stolen
 * authorization code, which is the entire point of PKCE.
 */
export function verifyPkce(verifier: string, challenge: string, method = "S256"): boolean {
  if (method !== "S256") return false;
  if (!isValidCodeVerifier(verifier)) return false;
  const computed = base64Url(createHash("sha256").update(verifier).digest());
  return secretsMatch(computed, challenge);
}

/**
 * A registered redirect URI must match the request exactly.
 *
 * No prefix matching, no subdomain wildcards, no ignoring the query string:
 * every relaxation of this rule is a known way to redirect an authorization
 * code to an attacker.
 */
export function redirectUriIsRegistered(requested: string, registered: string[]): boolean {
  return registered.some((candidate) => candidate === requested);
}

export interface RedirectUriProblem {
  uri: string;
  reason: string;
}

/**
 * Validates redirect URIs at registration time.
 *
 * Loopback and custom schemes are allowed because native and CLI clients need
 * them; everything else must be HTTPS, and fragments are forbidden outright
 * since the authorization response appends its own query.
 */
export function checkRedirectUri(uri: string): RedirectUriProblem | null {
  let parsed: URL;
  try {
    parsed = new URL(uri);
  } catch {
    return { uri, reason: "must be an absolute URI" };
  }
  if (parsed.hash) return { uri, reason: "must not contain a fragment" };

  const isLoopback =
    parsed.protocol === "http:" &&
    (parsed.hostname === "localhost" || parsed.hostname === "127.0.0.1" || parsed.hostname === "[::1]");
  const isCustomScheme = parsed.protocol !== "http:" && parsed.protocol !== "https:";

  if (parsed.protocol === "https:" || isLoopback || isCustomScheme) return null;
  return { uri, reason: "must use https, or http only on loopback" };
}

export interface ClientRegistration {
  clientName: string;
  redirectUris: string[];
  /** Informational; kept so a consent screen can show where the client lives. */
  clientUri?: string;
  logoUri?: string;
}

export type RegistrationResult =
  | { ok: true; value: ClientRegistration }
  | { ok: false; error: string; description: string };

/** Parses and validates an RFC 7591 dynamic client registration request. */
export function parseClientRegistration(input: unknown): RegistrationResult {
  if (!input || typeof input !== "object" || Array.isArray(input)) {
    return { ok: false, error: "invalid_client_metadata", description: "Body must be a JSON object." };
  }
  const body = input as Record<string, unknown>;

  const uris = body.redirect_uris;
  if (!Array.isArray(uris) || uris.length === 0) {
    return { ok: false, error: "invalid_redirect_uri", description: "redirect_uris must be a non-empty array." };
  }
  if (uris.length > 10) {
    return { ok: false, error: "invalid_redirect_uri", description: "Too many redirect_uris." };
  }

  const redirectUris: string[] = [];
  for (const candidate of uris) {
    if (typeof candidate !== "string") {
      return { ok: false, error: "invalid_redirect_uri", description: "Each redirect_uri must be a string." };
    }
    const problem = checkRedirectUri(candidate);
    if (problem) {
      return { ok: false, error: "invalid_redirect_uri", description: `redirect_uri ${problem.uri} ${problem.reason}.` };
    }
    redirectUris.push(candidate);
  }

  const grantTypes = body.grant_types;
  if (Array.isArray(grantTypes) && !grantTypes.includes("authorization_code")) {
    return {
      ok: false,
      error: "invalid_client_metadata",
      description: "Only the authorization_code grant is supported.",
    };
  }

  const name = typeof body.client_name === "string" ? body.client_name.trim() : "";
  return {
    ok: true,
    value: {
      // A client that declines to name itself still gets a label, because the
      // consent screen has to tell the user who is asking.
      clientName: (name || "Unnamed MCP client").slice(0, 120),
      redirectUris,
      clientUri: typeof body.client_uri === "string" ? body.client_uri.slice(0, 500) : undefined,
      logoUri: typeof body.logo_uri === "string" ? body.logo_uri.slice(0, 500) : undefined,
    },
  };
}

/** Appends an OAuth response to a redirect URI, preserving any existing query. */
export function buildRedirect(redirectUri: string, params: Record<string, string>): string {
  const url = new URL(redirectUri);
  for (const [key, value] of Object.entries(params)) url.searchParams.set(key, value);
  return url.toString();
}
