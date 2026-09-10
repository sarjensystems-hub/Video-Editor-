import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { createCanonicalCreativeFixture } from "./fixtures";
import {
  createRevisionSnapshot,
  normalizeCreativeAssetKind,
  type CreativeAssetKind,
} from "./persistence";

describe("creative persistence contract", () => {
  it("creates JSON-safe immutable revision snapshots", () => {
    const document = createCanonicalCreativeFixture();
    const snapshot = createRevisionSnapshot(document, 3, "Moved headline");

    expect(snapshot.sequence).toBe(3);
    expect(snapshot.changeSummary).toBe("Moved headline");
    expect(snapshot.document).not.toBe(document);
    expect(snapshot.document).toEqual(document);

    document.title = "Changed after snapshot";
    expect(snapshot.document.title).not.toBe(document.title);
    expect(JSON.parse(JSON.stringify(snapshot.document))).toEqual(snapshot.document);
  });

  it("normalizes supported asset kinds without inventing media types", () => {
    const values: Array<[string, CreativeAssetKind]> = [
      ["image", "image"],
      ["VIDEO", "video"],
      ["audio", "audio"],
      ["font", "font"],
      ["something-new", "other"],
    ];
    for (const [input, expected] of values) {
      expect(normalizeCreativeAssetKind(input)).toBe(expected);
    }
  });

  it("ships the four persistence tables with owner RLS", () => {
    const sql = readFileSync(resolve(process.cwd(), "supabase/add_creative_studio.sql"), "utf8").toLowerCase();
    for (const table of [
      "creative_projects",
      "creative_project_revisions",
      "creative_assets",
      "creative_render_jobs",
    ]) {
      expect(sql).toContain(`create table if not exists public.${table}`);
      expect(sql).toContain(`alter table public.${table} enable row level security`);
    }
    expect(sql).toContain("auth.uid() = user_id");
    expect(sql).toContain("current_revision_id");
    expect(sql).toContain("output_url");
  });

  it("persists site ownership on creative render jobs", () => {
    const sql = readFileSync(resolve(process.cwd(), "supabase/add_creative_studio.sql"), "utf8").toLowerCase();
    const renderJobsSection = sql.slice(
      sql.indexOf("create table if not exists public.creative_render_jobs"),
      sql.indexOf("-- circular relationship is added after revisions exist."),
    );

    expect(renderJobsSection).toContain("site_id uuid references public.sites(id) on delete set null");
  });
});
