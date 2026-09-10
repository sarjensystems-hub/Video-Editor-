import { createClient } from "@/lib/supabase/server";

export const runtime = "nodejs";

/**
 * The user's connected MCP clients.
 *
 * Read and revoked through the user's own session, not the service role: the
 * two RLS policies on mcp_access_tokens scope both to `auth.uid()`, so this
 * cannot reach another account's connections even if the id were guessed.
 */
export async function GET() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return Response.json({ error: "Unauthorized" }, { status: 401 });

  const { data, error } = await supabase
    .from("mcp_access_tokens")
    .select("id, client_id, scope, created_at, last_used_at, expires_at, revoked_at")
    .is("revoked_at", null)
    .order("created_at", { ascending: false });
  if (error) return Response.json({ error: error.message }, { status: 500 });

  const tokens = data ?? [];
  // Client names live in a table the user cannot read, so they are resolved
  // here rather than joined; an unknown id still renders as something honest.
  const names = new Map<string, string>();
  if (tokens.length > 0) {
    const { createServiceClient } = await import("@/lib/supabase/service");
    const { data: clients } = await createServiceClient()
      .from("mcp_oauth_clients")
      .select("client_id, client_name")
      .in("client_id", [...new Set(tokens.map((t) => String(t.client_id)))]);
    for (const client of clients ?? []) names.set(String(client.client_id), String(client.client_name));
  }

  return Response.json({
    connections: tokens
      .filter((token) => Date.parse(String(token.expires_at)) > Date.now())
      .map((token) => ({
        id: String(token.id),
        clientName: names.get(String(token.client_id)) ?? "Unknown client",
        createdAt: token.created_at,
        lastUsedAt: token.last_used_at,
        expiresAt: token.expires_at,
      })),
  });
}

export async function DELETE(request: Request) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return Response.json({ error: "Unauthorized" }, { status: 401 });

  const id = new URL(request.url).searchParams.get("id")?.trim();
  if (!id) return Response.json({ error: "id is required" }, { status: 400 });

  // Revoked rather than deleted: the row is the record that the connection
  // existed, and resolveAccessToken refuses it from this moment on.
  const { error } = await supabase
    .from("mcp_access_tokens")
    .update({ revoked_at: new Date().toISOString() })
    .eq("id", id)
    .is("revoked_at", null);
  if (error) return Response.json({ error: error.message }, { status: 500 });

  return Response.json({ ok: true });
}
