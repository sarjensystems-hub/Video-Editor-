import { describe, expect, it } from "vitest";
import { createCanonicalCreativeFixture } from "./fixtures";
import { createDefaultTransform } from "./defaults";
import { applyCreativeTransaction, type CreativeTransaction } from "./transactions";
import { validateCreativeDocument } from "./validate";
import { getCreativeDocumentAssetIds } from "./remotion";
import type { CreativeDocument, CreativeElement } from "./schema";

describe("creative transactions", () => {
  it("applies multiple edits atomically", () => {
    const original = createCanonicalCreativeFixture();
    const transaction: CreativeTransaction = {
      summary: "Tighten headline and hide accent",
      operations: [
        { type: "set_text", sceneId: "scene-1", elementId: "headline", text: "FIND THE RIGHT PEOPLE." },
        { type: "update_element", sceneId: "scene-1", elementId: "headline", patch: { transform: { ...original.scenes[0].elements[1].transform, x: 120 } } },
        { type: "set_hidden", sceneId: "scene-1", elementId: "accent-line", hidden: true },
      ],
    };

    const result = applyCreativeTransaction(original, transaction);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const headline = result.document.scenes[0].elements.find((element) => element.id === "headline");
    const accent = result.document.scenes[0].elements.find((element) => element.id === "accent-line");
    expect(headline?.type === "text" ? headline.text : null).toBe("FIND THE RIGHT PEOPLE.");
    expect(headline?.transform.x).toBe(120);
    expect(accent?.hidden).toBe(true);
    expect(original.scenes[0].elements.find((element) => element.id === "headline")?.transform.x).toBe(80);
  });

  it("merges partial update_element transform patches with the existing transform", () => {
    const original = createCanonicalCreativeFixture();
    const before = original.scenes[0].elements.find((element) => element.id === "headline")?.transform;
    expect(before).toBeDefined();

    const transaction = {
      summary: "Adjust only headline opacity",
      operations: [
        {
          type: "update_element",
          sceneId: "scene-1",
          elementId: "headline",
          patch: { transform: { opacity: 0.8 } },
        },
      ],
    } as unknown as CreativeTransaction;

    const result = applyCreativeTransaction(original, transaction);
    expect(result.ok).toBe(true);
    if (!result.ok || !before) return;
    const after = result.document.scenes[0].elements.find((element) => element.id === "headline")?.transform;
    expect(after).toEqual({ ...before, opacity: 0.8 });
  });

  it("returns the original document when a later operation fails", () => {
    const original = createCanonicalCreativeFixture();
    const result = applyCreativeTransaction(original, {
      summary: "Atomic failure",
      operations: [
        { type: "set_text", sceneId: "scene-1", elementId: "headline", text: "THIS MUST NOT STICK" },
        { type: "set_text", sceneId: "scene-1", elementId: "missing", text: "fail" },
      ],
    });

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.document).toBe(original);
    expect(original.scenes[0].elements.find((element) => element.id === "headline")?.type).toBe("text");
    expect((original.scenes[0].elements.find((element) => element.id === "headline") as { text: string }).text).toBe("STOP GUESSING.");
  });

  it("supports scene, timing, animation, group and design-token operations", () => {
    const original = createCanonicalCreativeFixture();
    const result = applyCreativeTransaction(original, {
      summary: "Build second scene",
      operations: [
        {
          type: "add_scene",
          scene: {
            id: "scene-2",
            name: "Payoff",
            durationMs: 3000,
            elements: [{
              id: "payoff-copy",
              name: "Payoff copy",
              type: "text",
              text: "BETTER CAR CARE.",
              style: { token: "heading" },
              transform: createDefaultTransform({ x: 90, y: 500, width: 900, height: 180, zIndex: 2 }),
            }],
            groups: [],
          },
        },
        { type: "set_transition", sceneId: "scene-1", transition: { kind: "slide-left", durationMs: 300, easing: "ease-in-out" } },
        { type: "set_timing", sceneId: "scene-2", elementId: "payoff-copy", timing: { startMs: 200, endMs: 2800 } },
        {
          type: "set_animation",
          sceneId: "scene-2",
          elementId: "payoff-copy",
          animations: [{ id: "fade", property: "opacity", keyframes: [{ timeMs: 200, value: 0, easing: "ease-out" }, { timeMs: 600, value: 1, easing: "ease-out" }] }],
        },
        { type: "create_group", sceneId: "scene-2", group: { id: "payoff-group", name: "Payoff", elementIds: ["payoff-copy"] } },
        { type: "set_design_token", namespace: "colors", token: "accent", value: "#D91920" },
      ],
    });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.document.scenes).toHaveLength(2);
    expect(result.document.scenes[0].transitionOut?.kind).toBe("slide-left");
    expect(result.document.scenes[1].groups[0].id).toBe("payoff-group");
    expect(result.document.designSystem.colors.accent).toBe("#D91920");
  });

  it("sets canvas dimensions and fps as a validated transaction", () => {
    const original = createCanonicalCreativeFixture();
    const result = applyCreativeTransaction(original, {
      summary: "Switch to vertical Story canvas",
      operations: [{ type: "set_canvas", width: 1080, height: 1920, fps: 30 }],
    });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.document.canvas).toMatchObject({ width: 1080, height: 1920, fps: 30 });
    expect(original.canvas).toMatchObject({ width: 1080, height: 1350, fps: 30 });
  });

  it("allows a transaction to repair a temporarily invalid timing state before final validation", () => {
    const original = createCanonicalCreativeFixture();
    const result = applyCreativeTransaction(original, {
      summary: "Retimer headline atomically",
      operations: [
        {
          type: "set_timing",
          sceneId: "scene-1",
          elementId: "headline",
          timing: { startMs: 1200, endMs: 7600 },
        },
        {
          type: "set_animation",
          sceneId: "scene-1",
          elementId: "headline",
          animations: [
            {
              id: "retimed-opacity",
              property: "opacity",
              keyframes: [
                { timeMs: 1200, value: 0, easing: "ease-out" },
                { timeMs: 1500, value: 1, easing: "ease-out" },
              ],
            },
          ],
        },
      ],
    });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const headline = result.document.scenes[0].elements.find((element) => element.id === "headline");
    expect(headline?.timing).toEqual({ startMs: 1200, endMs: 7600 });
    expect(headline?.animations?.[0].keyframes.map((keyframe) => keyframe.timeMs)).toEqual([1200, 1500]);
  });

  it("attributes unresolved final validation to the operation that began the invalid run", () => {
    const original = createCanonicalCreativeFixture();
    const scene = original.scenes[0];
    const invalidElements = scene.elements.map((element) =>
      element.id === "headline"
        ? { ...element, transform: { ...element.transform, anchorX: 100 } }
        : element,
    );

    const result = applyCreativeTransaction(original, {
      summary: "Keep validation provenance",
      operations: [
        { type: "set_text", sceneId: "scene-1", elementId: "headline", text: "VALID FIRST EDIT" },
        { type: "update_scene", sceneId: "scene-1", patch: { elements: invalidElements } },
        { type: "set_text", sceneId: "scene-1", elementId: "headline", text: "UNRELATED FOLLOW-UP" },
      ],
    });

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.message).toMatch(/anchorX must be between zero and one/i);
    expect(result.error.operationIndex).toBe(1);
  });
});

describe("clip editing transactions", () => {
  function documentWithClip(): CreativeDocument {
    const base = createCanonicalCreativeFixture();
    const clip = {
      id: "broll",
      name: "B-roll",
      type: "video" as const,
      assetId: "asset-1",
      sourceStartMs: 0,
      sourceEndMs: 8_000,
      fit: "cover" as const,
      volume: 1,
      playbackRate: 1,
      timing: { startMs: 0, endMs: 8_000 },
      transform: base.scenes[0].elements[0].transform,
    };
    // The fixture's group references the elements we are replacing, so the
    // scene is rebuilt without it.
    return { ...base, scenes: [{ ...base.scenes[0], elements: [clip], groups: [] }] };
  }

  it("splits one clip into two adjacent micro-shots in a single revision", () => {
    const result = applyCreativeTransaction(documentWithClip(), {
      summary: "Cut the b-roll into three beats",
      operations: [
        { type: "split_clip", sceneId: "scene-1", elementId: "broll", atMs: 3_000 },
      ],
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;

    const clips = result.document.scenes[0].elements.filter((e) => e.type === "video");
    expect(clips).toHaveLength(2);
    const [left, right] = clips as Array<Extract<CreativeElement, { type: "video" }>>;
    expect(left.timing).toEqual({ startMs: 0, endMs: 3_000 });
    expect(right.timing).toEqual({ startMs: 3_000, endMs: 8_000 });
    expect(left.sourceEndMs).toBe(right.sourceStartMs);
    expect(validateCreativeDocument(result.document).valid).toBe(true);
  });

  it("chains splits atomically to cut one clip into three shots", () => {
    const once = applyCreativeTransaction(documentWithClip(), {
      summary: "First cut",
      operations: [{ type: "split_clip", sceneId: "scene-1", elementId: "broll", atMs: 3_000 }],
    });
    expect(once.ok).toBe(true);
    if (!once.ok) return;
    const second = (once.document.scenes[0].elements[1] as { id: string }).id;

    const twice = applyCreativeTransaction(once.document, {
      summary: "Second cut",
      operations: [{ type: "split_clip", sceneId: "scene-1", elementId: second, atMs: 5_500 }],
    });
    expect(twice.ok).toBe(true);
    if (!twice.ok) return;
    const windows = twice.document.scenes[0].elements
      .filter((e) => e.type === "video")
      .map((e) => [e.timing?.startMs, e.timing?.endMs]);
    expect(windows).toEqual([[0, 3_000], [3_000, 5_500], [5_500, 8_000]]);
  });

  it("retimes a clip and keeps the document valid", () => {
    const result = applyCreativeTransaction(documentWithClip(), {
      summary: "Punch the shot to 2x",
      operations: [
        { type: "set_clip_speed", sceneId: "scene-1", elementId: "broll", speed: 2, mode: "hold_source" },
      ],
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const clip = result.document.scenes[0].elements[0] as Extract<CreativeElement, { type: "video" }>;
    expect(clip.playbackRate).toBe(2);
    expect(clip.timing).toEqual({ startMs: 0, endMs: 4_000 });
  });

  it("rejects an out-of-range clip edit without mutating the document", () => {
    const original = documentWithClip();
    const result = applyCreativeTransaction(original, {
      summary: "Bad cut",
      operations: [{ type: "split_clip", sceneId: "scene-1", elementId: "broll", atMs: 8_000 }],
    });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.message).toMatch(/inside/i);
    expect(result.document).toEqual(original);
  });

  it("refuses to run a clip operation against a non-video element", () => {
    const base = createCanonicalCreativeFixture();
    const result = applyCreativeTransaction(base, {
      summary: "Split a headline",
      operations: [{ type: "split_clip", sceneId: "scene-1", elementId: "headline", atMs: 1_000 }],
    });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.message).toMatch(/not a video clip/i);
  });
});

describe("audio timeline transactions", () => {
  const bed = {
    id: "bed", name: "Music bed", assetId: "music-1", kind: "music" as const,
    startMs: 0, endMs: 8_000, sourceStartMs: 0, gain: 0.8,
    fadeInMs: 500, fadeOutMs: 1_000, duckUnderVoice: true, duckToGain: 0.25,
  };

  it("adds a music bed to a document that had no audio", () => {
    const result = applyCreativeTransaction(createCanonicalCreativeFixture(), {
      summary: "Lay the music bed",
      operations: [{ type: "add_audio_clip", clip: bed }],
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.document.audio).toHaveLength(1);
    expect(result.document.audio![0].id).toBe("bed");
    expect(validateCreativeDocument(result.document).valid).toBe(true);
  });

  it("stores a copy, so the caller's clip object cannot alias the document", () => {
    const source = { ...bed };
    const result = applyCreativeTransaction(createCanonicalCreativeFixture(), {
      summary: "Lay the bed", operations: [{ type: "add_audio_clip", clip: source }],
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.document.audio![0]).not.toBe(source);
  });

  it("refuses a duplicate clip id", () => {
    const once = applyCreativeTransaction(createCanonicalCreativeFixture(), {
      summary: "Bed", operations: [{ type: "add_audio_clip", clip: bed }],
    });
    expect(once.ok).toBe(true);
    if (!once.ok) return;
    const twice = applyCreativeTransaction(once.document, {
      summary: "Bed again", operations: [{ type: "add_audio_clip", clip: bed }],
    });
    expect(twice.ok).toBe(false);
    if (twice.ok) return;
    expect(twice.error.message).toMatch(/already exists/i);
  });

  it("patches gain and fades without letting the id change", () => {
    const added = applyCreativeTransaction(createCanonicalCreativeFixture(), {
      summary: "Bed", operations: [{ type: "add_audio_clip", clip: bed }],
    });
    expect(added.ok).toBe(true);
    if (!added.ok) return;
    const patched = applyCreativeTransaction(added.document, {
      summary: "Pull the bed down",
      operations: [{ type: "update_audio_clip", clipId: "bed", patch: { gain: 0.3, fadeOutMs: 2_000 } }],
    });
    expect(patched.ok).toBe(true);
    if (!patched.ok) return;
    expect(patched.document.audio![0]).toMatchObject({ id: "bed", gain: 0.3, fadeOutMs: 2_000 });
  });

  it("removes a clip and reports an unknown id", () => {
    const added = applyCreativeTransaction(createCanonicalCreativeFixture(), {
      summary: "Bed", operations: [{ type: "add_audio_clip", clip: bed }],
    });
    expect(added.ok).toBe(true);
    if (!added.ok) return;

    const removed = applyCreativeTransaction(added.document, {
      summary: "Drop the bed", operations: [{ type: "remove_audio_clip", clipId: "bed" }],
    });
    expect(removed.ok).toBe(true);
    if (!removed.ok) return;
    expect(removed.document.audio).toEqual([]);

    const missing = applyCreativeTransaction(added.document, {
      summary: "Drop nothing", operations: [{ type: "remove_audio_clip", clipId: "ghost" }],
    });
    expect(missing.ok).toBe(false);
  });

  it("rejects a fade longer than the clip, which could never reach full gain", () => {
    const result = applyCreativeTransaction(createCanonicalCreativeFixture(), {
      summary: "Impossible fade",
      operations: [{ type: "add_audio_clip", clip: { ...bed, endMs: 1_000, fadeInMs: 5_000 } }],
    });
    expect(result.ok).toBe(false);
  });

  it("requires audio assets in the render asset set", () => {
    const added = applyCreativeTransaction(createCanonicalCreativeFixture(), {
      summary: "Bed", operations: [{ type: "add_audio_clip", clip: bed }],
    });
    expect(added.ok).toBe(true);
    if (!added.ok) return;
    expect(getCreativeDocumentAssetIds(added.document)).toContain("music-1");
  });
});

describe("update_elements", () => {
  /**
   * A templated film is the normal case: one element role repeated across every
   * scene. Restyling eight of them used to be eight near-identical operations.
   */
  function templatedFilm(): CreativeDocument {
    const base = createCanonicalCreativeFixture();
    const scene = base.scenes[0];
    const scrim = (id: string): CreativeElement => ({
      id,
      name: "Scrim",
      type: "shape",
      shape: "rect",
      fill: { kind: "literal", value: "#000000" },
      transform: { ...createDefaultTransform(), width: 1080, height: 600, zIndex: 1 },
    } as unknown as CreativeElement);

    return {
      ...base,
      scenes: [1, 2, 3].map((n) => ({
        ...scene,
        id: `scene-${n}`,
        // The fixture's groups name the fixture's element ids; these are
        // renamed per scene, so the groups have to go with them.
        groups: [],
        elements: [
          ...scene.elements.map((element) => ({ ...element, id: `${element.id}-${n}` })),
          scrim(`s${n}-scrim`),
        ],
      })),
    };
  }

  it("builds a valid document to test against", () => {
    // Without this, a fixture fault would look exactly like an operation fault.
    expect(validateCreativeDocument(templatedFilm()).valid).toBe(true);
  });

  it("applies one patch to every element matching a suffix", () => {
    const original = templatedFilm();
    const result = applyCreativeTransaction(original, {
      summary: "Lift the scrims",
      operations: [{ type: "update_elements", elementIdEndsWith: "-scrim", patch: { transform: { opacity: 0.4 } } as Partial<CreativeElement> }],
    });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const scrims = result.document.scenes.flatMap((scene) =>
      scene.elements.filter((element) => element.id.endsWith("-scrim")),
    );
    expect(scrims).toHaveLength(3);
    for (const scrim of scrims) expect(scrim.transform.opacity).toBe(0.4);
  });

  it("merges a transform patch rather than replacing it", () => {
    // The singular operation merges; the plural has to behave identically or a
    // bulk edit would silently reset width, height and z-order.
    const original = templatedFilm();
    const result = applyCreativeTransaction(original, {
      summary: "Nudge the scrims",
      operations: [{ type: "update_elements", elementIdEndsWith: "-scrim", patch: { transform: { opacity: 0.4 } } as Partial<CreativeElement> }],
    });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const scrim = result.document.scenes[0].elements.find((element) => element.id === "s1-scrim");
    expect(scrim?.transform.width).toBe(1080);
    expect(scrim?.transform.height).toBe(600);
    expect(scrim?.transform.zIndex).toBe(1);
  });

  it("fails when a suffix matches nothing, rather than burning a revision", () => {
    // A mistyped selector that silently changed nothing would send the caller
    // looking for the fault in the renderer.
    const result = applyCreativeTransaction(templatedFilm(), {
      summary: "Typo",
      operations: [{ type: "update_elements", elementIdEndsWith: "-scrimm", patch: { hidden: true } }],
    });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.code).toBe("not_found");
    expect(result.error.message).toContain("-scrimm");
  });

  it("can be narrowed to named scenes", () => {
    const result = applyCreativeTransaction(templatedFilm(), {
      summary: "Only the first two",
      operations: [{ type: "update_elements", elementIdEndsWith: "-scrim", sceneIds: ["scene-1", "scene-2"], patch: { hidden: true } }],
    });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const hidden = result.document.scenes.map((scene) =>
      scene.elements.find((element) => element.id.endsWith("-scrim"))?.hidden ?? false,
    );
    expect(hidden).toEqual([true, true, false]);
  });

  it("rejects a scene id that does not exist", () => {
    const result = applyCreativeTransaction(templatedFilm(), {
      summary: "Bad scope",
      operations: [{ type: "update_elements", elementIdEndsWith: "-scrim", sceneIds: ["scene-9"], patch: { hidden: true } }],
    });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.code).toBe("not_found");
  });

  it("accepts an explicit target list for a set no suffix describes", () => {
    const result = applyCreativeTransaction(templatedFilm(), {
      summary: "Two by name",
      operations: [{
        type: "update_elements",
        targets: [
          { sceneId: "scene-1", elementId: "s1-scrim" },
          { sceneId: "scene-3", elementId: "s3-scrim" },
        ],
        patch: { hidden: true },
      }],
    });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const hidden = result.document.scenes.map((scene) =>
      scene.elements.find((element) => element.id.endsWith("-scrim"))?.hidden ?? false,
    );
    expect(hidden).toEqual([true, false, true]);
  });

  it("refuses both selectors at once, and neither", () => {
    const both = applyCreativeTransaction(templatedFilm(), {
      summary: "Both",
      operations: [{
        type: "update_elements",
        targets: [{ sceneId: "scene-1", elementId: "s1-scrim" }],
        elementIdEndsWith: "-scrim",
        patch: { hidden: true },
      }],
    });
    expect(both.ok).toBe(false);

    const neither = applyCreativeTransaction(templatedFilm(), {
      summary: "Neither",
      operations: [{ type: "update_elements", patch: { hidden: true } }],
    });
    expect(neither.ok).toBe(false);
  });

  it("leaves the document untouched when one target in the batch fails", () => {
    // Atomicity is what made blind iteration safe in the field; a partial bulk
    // edit would be the one thing that broke it.
    const original = templatedFilm();
    const result = applyCreativeTransaction(original, {
      summary: "One good, one missing",
      operations: [{
        type: "update_elements",
        targets: [
          { sceneId: "scene-1", elementId: "s1-scrim" },
          { sceneId: "scene-2", elementId: "ghost" },
        ],
        patch: { hidden: true },
      }],
    });

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.document.scenes[0].elements.find((e) => e.id === "s1-scrim")?.hidden).toBeFalsy();
    expect(original.scenes[0].elements.find((e) => e.id === "s1-scrim")?.hidden).toBeFalsy();
  });
});

describe("camera and group transforms", () => {
  const neutral = {
    x: 0, y: 0, scaleX: 1, scaleY: 1, rotation: 0, opacity: 1, anchorX: 0.5, anchorY: 0.5,
  };

  it("gives a scene a camera and takes it away again", () => {
    const original = createCanonicalCreativeFixture();
    const pushed = applyCreativeTransaction(original, {
      summary: "Push in",
      operations: [{
        type: "set_scene_camera",
        sceneId: "scene-1",
        camera: {
          transform: neutral,
          animations: [{
            id: "push",
            property: "scaleX",
            keyframes: [
              { timeMs: 0, value: 1, easing: "linear" },
              { timeMs: 2000, value: 1.3, easing: "linear" },
            ],
          }],
        },
      }],
    });

    expect(pushed.ok).toBe(true);
    if (!pushed.ok) return;
    expect(pushed.document.scenes[0].camera?.animations).toHaveLength(1);

    const cleared = applyCreativeTransaction(pushed.document, {
      summary: "Lock off",
      operations: [{ type: "set_scene_camera", sceneId: "scene-1" }],
    });
    expect(cleared.ok).toBe(true);
    if (!cleared.ok) return;
    expect(cleared.document.scenes[0].camera).toBeUndefined();
  });

  it("does not mutate the document it was given", () => {
    const original = createCanonicalCreativeFixture();
    applyCreativeTransaction(original, {
      summary: "Push in",
      operations: [{ type: "set_scene_camera", sceneId: "scene-1", camera: { transform: { ...neutral, scaleX: 2 } } }],
    });
    expect(original.scenes[0].camera).toBeUndefined();
  });

  it("rejects a camera on a scene that does not exist", () => {
    const result = applyCreativeTransaction(createCanonicalCreativeFixture(), {
      summary: "Nowhere",
      operations: [{ type: "set_scene_camera", sceneId: "scene-9", camera: { transform: neutral } }],
    });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.code).toBe("not_found");
  });

  it("transforms a group and clears its animations when the transform goes", () => {
    const base = createCanonicalCreativeFixture();
    const groupId = base.scenes[0].groups[0]?.id;
    expect(groupId, "fixture has no group to transform").toBeTruthy();

    const moved = applyCreativeTransaction(base, {
      summary: "Slide the cluster",
      operations: [{
        type: "set_group_transform",
        sceneId: "scene-1",
        groupId: groupId!,
        transform: { ...neutral, x: -120 },
        animations: [{
          id: "slide",
          property: "x",
          keyframes: [
            { timeMs: 0, value: 0, easing: "linear" },
            { timeMs: 800, value: -120, easing: "linear" },
          ],
        }],
      }],
    });

    expect(moved.ok).toBe(true);
    if (!moved.ok) return;
    const group = moved.document.scenes[0].groups.find((g) => g.id === groupId)!;
    expect(group.transform?.x).toBe(-120);
    expect(group.animations).toHaveLength(1);

    // Clearing the transform must not leave orphan tracks that would animate
    // a transform that no longer exists.
    const cleared = applyCreativeTransaction(moved.document, {
      summary: "Back to organisational",
      operations: [{ type: "set_group_transform", sceneId: "scene-1", groupId: groupId! }],
    });
    expect(cleared.ok).toBe(true);
    if (!cleared.ok) return;
    const plain = cleared.document.scenes[0].groups.find((g) => g.id === groupId)!;
    expect(plain.transform).toBeUndefined();
    expect(plain.animations).toBeUndefined();
    // The group survives as a grouping, which is all it was before.
    expect(plain.elementIds.length).toBeGreaterThan(0);
  });

  it("rejects a group that does not exist", () => {
    const result = applyCreativeTransaction(createCanonicalCreativeFixture(), {
      summary: "Nowhere",
      operations: [{ type: "set_group_transform", sceneId: "scene-1", groupId: "ghost", transform: neutral }],
    });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.code).toBe("not_found");
  });
});

describe("continue_element", () => {
  function twoScenes(transitionMs: number): CreativeDocument {
    const base = createCanonicalCreativeFixture();
    const first = { ...base.scenes[0], transitionOut: { kind: "fade" as const, durationMs: transitionMs, easing: "linear" as const } };
    const second = {
      ...base.scenes[0],
      id: "scene-2",
      groups: [],
      elements: base.scenes[0].elements.map((element) => ({ ...element, id: `${element.id}-b` })),
      transitionOut: undefined,
    };
    return { ...base, scenes: [first, second] };
  }

  const continuation = (durationMs: number) => ({
    id: "hand-off",
    fromSceneId: "scene-1",
    fromElementId: "headline",
    toSceneId: "scene-2",
    toElementId: "headline-b",
    durationMs,
    easing: "linear" as const,
  });

  it("accepts a handoff that fits inside the overlap", () => {
    const result = applyCreativeTransaction(twoScenes(600), {
      summary: "Carry the headline through",
      operations: [{ type: "continue_element", continuation: continuation(600) }],
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.document.continuations).toHaveLength(1);
  });

  it("refuses one with nowhere to happen, and names the transition to lengthen", () => {
    // The whole point of validating this: a morph with no overlap renders as a
    // plain cut and nothing anywhere says why.
    const result = applyCreativeTransaction(twoScenes(200), {
      summary: "Too long for the overlap",
      operations: [{ type: "continue_element", continuation: continuation(900) }],
    });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.message).toContain("lengthen scene-1's transitionOut");
  });

  it("lets one transaction lengthen the transition and add the handoff together", () => {
    // Atomicity earns its keep here: neither operation is valid without the
    // other, and both land or neither does.
    const result = applyCreativeTransaction(twoScenes(100), {
      summary: "Make room, then carry it through",
      operations: [
        { type: "set_transition", sceneId: "scene-1", transition: { kind: "fade", durationMs: 700, easing: "linear" } },
        { type: "continue_element", continuation: continuation(700) },
      ],
    });
    expect(result.ok).toBe(true);
  });

  it("removes a continuation by id", () => {
    const added = applyCreativeTransaction(twoScenes(600), {
      summary: "Add",
      operations: [{ type: "continue_element", continuation: continuation(600) }],
    });
    expect(added.ok).toBe(true);
    if (!added.ok) return;

    const removed = applyCreativeTransaction(added.document, {
      summary: "Remove",
      operations: [{ type: "remove_continuation", continuationId: "hand-off" }],
    });
    expect(removed.ok).toBe(true);
    if (!removed.ok) return;
    expect(removed.document.continuations).toBeUndefined();
  });
});
