import { beforeEach, describe, expect, it, vi } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import { createCanonicalCreativeFixture } from "./fixtures";

const deleteUserFiles = vi.fn();
vi.mock("../storage", () => ({ deleteUserFiles: (...args: unknown[]) => deleteUserFiles(...args) }));

import { deleteCreativeProjectWithFiles } from "./project-delete";

type Row = Record<string, unknown>;
const URL_BASE = "https://proj.supabase.co/storage/v1/object/public/article-images/user-1";

/** Just enough of the Supabase query builder for the purge's queries. */
function fakeSupabase(tables: Record<string, Row[]>) {
  return {
    from(table: string) {
      const filters: Array<(row: Row) => boolean> = [];
      let mode: "select" | "delete" = "select";
      const builder = {
        select: () => builder,
        delete: () => {
          mode = "delete";
          return builder;
        },
        eq: (column: string, value: unknown) => (filters.push((row) => row[column] === value), builder),
        neq: (column: string, value: unknown) => (filters.push((row) => row[column] !== value), builder),
        in: (column: string, values: unknown[]) => (filters.push((row) => values.includes(row[column])), builder),
        maybeSingle: async () => ({ data: tables[table].find((row) => filters.every((f) => f(row))) ?? null, error: null }),
        then(resolve: (value: { data: Row[]; error: null }) => void) {
          const matched = tables[table].filter((row) => filters.every((f) => f(row)));
          if (mode === "delete") {
            tables[table] = tables[table].filter((row) => !matched.includes(row));
            // Mirror the schema's cascades.
            if (table === "creative_projects") {
              const ids = matched.map((row) => row.id);
              tables.creative_render_jobs = tables.creative_render_jobs.filter((row) => !ids.includes(row.project_id));
            }
          }
          resolve({ data: matched, error: null });
        },
      };
      return builder;
    },
  } as unknown as SupabaseClient;
}

function documentUsing(assetId: string) {
  const document = createCanonicalCreativeFixture();
  document.scenes[0].elements.push({
    ...(document.scenes[0].elements.find((element) => element.type === "image") as object),
    id: `uses-${assetId}`,
    assetId,
  } as never);
  return document;
}

describe("deleting a project with its files", () => {
  let tables: Record<string, Row[]>;

  beforeEach(() => {
    deleteUserFiles.mockReset();
    deleteUserFiles.mockImplementation(async (_user: string, urls: string[]) => ({ removed: urls.length, skipped: 0, notRemoved: 0 }));
    tables = {
      creative_projects: [
        { id: "doomed", user_id: "user-1", document: createCanonicalCreativeFixture() },
        { id: "other", user_id: "user-1", document: documentUsing("shared-asset") },
      ],
      creative_render_jobs: [
        { id: "r1", project_id: "doomed", user_id: "user-1", output_url: `${URL_BASE}/renders/r1.mp4` },
        { id: "r2", project_id: "other", user_id: "user-1", output_url: `${URL_BASE}/renders/r2.mp4` },
      ],
      creative_assets: [
        { id: "own-asset", project_id: "doomed", user_id: "user-1", url: `${URL_BASE}/audio/own.wav` },
        { id: "shared-asset", project_id: "doomed", user_id: "user-1", url: `${URL_BASE}/images/shared.png` },
        { id: "promoted", project_id: "doomed", user_id: "user-1", url: `${URL_BASE}/videos/gen.mp4` },
      ],
      video_generations: [{ id: "gen", user_id: "user-1", video_url: `${URL_BASE}/videos/gen.mp4` }],
    };
  });

  it("deletes the project's renders and the assets only it used", async () => {
    const result = await deleteCreativeProjectWithFiles(fakeSupabase(tables), "user-1", "doomed");

    expect(result.found).toBe(true);
    const [userId, urls] = deleteUserFiles.mock.calls[0];
    expect(userId).toBe("user-1");
    expect(urls).toEqual(expect.arrayContaining([`${URL_BASE}/renders/r1.mp4`, `${URL_BASE}/audio/own.wav`]));
    expect(tables.creative_projects.map((row) => row.id)).toEqual(["other"]);
    expect(tables.creative_render_jobs.map((row) => row.id)).toEqual(["r2"]);
  });

  it("keeps an asset another project still places on its timeline", async () => {
    await deleteCreativeProjectWithFiles(fakeSupabase(tables), "user-1", "doomed");
    const urls = deleteUserFiles.mock.calls[0][1] as string[];
    expect(urls).not.toContain(`${URL_BASE}/images/shared.png`);
    expect(tables.creative_assets.map((row) => row.id)).toContain("shared-asset");
  });

  /** A promoted video shares its file with the Videos page entry. */
  it("keeps a file a generated video still plays from", async () => {
    await deleteCreativeProjectWithFiles(fakeSupabase(tables), "user-1", "doomed");
    const urls = deleteUserFiles.mock.calls[0][1] as string[];
    expect(urls).not.toContain(`${URL_BASE}/videos/gen.mp4`);
    // The asset row goes; the file stays because the generation needs it.
    expect(tables.creative_assets.map((row) => row.id)).not.toContain("promoted");
  });

  it("does nothing for a project that is not the user's", async () => {
    const result = await deleteCreativeProjectWithFiles(fakeSupabase(tables), "user-2", "doomed");
    expect(result.found).toBe(false);
    expect(deleteUserFiles).not.toHaveBeenCalled();
    expect(tables.creative_projects).toHaveLength(2);
  });
});
