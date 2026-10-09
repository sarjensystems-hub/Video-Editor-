import { describe, expect, it } from "vitest";
import { buildRenderTiles, formatClock, sameOriginMediaPath } from "./render-library";

describe("render library", () => {
  const projects = [{ id: "p1", title: "Launch: film!" }];

  it("lists finished renders newest first, on this deployment's own media path", () => {
    const tiles = buildRenderTiles(
      [
        {
          id: "old",
          project_id: "p1",
          output_url: "https://other.example/media/u/renders/old.mp4",
          size_bytes: 100,
          metadata: { duration_ms: 61850, output_width: 1080, output_height: 1920, start_ms: 0, end_ms: 61850 },
          finished_at: "2026-10-01T10:00:00Z",
          created_at: "2026-10-01T09:00:00Z",
        },
        {
          id: "new",
          project_id: "gone",
          output_url: "/media/u/renders/new.mp4",
          size_bytes: null,
          metadata: { start_ms: 12000, end_ms: 30000 },
          finished_at: null,
          created_at: "2026-10-05T09:00:00Z",
        },
        { id: "none", project_id: "p1", output_url: null, size_bytes: null, metadata: null, finished_at: null, created_at: "2026-10-09T00:00:00Z" },
      ],
      projects,
    );

    expect(tiles.map((tile) => tile.id)).toEqual(["new", "old"]);
    const [partial, full] = tiles;
    expect(full).toMatchObject({
      projectTitle: "Launch: film!",
      url: "/media/u/renders/old.mp4",
      downloadUrl: "/media/u/renders/old.mp4?download=Launch%20film%202026-10-01.mp4",
      durationMs: 61850,
      width: 1080,
      height: 1920,
      range: null,
    });
    expect(partial).toMatchObject({ projectTitle: "Deleted project", durationMs: 18000, range: "0:12–0:30" });
  });

  it("leaves a URL that is not a stored file alone", () => {
    expect(sameOriginMediaPath("https://cdn.example/x.mp4")).toBe("https://cdn.example/x.mp4");
    expect(formatClock(79500)).toBe("1:20");
  });
});
