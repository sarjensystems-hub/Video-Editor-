import { beforeEach, describe, expect, it, vi } from "vitest";

const USER = "8812981a-e0d8-4eb6-82d5-d6db1314fe30";
let job: Record<string, unknown> | null = null;
const presignGet = vi.fn(async (path: string, _seconds: number, options?: { downloadName?: string }) =>
  `https://bucket.storage.example/${path}?sig=1&name=${options?.downloadName}`);

vi.mock("@/lib/b2", () => ({ presignGet: (...args: [string, number, { downloadName?: string }?]) => presignGet(...args) }));
vi.mock("@/lib/supabase/server", () => ({
  createClient: async () => ({
    auth: { getUser: async () => ({ data: { user: { id: USER } } }) },
    from: (table: string) => {
      const query = {
        select: () => query,
        eq: () => query,
        maybeSingle: async () => ({ data: table === "creative_render_jobs" ? job : { title: "Sarjen IDP Explainer" } }),
      };
      return query;
    },
  }),
}));

async function download(id = "job-1") {
  const { GET } = await import("./route");
  return GET(new Request(`https://app.example.com/api/creative/render/${id}/download`), { params: Promise.resolve({ id }) });
}

describe("render download", () => {
  beforeEach(() => {
    presignGet.mockClear();
    job = {
      id: "job-1",
      project_id: "p1",
      status: "completed",
      output_url: `https://video-editor-sarjen1.vercel.app/media/${USER}/renders/job-1.mp4`,
      content_type: "video/mp4",
      metadata: {},
      finished_at: "2026-10-29T12:13:08Z",
    };
  });

  it("redirects one's own render to a signed URL that saves under a readable name", async () => {
    const response = await download();
    expect(response.status).toBe(302);
    expect(presignGet).toHaveBeenCalledWith(`${USER}/renders/job-1.mp4`, 600, { downloadName: "sarjen-idp-explainer-2026-10-29.mp4" });
    expect(response.headers.get("location")).toContain(`${USER}/renders/job-1.mp4`);
  });

  it("refuses a stored URL outside the caller's own renders folder", async () => {
    job!.output_url = "https://video-editor-sarjen1.vercel.app/media/someone-else/renders/job-1.mp4";
    expect((await download()).status).toBe(400);
    job!.output_url = "https://evil.example/x.mp4";
    expect((await download()).status).toBe(400);
    expect(presignGet).not.toHaveBeenCalled();
  });

  it("waits for an unfinished render", async () => {
    job!.status = "rendering";
    expect((await download()).status).toBe(409);
  });
});
