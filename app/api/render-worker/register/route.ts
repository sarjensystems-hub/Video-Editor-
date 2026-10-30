import { timingSafeEqual } from "node:crypto";
import { NextResponse } from "next/server";
import { normalizeRenderWorkerUrl, saveRenderWorkerUrl } from "@/lib/creative/render-worker-registry";

export const runtime = "nodejs";

/**
 * POST /api/render-worker/register  { url }
 * Authorization: Bearer <CREATIVE_RENDER_WORKER_SECRET>
 *
 * Called by the self-hosted render worker (render-worker/server.ts) whenever
 * its public address changes, so a restarted quick tunnel needs no
 * environment change or redeploy. The address is only saved once the app has
 * reached the worker there with the same secret: a typo or a dead tunnel
 * cannot replace a working address.
 */
export async function POST(request: Request) {
  const secret = process.env.CREATIVE_RENDER_WORKER_SECRET?.trim();
  if (!secret) return NextResponse.json({ error: "The render worker is not enabled on this deployment" }, { status: 404 });

  const given = Buffer.from(request.headers.get("authorization") ?? "");
  const expected = Buffer.from(`Bearer ${secret}`);
  if (given.length !== expected.length || !timingSafeEqual(given, expected)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const body = (await request.json().catch(() => null)) as { url?: unknown } | null;
  const url = normalizeRenderWorkerUrl(body?.url);
  if (!url) return NextResponse.json({ error: "url must be an https address" }, { status: 400 });

  try {
    const response = await fetch(`${url}/health`, {
      headers: { Authorization: `Bearer ${secret}` },
      signal: AbortSignal.timeout(15_000),
      cache: "no-store",
    });
    const health = (await response.json().catch(() => null)) as { ok?: unknown } | null;
    if (!response.ok || health?.ok !== true) throw new Error(`health check answered ${response.status}`);
  } catch (error) {
    return NextResponse.json(
      { error: `Could not reach the worker at ${url}: ${error instanceof Error ? error.message : String(error)}` },
      { status: 502 },
    );
  }

  await saveRenderWorkerUrl(url);
  return NextResponse.json({ ok: true, url });
}
