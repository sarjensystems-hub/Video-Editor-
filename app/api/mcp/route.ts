import { handleMcpMessage } from "@/lib/mcp-server/mcp";
import { getMcpUserVideoJob, startMcpUserVideoJob } from "@/lib/mcp-server/user-runtime";
import { handleCreativeMcpTool, CREATIVE_MCP_TOOL_NAMES, type CreativeMcpToolName } from "@/lib/creative/mcp-runtime";
import { uploadMcpUserImage } from "@/lib/mcp-image-upload";
import { authenticateMcpBearer, type McpUserContext } from "@/lib/mcp-oauth";
import { withUserOpenRouterKey } from "@/lib/openrouter-key";
import { oauthChallenge } from "@/lib/mcp-oauth-core";

export const runtime = "nodejs";
/**
 * MCP tool calls return promptly; long work (MP4 rendering) continues past the
 * response via `after()`, and this budget is what keeps that background work
 * alive until it finishes.
 */
export const maxDuration = 300;

const CORS_HEADERS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
  "Access-Control-Allow-Headers": "Authorization, Content-Type, Accept, MCP-Protocol-Version, Mcp-Method, Mcp-Name",
  "Access-Control-Expose-Headers": "MCP-Protocol-Version, WWW-Authenticate",
  "Cache-Control": "no-store",
};

function json(data: unknown, status = 200, extraHeaders: Record<string, string> = {}): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "Content-Type": "application/json", ...CORS_HEADERS, ...extraHeaders },
  });
}

function unauthorized(request: Request, invalidToken = false): Response {
  const origin = new URL(request.url).origin;
  return json(
    { error: "Unauthorized" },
    401,
    { "WWW-Authenticate": oauthChallenge(origin, invalidToken ? "invalid_token" : undefined) },
  );
}

export async function POST(request: Request) {
  const authorization = request.headers.get("authorization");
  const context = await authenticateMcpBearer(authorization);
  if (!context) return unauthorized(request, Boolean(authorization));

  // Every tool call — including the rendering that continues after this
  // response — generates on the connected account's own OpenRouter key.
  return withUserOpenRouterKey(context.supabase, context.user.id, () =>
    handleAuthenticatedPost(request, context),
  );
}

async function handleAuthenticatedPost(request: Request, context: McpUserContext): Promise<Response> {
  const creativeNames = new Set<string>(CREATIVE_MCP_TOOL_NAMES);
  const deps = {
    start: (input: unknown) => startMcpUserVideoJob(context, input),
    get: (id: string) => getMcpUserVideoJob(context, id),
    uploadImage: (input: unknown) => uploadMcpUserImage(context, input),
    creative: (name: string, input: unknown) => {
      if (!creativeNames.has(name)) throw new Error(`Unknown creative tool: ${name}`);
      return handleCreativeMcpTool(context, name as CreativeMcpToolName, input);
    },
  };

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return json(
      { jsonrpc: "2.0", id: null, error: { code: -32700, message: "Parse error" } },
      400,
    );
  }

  try {
    if (Array.isArray(body)) {
      if (body.length === 0) {
        return json(
          { jsonrpc: "2.0", id: null, error: { code: -32600, message: "Invalid Request" } },
          400,
        );
      }
      const results = (
        await Promise.all(body.map((message) => handleMcpMessage(message, deps)))
      ).filter((result) => result !== null);
      if (results.length === 0) return new Response(null, { status: 202, headers: CORS_HEADERS });
      return json(results);
    }

    const result = await handleMcpMessage(body as never, deps);
    if (result === null) return new Response(null, { status: 202, headers: CORS_HEADERS });
    return json(result);
  } catch (error) {
    console.error("[studio-media-mcp] unhandled request error", error);
    return json({
      jsonrpc: "2.0",
      id: null,
      error: { code: -32603, message: "Internal error" },
    });
  }
}

export async function OPTIONS() {
  return new Response(null, { status: 204, headers: CORS_HEADERS });
}

export async function GET(request: Request) {
  const authorization = request.headers.get("authorization");
  if (!authorization) return unauthorized(request, false);

  const context = await authenticateMcpBearer(authorization);
  if (!context) return unauthorized(request, true);

  return new Response("Method Not Allowed", {
    status: 405,
    headers: { Allow: "POST, OPTIONS", ...CORS_HEADERS },
  });
}