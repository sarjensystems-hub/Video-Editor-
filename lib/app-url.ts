/**
 * Where this deployment actually lives.
 *
 * `NEXT_PUBLIC_APP_URL` used to be the only answer, with a placeholder host
 * behind it — so an unset or stale value silently produced a URL pointing at
 * somewhere that does not exist. That is invisible in most places and fatal in
 * one: the MCP connector URL a user pastes into ChatGPT.
 *
 * The request knows the answer, and knows it correctly on every domain the
 * deployment answers on, so anything rendered per-request asks the request.
 * The environment is only consulted where there is no request to ask —
 * build-time metadata — and Vercel's own `VERCEL_PROJECT_PRODUCTION_URL`
 * stands behind it, which is always right and needs no configuration.
 */

function normalize(value: string | undefined | null): string | null {
  const trimmed = value?.trim().replace(/\/$/, "");
  if (!trimmed) return null;
  const withScheme = /^https?:\/\//.test(trimmed) ? trimmed : `https://${trimmed}`;
  try {
    return new URL(withScheme).origin;
  } catch {
    return null;
  }
}

/**
 * The deployment's address without a request to consult: an explicit
 * `NEXT_PUBLIC_APP_URL`, then the production domain Vercel assigns itself,
 * then localhost for `npm run dev`.
 */
export function appUrl(): string {
  return (
    normalize(process.env.NEXT_PUBLIC_APP_URL) ??
    normalize(process.env.VERCEL_PROJECT_PRODUCTION_URL) ??
    "http://localhost:3000"
  );
}

/**
 * The origin the current request came in on — the one to hand back to the
 * user, since it is by definition a domain that reaches this app.
 */
export async function requestOrigin(): Promise<string> {
  // Imported here rather than at the top of the file: `appUrl` is called from
  // the OpenRouter modules, and a static `next/headers` import would drag a
  // request-scoped dependency into every one of them — and into their tests.
  const { headers } = await import("next/headers");
  const headerList = await headers();
  const forwardedHost = headerList.get("x-forwarded-host") ?? headerList.get("host");
  const origin = normalize(forwardedHost);
  if (!origin) return appUrl();

  // `normalize` assumes https for a bare host, which is right everywhere
  // except a local dev server.
  const proto = headerList.get("x-forwarded-proto");
  if (proto === "http") return origin.replace(/^https:/, "http:");
  return origin;
}
