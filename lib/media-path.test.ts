import { describe, expect, it } from "vitest";
import { directFileUrl, storagePathFromSegments } from "./media-path";

describe("media paths", () => {
  it("turns a /media link into its direct /files link", () => {
    expect(directFileUrl("https://app.example.com/media/u/renders/a.mp4")).toBe("https://app.example.com/files/u/renders/a.mp4");
    expect(directFileUrl("/media/u/renders/a.mp4")).toBe("/files/u/renders/a.mp4");
  });

  it("refuses short or traversing paths", () => {
    expect(storagePathFromSegments(["u", "renders", "a.mp4"])).toEqual(["u", "renders", "a.mp4"]);
    expect(storagePathFromSegments(["u", "a.mp4"])).toBeNull();
    expect(storagePathFromSegments(["u", "..", "a.mp4"])).toBeNull();
  });
});
