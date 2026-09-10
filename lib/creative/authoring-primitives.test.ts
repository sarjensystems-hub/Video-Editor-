import { describe, expect, it } from "vitest";
import { applyOrbitGroup, explodeTextElement } from "./authoring-primitives";
import type { CreativeDocument, CreativeElement, CreativeGroup } from "./schema";

const transform = (overrides: Record<string, number> = {}) => ({
  x: 0, y: 0, width: 100, height: 100, rotation: 0,
  opacity: 1, anchorX: 0.5, anchorY: 0.5, zIndex: 1,
  ...overrides,
});

const box = (id: string, overrides: Record<string, number> = {}): CreativeElement =>
  ({
    id, name: id, type: "shape", shape: "rect",
    fill: { kind: "literal", value: "#fff" },
    transform: transform(overrides),
  }) as unknown as CreativeElement;

const text = (id: string, body: string, overrides: Record<string, unknown> = {}): CreativeElement =>
  ({
    id, name: id, type: "text", text: body,
    style: { token: "body" },
    transform: transform({ width: 600, height: 60 }),
    ...overrides,
  }) as unknown as CreativeElement;

function film(elements: CreativeElement[], groups: CreativeGroup[] = []): CreativeDocument {
  return {
    version: 1,
    id: "doc",
    title: "Film",
    canvas: { width: 1080, height: 1920, fps: 30, background: { kind: "literal", value: "#000" } },
    designSystem: {
      colors: {},
      typography: {
        body: {
          fontFamily: "Inter", fontSize: 40, fontWeight: 400, lineHeight: 1.2,
          letterSpacing: 0, align: "left", color: { kind: "literal", value: "#000" },
        },
      },
      spacing: {},
      radii: {},
    },
    scenes: [{ id: "scene-1", name: "Scene", durationMs: 4000, elements, groups }],
  } as unknown as CreativeDocument;
}

const orbitFilm = () =>
  film(
    [
      box("hub", { x: 400, y: 400, width: 200, height: 200 }),
      box("n1", { width: 50, height: 50 }),
      box("n2", { width: 50, height: 50 }),
      box("n3", { width: 50, height: 50 }),
      box("n4", { width: 50, height: 50 }),
    ],
    [{ id: "ring", name: "ring", elementIds: ["hub", "n1", "n2", "n3", "n4"] }],
  );

const elementsOf = (result: { ok: true; document: CreativeDocument }) =>
  new Map(result.document.scenes[0].elements.map((element) => [element.id, element] as const));

describe("orbit_group places items on a circle", () => {
  it("spaces items evenly and centres each on its own box", () => {
    const result = applyOrbitGroup(orbitFilm(), {
      sceneId: "scene-1", groupId: "ring", centerElementId: "hub", radius: 300,
    });
    expect(result.ok).toBe(true);
    const elements = elementsOf(result as never);

    // Four items from -90deg: top, right, bottom, left. Hub centre is (500,500)
    // and each item is offset by half its own size so its centre lands on the
    // circle rather than its corner.
    const at = (id: string) => {
      const { x, y } = elements.get(id)!.transform;
      return [x, y];
    };
    for (const [id, expected] of [
      ["n1", [475, 175]], ["n2", [775, 475]], ["n3", [475, 775]], ["n4", [175, 475]],
    ] as Array<[string, number[]]>) {
      const [x, y] = at(id);
      expect(x, id).toBeCloseTo(expected[0], 6);
      expect(y, id).toBeCloseTo(expected[1], 6);
    }
  });

  it("leaves the centre element where it is", () => {
    const result = applyOrbitGroup(orbitFilm(), {
      sceneId: "scene-1", groupId: "ring", centerElementId: "hub", radius: 300,
    });
    expect(elementsOf(result as never).get("hub")!.transform).toMatchObject({ x: 400, y: 400 });
  });

  it("accepts an explicit centre instead of an element", () => {
    const result = applyOrbitGroup(orbitFilm(), {
      sceneId: "scene-1", groupId: "ring", itemIds: ["n1"], centerX: 0, centerY: 0, radius: 100, startAngleDeg: 0,
    });
    const placed = elementsOf(result as never).get("n1")!.transform;
    expect(placed.x).toBeCloseTo(75, 6);
    expect(placed.y).toBeCloseTo(-25, 6);
  });

  it("animates radius and rotation as keyframes rather than baking one position", () => {
    const result = applyOrbitGroup(orbitFilm(), {
      sceneId: "scene-1", groupId: "ring", centerElementId: "hub",
      radius: 100, radiusTo: 300, rotateByDeg: 90, startMs: 0, endMs: 1000,
    });
    expect(result.ok).toBe(true);
    const n1 = elementsOf(result as never).get("n1") as unknown as { animations?: unknown[] };
    expect(n1.animations?.length, "an animated orbit must produce keyframes").toBeGreaterThan(0);
  });
});

describe("orbit_group refuses what it cannot place", () => {
  const orbit = (spec: Record<string, unknown>) =>
    applyOrbitGroup(orbitFilm(), { sceneId: "scene-1", groupId: "ring", radius: 300, ...spec } as never);

  it("rejects a negative or non-finite radius", () => {
    expect(orbit({ radius: -1, centerElementId: "hub" })).toMatchObject({ ok: false, code: "invalid_operation" });
    expect(orbit({ radius: Number.NaN, centerElementId: "hub" })).toMatchObject({ ok: false });
  });

  it("requires a centre it can actually find", () => {
    expect(orbit({ centerElementId: "ghost" })).toMatchObject({ ok: false, code: "not_found" });
    expect(orbit({})).toMatchObject({ ok: false, code: "invalid_operation" });
  });

  it("refuses an item that is not a child of the group", () => {
    const document = film(
      [box("hub", { x: 400, y: 400 }), box("n1"), box("stray")],
      [{ id: "ring", name: "ring", elementIds: ["hub", "n1"] }],
    );
    expect(
      applyOrbitGroup(document, { sceneId: "scene-1", groupId: "ring", centerElementId: "hub", radius: 100, itemIds: ["stray"] }),
    ).toMatchObject({ ok: false, code: "invalid_operation" });
  });

  it("refuses to animate outside an item's visible window", () => {
    // Keyframes past an element's timing would animate something nobody sees.
    const document = film(
      [box("hub", { x: 400, y: 400 }), { ...box("n1"), timing: { startMs: 0, endMs: 500 } } as CreativeElement],
      [{ id: "ring", name: "ring", elementIds: ["hub", "n1"] }],
    );
    expect(
      applyOrbitGroup(document, {
        sceneId: "scene-1", groupId: "ring", centerElementId: "hub",
        radius: 100, radiusTo: 200, startMs: 0, endMs: 2000,
      }),
    ).toMatchObject({ ok: false, code: "invalid_operation" });
  });

  it("requires start before end when animating", () => {
    expect(orbit({ centerElementId: "hub", radiusTo: 400, startMs: 900, endMs: 300 }))
      .toMatchObject({ ok: false, code: "invalid_operation" });
  });
});

describe("explode_text splits one element into addressable units", () => {
  const document = () => film([text("headline", "Ship it fast")]);

  it("replaces the source with one element per word, in order", () => {
    const result = explodeTextElement(document(), {
      sceneId: "scene-1", elementId: "headline", granularity: "word",
    });
    expect(result.ok).toBe(true);
    const elements = (result as { ok: true; document: CreativeDocument }).document.scenes[0].elements;

    expect(elements.map((element) => element.id)).toEqual([
      "headline--word-0", "headline--word-1", "headline--word-2",
    ]);
    expect(elements.map((element) => (element as unknown as { text: string }).text)).toEqual([
      "Ship", "it", "fast",
    ]);
  });

  it("lays the units out left to right without overlapping", () => {
    const result = explodeTextElement(document(), {
      sceneId: "scene-1", elementId: "headline", granularity: "word",
    });
    const elements = (result as { ok: true; document: CreativeDocument }).document.scenes[0].elements;
    for (let i = 1; i < elements.length; i += 1) {
      expect(elements[i].transform.x).toBeGreaterThan(elements[i - 1].transform.x);
    }
  });

  it("collects the units into a group so they can be staggered as one", () => {
    const result = explodeTextElement(document(), {
      sceneId: "scene-1", elementId: "headline", granularity: "character",
    });
    const scene = (result as { ok: true; document: CreativeDocument }).document.scenes[0];
    const group = scene.groups.find((candidate) => candidate.id === "headline--exploded");
    expect(group).toBeDefined();
    expect(group!.elementIds).toEqual(scene.elements.map((element) => element.id));
  });

  it("drops the source animation and fit, which no longer describe the parts", () => {
    const result = explodeTextElement(
      film([text("headline", "Ship it", { fit: { mode: "shrink", minFontSize: 10 } })]),
      { sceneId: "scene-1", elementId: "headline", granularity: "word" },
    );
    const first = (result as { ok: true; document: CreativeDocument }).document.scenes[0]
      .elements[0] as unknown as { animation?: unknown; fit?: unknown };
    expect(first.animation).toBeUndefined();
    expect(first.fit).toBeUndefined();
  });

  it("refuses a rotated source rather than laying units out along the wrong axis", () => {
    const rotated = film([text("headline", "Ship it", { transform: transform({ width: 600, rotation: 15 }) })]);
    expect(explodeTextElement(rotated, { sceneId: "scene-1", elementId: "headline", granularity: "word" }))
      .toMatchObject({ ok: false, code: "invalid_operation" });
  });

  it("refuses a non-text element and a group id already in use", () => {
    expect(explodeTextElement(film([box("plate")]), { sceneId: "scene-1", elementId: "plate", granularity: "word" }))
      .toMatchObject({ ok: false, code: "invalid_operation" });

    const taken = film([text("headline", "Ship it")], [{ id: "taken", name: "taken", elementIds: [] }]);
    expect(explodeTextElement(taken, { sceneId: "scene-1", elementId: "headline", granularity: "word", groupId: "taken" }))
      .toMatchObject({ ok: false, code: "duplicate_id" });
  });
});
