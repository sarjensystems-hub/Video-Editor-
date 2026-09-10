import { describe, expect, it } from "vitest";
import { createCanonicalCreativeFixture } from "./fixtures";
import { inspectCreativeTimelineState } from "./timeline-state";
import type { CreativeDocument } from "./schema";

function twoSceneDocument(): CreativeDocument {
  const document = createCanonicalCreativeFixture();
  const first = JSON.parse(JSON.stringify(document.scenes[0])) as CreativeDocument["scenes"][number];
  first.id = "scene-a";
  first.name = "A";
  first.durationMs = 1000;
  first.transitionOut = { kind: "fade", durationMs: 200, easing: "linear" };
  first.elements = first.elements.map((element, index) => ({ ...element, id: `a-${index}` }));
  first.groups = [];

  const second = JSON.parse(JSON.stringify(document.scenes[0])) as CreativeDocument["scenes"][number];
  second.id = "scene-b";
  second.name = "B";
  second.durationMs = 1000;
  second.transitionOut = undefined;
  second.elements = second.elements.map((element, index) => ({
    ...element,
    id: `b-${index}`,
    timing: index === 0 ? { startMs: 300, endMs: 900 } : element.timing,
  }));
  second.groups = [];
  return { ...document, scenes: [first, second] };
}

describe("inspectCreativeTimelineState", () => {
  it("reports both scenes during a real transition overlap", () => {
    const state = inspectCreativeTimelineState(twoSceneDocument(), 850);
    expect(state.rendered_duration_ms).toBe(1800);
    expect(state.overlapping).toBe(true);
    expect(state.active_scenes.map((scene) => scene.scene_id)).toEqual(["scene-a", "scene-b"]);
    expect(state.active_scenes[0].scene_local_ms).toBe(850);
    expect(state.active_scenes[1].scene_local_ms).toBe(50);
  });

  it("explains why an element is absent instead of only dropping it", () => {
    const state = inspectCreativeTimelineState(twoSceneDocument(), 850);
    const second = state.active_scenes.find((scene) => scene.scene_id === "scene-b")!;
    expect(second.elements[0].visible).toBe(false);
    expect(second.elements[0].visibility_reason).toBe("before_timing");
  });

  it("rejects a timestamp outside the rendered timeline", () => {
    expect(() => inspectCreativeTimelineState(twoSceneDocument(), 1800)).toThrow(/rendered duration/);
  });
});
