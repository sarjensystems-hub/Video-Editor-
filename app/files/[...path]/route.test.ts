import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/b2", () => ({
  presignGet: async (path: string) => `https://bucket.storage.example/${path}?X-Amz-Signature=abc`,
}));

const PATH = ["8812981a-e0d8-4eb6-82d5-d6db1314fe30", "renders", "film.mp4"];

afterEach(() => vi.unstubAllGlobals());

async function call(method: string, headers: Record<string, string> = {}, path = PATH) {
  const { GET, HEAD } = await import("./route");
  const handler = method === "HEAD" ? HEAD : GET;
  return handler(
    new Request(`https://app.example.com/files/${path.join("/")}`, { method, headers }),
    { params: Promise.resolve({ path }) },
  );
}

describe("/files links", () => {
  it("serves the file itself with its type and length, no redirect", async () => {
    const fetchMock = vi.fn(async () => new Response("VIDEO", {
      status: 200,
      headers: { "content-type": "video/mp4", "content-length": "5", "x-amz-request-id": "r" },
    }));
    vi.stubGlobal("fetch", fetchMock);

    const res = await call("GET", { accept: "text/html,*/*" });

    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toBe("video/mp4");
    expect(res.headers.get("content-length")).toBe("5");
    expect(res.headers.get("accept-ranges")).toBe("bytes");
    expect(res.headers.get("x-amz-request-id")).toBeNull();
    expect(await res.text()).toBe("VIDEO");
    expect((fetchMock.mock.calls[0] as unknown as [string])[0]).toContain("X-Amz-Signature");
  });

  it("passes a Range request through as a partial response", async () => {
    const fetchMock = vi.fn(async (_url: string, init?: RequestInit) => new Response("VI", {
      status: 206,
      headers: { "content-type": "video/mp4", "content-range": "bytes 0-1/5", "content-length": "2" },
    }));
    vi.stubGlobal("fetch", fetchMock);

    const res = await call("GET", { range: "bytes=0-1" });

    expect(res.status).toBe(206);
    expect(res.headers.get("content-range")).toBe("bytes 0-1/5");
    expect((fetchMock.mock.calls[0] as unknown as [string, RequestInit])[1].headers).toEqual({ Range: "bytes=0-1" });
  });

  it("answers HEAD with headers only, and 404 for a missing or malformed file", async () => {
    const headFetch = vi.fn(async () => new Response("V", {
      status: 206,
      headers: { "content-type": "video/mp4", "content-length": "1", "content-range": "bytes 0-0/75063631" },
    }));
    vi.stubGlobal("fetch", headFetch);
    const head = await call("HEAD");
    expect(head.status).toBe(200);
    expect(head.headers.get("content-length")).toBe("75063631");
    expect(head.headers.get("content-range")).toBeNull();
    expect((headFetch.mock.calls[0] as unknown as [string, RequestInit])[1]).toEqual({ method: "GET", headers: { Range: "bytes=0-0" } });

    vi.stubGlobal("fetch", vi.fn(async () => new Response("<Error/>", { status: 403 })));
    expect((await call("GET")).status).toBe(404);
    expect((await call("GET", {}, ["only", ".."])).status).toBe(404);
  });
});
