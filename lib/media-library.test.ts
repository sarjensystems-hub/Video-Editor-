import { describe, expect, it } from "vitest";
import { buildMediaLibrary, isOwnedMediaPath, planMediaDeletion, type MediaRows } from "./media-library";

const USER = "user-1";
const url = (path: string, host = "https://a.example") => `${host}/media/${path}`;

const rows: MediaRows = {
  assets: [
    { id: "11111111-aaaa-4aaa-8aaa-111111111111", url: url("user-1/audio/voice.mp3"), kind: "audio", asset_class: "narration", filename: "voice.mp3", project_id: "p1", metadata: { label: "Intro voice" } },
    { id: "22222222-bbbb-4bbb-8bbb-222222222222", url: url("user-1/assets/clip.mp4", "https://b.example"), kind: "video", asset_class: "footage", filename: "clip.mp4", project_id: "p1", metadata: {} },
  ],
  renders: [{ id: "r1", output_url: url("user-1/renders/final.mp4"), project_id: "p1" }],
  videos: [{ id: "v1", video_url: url("user-1/videos/gen.mp4"), prompt: "a car", characters: [{ url: url("user-1/characters/face.png") }] }],
  projects: [
    // Only the voice is on the timeline; the clip is in the library, unused.
    { id: "p1", title: "Launch film", document: { audio: [{ assetId: "11111111-aaaa-4aaa-8aaa-111111111111" }] } },
  ],
};

const files = [
  { key: "user-1/audio/voice.mp3", size: 100, lastModifiedMs: 5 },
  { key: "user-1/assets/clip.mp4", size: 200, lastModifiedMs: 4 },
  { key: "user-1/renders/final.mp4", size: 300, lastModifiedMs: 3 },
  { key: "user-1/videos/gen.mp4", size: 400, lastModifiedMs: 2 },
  { key: "user-1/characters/face.png", size: 50, lastModifiedMs: 1 },
  { key: "user-1/images/orphan.webp", size: 10, lastModifiedMs: 6 },
];

describe("media library", () => {
  it("lists every stored file newest first, labelled by what uses it", () => {
    const items = buildMediaLibrary(USER, files, rows);
    expect(items.map((item) => item.path)).toEqual(files.map((f) => f.key).sort((a, b) =>
      files.find((f) => f.key === b)!.lastModifiedMs - files.find((f) => f.key === a)!.lastModifiedMs));

    const byPath = Object.fromEntries(items.map((item) => [item.path, item]));
    expect(byPath["user-1/audio/voice.mp3"].name).toBe("Intro voice");
    expect(byPath["user-1/audio/voice.mp3"].placedIn).toEqual([{ id: "p1", title: "Launch film" }]);
    // A URL written on another domain still matches its file.
    expect(byPath["user-1/assets/clip.mp4"].uses[0]).toMatchObject({ kind: "asset", projectTitle: "Launch film" });
    expect(byPath["user-1/assets/clip.mp4"].placedIn).toEqual([]);
    expect(byPath["user-1/renders/final.mp4"].uses[0].kind).toBe("render");
    expect(byPath["user-1/characters/face.png"].uses[0].kind).toBe("character");
    expect(byPath["user-1/images/orphan.webp"].uses).toEqual([]);
    expect(byPath["user-1/images/orphan.webp"].type).toBe("image");
    expect(byPath["user-1/images/orphan.webp"].url).toBe("/media/user-1/images/orphan.webp");
  });

  it("refuses to delete a file a project timeline places, and takes rows with the rest", () => {
    const plan = planMediaDeletion(USER, [
      "user-1/audio/voice.mp3",
      "user-1/assets/clip.mp4",
      "user-1/renders/final.mp4",
      "user-1/videos/gen.mp4",
    ], rows);
    expect(plan.blocked).toEqual([{ path: "user-1/audio/voice.mp3", projects: ["Launch film"] }]);
    expect(plan.deletable).toEqual(["user-1/assets/clip.mp4", "user-1/renders/final.mp4", "user-1/videos/gen.mp4"]);
    expect(plan.assetIds).toEqual(["22222222-bbbb-4bbb-8bbb-222222222222"]);
    expect(plan.renderIds).toEqual(["r1"]);
    expect(plan.videoIds).toEqual(["v1"]);
  });

  it("never touches a path outside the caller's own folder", () => {
    expect(isOwnedMediaPath(USER, "user-1/images/a.png")).toBe(true);
    expect(isOwnedMediaPath(USER, "user-2/images/a.png")).toBe(false);
    expect(isOwnedMediaPath(USER, "user-1/../user-2/a.png")).toBe(false);
    expect(isOwnedMediaPath(USER, "user-1/")).toBe(false);
    expect(isOwnedMediaPath(USER, "_system/render-snapshots/x.json")).toBe(false);
    const plan = planMediaDeletion(USER, ["user-2/images/a.png"], rows);
    expect(plan.rejected).toEqual(["user-2/images/a.png"]);
    expect(plan.deletable).toEqual([]);
  });
});
