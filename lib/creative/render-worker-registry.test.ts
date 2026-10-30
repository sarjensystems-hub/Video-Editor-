import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const getObjectText = vi.fn();
const putObject = vi.fn();
vi.mock("@/lib/b2", () => ({
  getObjectText: (...args: unknown[]) => getObjectText(...args),
  putObject: (...args: unknown[]) => putObject(...args),
}));
vi.mock("../b2", () => ({
  getObjectText: (...args: unknown[]) => getObjectText(...args),
  putObject: (...args: unknown[]) => putObject(...args),
}));

const fetchMock = vi.fn();

function registerRequest(body: unknown, authorization = "Bearer worker-secret-123") {
  return new Request("https://app.example.com/api/render-worker/register", {
    method: "POST",
    headers: { Authorization: authorization, "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

describe("render worker registry", () => {
  beforeEach(() => {
    vi.resetModules();
    getObjectText.mockReset();
    putObject.mockReset();
    fetchMock.mockReset();
    vi.stubGlobal("fetch", fetchMock);
    process.env.CREATIVE_RENDER_WORKER_SECRET = "worker-secret-123";
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    delete process.env.CREATIVE_RENDER_WORKER_SECRET;
  });

  it("accepts only https origins", async () => {
    const { normalizeRenderWorkerUrl } = await import("./render-worker-registry");
    expect(normalizeRenderWorkerUrl("https://a-b.trycloudflare.com/path?x=1")).toBe("https://a-b.trycloudflare.com");
    expect(normalizeRenderWorkerUrl("http://a.example.com")).toBeNull();
    expect(normalizeRenderWorkerUrl("https://user:pw@a.example.com")).toBeNull();
    expect(normalizeRenderWorkerUrl("nonsense")).toBeNull();
    expect(normalizeRenderWorkerUrl(42)).toBeNull();
  });

  it("reads the registered address once per cache window", async () => {
    getObjectText.mockResolvedValue(JSON.stringify({ url: "https://one.trycloudflare.com" }));
    const { registeredRenderWorkerUrl } = await import("./render-worker-registry");
    expect(await registeredRenderWorkerUrl(1_000)).toBe("https://one.trycloudflare.com");
    expect(await registeredRenderWorkerUrl(5_000)).toBe("https://one.trycloudflare.com");
    expect(getObjectText).toHaveBeenCalledTimes(1);
    expect(getObjectText).toHaveBeenCalledWith("_system/render-worker.json");
  });

  it("keeps the last known address when storage cannot be read", async () => {
    getObjectText.mockResolvedValueOnce(JSON.stringify({ url: "https://one.trycloudflare.com" }));
    getObjectText.mockRejectedValueOnce(new Error("storage down"));
    const { registeredRenderWorkerUrl } = await import("./render-worker-registry");
    await registeredRenderWorkerUrl(0);
    expect(await registeredRenderWorkerUrl(60_000)).toBe("https://one.trycloudflare.com");
  });

  it("saves an address only after reaching the worker there with the secret", async () => {
    fetchMock.mockResolvedValueOnce(new Response(JSON.stringify({ ok: true }), { status: 200 }));
    const { POST } = await import("@/app/api/render-worker/register/route");
    const response = await POST(registerRequest({ url: "https://new-one.trycloudflare.com/" }));
    expect(response.status).toBe(200);
    expect(fetchMock.mock.calls[0][0]).toBe("https://new-one.trycloudflare.com/health");
    expect(fetchMock.mock.calls[0][1].headers.Authorization).toBe("Bearer worker-secret-123");
    expect(putObject).toHaveBeenCalledWith("_system/render-worker.json", expect.stringContaining("https://new-one.trycloudflare.com"), "application/json");
  });

  it("refuses a wrong secret, a bad address and an unreachable worker", async () => {
    const { POST } = await import("@/app/api/render-worker/register/route");
    expect((await POST(registerRequest({ url: "https://x.trycloudflare.com" }, "Bearer wrong"))).status).toBe(401);
    expect((await POST(registerRequest({ url: "http://x.example.com" }))).status).toBe(400);
    fetchMock.mockRejectedValueOnce(new TypeError("fetch failed"));
    expect((await POST(registerRequest({ url: "https://dead.trycloudflare.com" }))).status).toBe(502);
    expect(putObject).not.toHaveBeenCalled();
  });

  it("does not exist on a deployment without the worker", async () => {
    delete process.env.CREATIVE_RENDER_WORKER_SECRET;
    const { POST } = await import("@/app/api/render-worker/register/route");
    expect((await POST(registerRequest({ url: "https://x.trycloudflare.com" }))).status).toBe(404);
  });
});
