export type ProtectedResourceMetadata = {
  resource: string;
  authorization_servers: string[];
  bearer_methods_supported: ["header"];
  resource_name: string;
};

function trimTrailingSlash(value: string): string {
  return value.replace(/\/+$/, "");
}

/** The canonical MCP endpoint. `/api/mcp/mcp-server` remains as an alias. */
export const MCP_RESOURCE_PATH = "/api/mcp";

/**
 * Points clients at Studio's own authorization server.
 *
 * This previously named Supabase Auth, which does not implement dynamic client
 * registration — so a client had no way to obtain a client id and fell back to
 * asking the person connecting to paste one from the Supabase dashboard. Only
 * the project owner could do that, which meant nobody else could connect.
 */
export function protectedResourceMetadata(origin: string): ProtectedResourceMetadata {
  const base = trimTrailingSlash(origin);
  return {
    resource: `${base}${MCP_RESOURCE_PATH}`,
    authorization_servers: [base],
    bearer_methods_supported: ["header"],
    resource_name: "Studio Media MCP",
  };
}

export function oauthChallenge(origin: string, error?: "invalid_token"): string {
  const base = trimTrailingSlash(origin);
  const metadata = `${base}/.well-known/oauth-protected-resource`;
  return `Bearer resource_metadata="${metadata}"${error ? `, error="${error}"` : ""}`;
}

export function parseBearerToken(header: string | null): string | null {
  if (!header) return null;
  const match = /^Bearer\s+([^\s]+)$/i.exec(header.trim());
  return match?.[1] ?? null;
}
