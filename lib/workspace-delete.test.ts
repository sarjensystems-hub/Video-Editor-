import { beforeEach, describe, expect, it, vi } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";

const deleteUserFiles = vi.fn();
vi.mock("./storage", () => ({ deleteUserFiles: (...args: unknown[]) => deleteUserFiles(...args) }));

import { deleteWorkspaceWithFiles } from "./workspace-delete";

type Row = Record<string, unknown>;
const B = "https://proj.supabase.co/storage/v1/object/public/article-images/user-1";

function fakeSupabase(tables: Record<string, Row[]>) {
  return {
    from(table: string) {
      const filters: Array<(row: Row) => boolean> = [];
      let mode: "select" | "delete" = "select";
      const builder = {
        select: () => builder,
        delete: () => ((mode = "delete"), builder),
        eq: (c: string, v: unknown) => (filters.push((r) => r[c] === v), builder),
        in: (c: string, vs: unknown[]) => (filters.push((r) => vs.includes(r[c])), builder),
        then(resolve: (value: { data: Row[]; error: null; count: number }) => void) {
          const matched = tables[table].filter((r) => filters.every((f) => f(r)));
          if (mode === "delete") {
            tables[table] = tables[table].filter((r) => !matched.includes(r));
            if (table === "sites") {
              const ids = matched.map((r) => r.id);
              tables.video_generations = tables.video_generations.filter((r) => !ids.includes(r.site_id));
            }
          }
          resolve({ data: matched, error: null, count: matched.length });
        },
      };
      return builder;
    },
  } as unknown as SupabaseClient;
}

describe("deleting a workspace with its files", () => {
  let tables: Record<string, Row[]>;

  beforeEach(() => {
    deleteUserFiles.mockReset();
    deleteUserFiles.mockImplementation(async (_u: string, urls: string[]) => ({ removed: urls.length, skipped: 0, notRemoved: 0 }));
    tables = {
      sites: [
        { id: "ws-a", user_id: "user-1" },
        { id: "ws-b", user_id: "user-1" },
      ],
      video_generations: [
        { id: "g1", site_id: "ws-a", user_id: "user-1", video_url: `${B}/videos/g1.mp4`, characters: [{ url: `${B}/characters/alice.png` }, { url: `${B}/characters/shared.png` }] },
        { id: "g2", site_id: "ws-a", user_id: "user-1", video_url: `${B}/videos/promoted.mp4`, characters: [] },
        { id: "g3", site_id: "ws-b", user_id: "user-1", video_url: `${B}/videos/g3.mp4`, characters: [{ url: `${B}/characters/shared.png` }] },
      ],
      creative_assets: [{ id: "a1", user_id: "user-1", url: `${B}/videos/promoted.mp4` }],
      creative_render_jobs: [],
    };
  });

  it("removes the workspace's videos and the character images only they used", async () => {
    const result = await deleteWorkspaceWithFiles(fakeSupabase(tables), "user-1", "ws-a");
    expect(result.found).toBe(true);
    const urls = deleteUserFiles.mock.calls[0][1] as string[];
    expect(urls.sort()).toEqual([`${B}/characters/alice.png`, `${B}/videos/g1.mp4`]);
  });

  it("keeps a video a project still plays and a character image another workspace uses", async () => {
    await deleteWorkspaceWithFiles(fakeSupabase(tables), "user-1", "ws-a");
    const urls = deleteUserFiles.mock.calls[0][1] as string[];
    expect(urls).not.toContain(`${B}/videos/promoted.mp4`);
    expect(urls).not.toContain(`${B}/characters/shared.png`);
  });

  it("does nothing for a workspace that is not the user's", async () => {
    const result = await deleteWorkspaceWithFiles(fakeSupabase(tables), "user-2", "ws-a");
    expect(result.found).toBe(false);
    expect(deleteUserFiles).not.toHaveBeenCalled();
    expect(tables.sites).toHaveLength(2);
  });
});
