import { describe, expect, it, vi } from "vitest";

vi.mock("@/lib/b2", () => ({
  presignGet: async (path: string) => `https://bucket.storage.example/${path}?X-Amz-Signature=abc`,
}));

const PATH = ["8812981a-e0d8-4eb6-82d5-d6db1314fe30", "renders", "film.mp4"];

async function get(query = "", headers: Record<string, string> = {}, path = PATH) {
  const { GET } = await import("./route");
  return GET(
    new Request(`https://app.example.com/media/${path.join("/")}${query}`, { headers }),
    { params: Promise.resolve({ path }) },
  );
}

describe("/media links", () => {
  it("opens a shared video as a player page that keeps the short link", async () => {
    const res = await get("", { "sec-fetch-dest": "document", accept: "text/html" });
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toMatch(/text\/html/);
    const html = await res.text();
    expect(html).toContain(`<video src="/media/${PATH.join("/")}?raw=1"`);
    expect(html).toContain(`/media/${PATH.join("/")}?download=film.mp4`);
    expect(html).not.toContain("X-Amz-Signature");
  });

  it("still redirects the player, the renderer and downloads to signed storage", async () => {
    for (const [query, headers] of [
      ["?raw=1", { "sec-fetch-dest": "document" }],
      ["", { "sec-fetch-dest": "video" }],
      ["", {}],
      ["?download=film.mp4", { "sec-fetch-dest": "document" }],
    ] as const) {
      const res = await get(query, headers);
      expect(res.status).toBe(307);
      expect(res.headers.get("location")).toContain("X-Amz-Signature");
    }
  });

  it("does not turn images into a player page", async () => {
    const res = await get("", { "sec-fetch-dest": "document" }, [PATH[0], "images", "a.png"]);
    expect(res.status).toBe(307);
  });
});
