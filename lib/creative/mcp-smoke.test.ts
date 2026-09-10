import { beforeEach, describe, expect, it, vi } from "vitest";
import { createCanonicalCreativeFixture } from "./fixtures";
import type { CreativeDocument } from "./schema";

const renderFrames = vi.fn();
const renderFrame = vi.fn();
const render = vi.fn();

vi.mock("./render", () => ({
  creativeRenderAdapter: {
    render: (...args: unknown[]) => render(...args),
    renderFrame: (...args: unknown[]) => renderFrame(...args),
    renderFrames: (...args: unknown[]) => renderFrames(...args),
  },
}));

type Row = Record<string, unknown>;

/**
 * Minimal in-memory stand-in for the query chains the creative runtime uses.
 * It exists so the smoke test exercises real dispatch, parsing, validation
 * and revisioning rather than a mock of the runtime itself.
 */
class FakeQuery implements PromiseLike<{ data: unknown; error: unknown }> {
  private filters: Array<(row: Row) => boolean> = [];
  private sorts: Array<{ column: string; ascending: boolean }> = [];
  private limitCount: number | null = null;

  constructor(
    private readonly tables: Record<string, Row[]>,
    private readonly table: string,
    private readonly mode: "select" | "insert" | "update" | "delete",
    private readonly payload?: Row,
  ) {}

  select() {
    return this;
  }

  eq(column: string, value: unknown) {
    this.filters.push((row) => row[column] === value);
    return this;
  }

  in(column: string, values: unknown[]) {
    this.filters.push((row) => values.includes(row[column]));
    return this;
  }

  order(column: string, options?: { ascending?: boolean }) {
    this.sorts.push({ column, ascending: options?.ascending ?? true });
    return this;
  }

  limit(count: number) {
    this.limitCount = count;
    return this;
  }

  private rows(): Row[] {
    let rows = (this.tables[this.table] ?? []).filter((row) => this.filters.every((keep) => keep(row)));
    for (const sort of [...this.sorts].reverse()) {
      rows = [...rows].sort((a, b) => {
        const left = a[sort.column] as string | number;
        const right = b[sort.column] as string | number;
        if (left === right) return 0;
        return (left < right ? -1 : 1) * (sort.ascending ? 1 : -1);
      });
    }
    return this.limitCount === null ? rows : rows.slice(0, this.limitCount);
  }

  private run(): { data: unknown; error: unknown } {
    if (this.mode === "insert") {
      const row = { id: this.payload?.id ?? `${this.table}-${(this.tables[this.table] ?? []).length + 1}`, ...this.payload };
      this.tables[this.table] = [...(this.tables[this.table] ?? []), row];
      return { data: [row], error: null };
    }
    if (this.mode === "update") {
      const matched = this.rows();
      for (const row of matched) Object.assign(row, this.payload);
      return { data: matched, error: null };
    }
    if (this.mode === "delete") {
      const matched = new Set(this.rows());
      this.tables[this.table] = (this.tables[this.table] ?? []).filter((row) => !matched.has(row));
      return { data: [...matched], error: null };
    }
    return { data: this.rows(), error: null };
  }

  async maybeSingle() {
    const result = this.run();
    return { data: (result.data as Row[])[0] ?? null, error: result.error };
  }

  async single() {
    const result = this.run();
    const row = (result.data as Row[])[0] ?? null;
    return { data: row, error: row ? null : { message: "Row not found" } };
  }

  then<TResult1 = { data: unknown; error: unknown }, TResult2 = never>(
    onfulfilled?: ((value: { data: unknown; error: unknown }) => TResult1 | PromiseLike<TResult1>) | null,
    onrejected?: ((reason: unknown) => TResult2 | PromiseLike<TResult2>) | null,
  ): PromiseLike<TResult1 | TResult2> {
    return Promise.resolve(this.run()).then(onfulfilled, onrejected);
  }
}

/**
 * Stands in for the `deduct_credits` / `add_credits` SECURITY DEFINER
 * functions, including the `insufficient_credits` exception the real one
 * raises. Metering runs for real in this test so a path that costs a vendor
 * bill cannot quietly stop charging.
 */
function fakeRpc(tables: Record<string, Row[]>) {
  return async (fn: string, args: Record<string, unknown>) => {
    const row = (tables.user_credits ?? []).find((entry) => entry.user_id === args.p_user_id);
    if (fn === "charge_creative_render_once") {
      const job = (tables.creative_render_jobs ?? []).find((entry) => entry.id === args.p_job_id && entry.user_id === args.p_user_id);
      const balance = Number(row?.balance ?? 0);
      const amount = Number(args.p_amount);
      if (!job) return { data: null, error: { message: "render_job_not_chargeable" } };
      if (Number(job.credits_charged ?? 0) > 0) return { data: false, error: null };
      if (!row || balance < amount) return { data: null, error: { message: "insufficient_credits" } };
      row.balance = balance - amount;
      job.credits_charged = amount;
      return { data: true, error: null };
    }
    if (fn === "refund_creative_render_once") {
      const job = (tables.creative_render_jobs ?? []).find((entry) => entry.id === args.p_job_id && entry.user_id === args.p_user_id);
      const amount = Number(job?.credits_charged ?? 0);
      if (!job || !["failed", "cancelled"].includes(String(job.status)) || job.credits_refunded_at || amount <= 0) return { data: false, error: null };
      if (row) row.balance = Number(row.balance ?? 0) + amount;
      job.credits_refunded_at = new Date().toISOString();
      return { data: true, error: null };
    }
    if (fn === "deduct_credits") {
      const balance = Number(row?.balance ?? 0);
      const amount = Number(args.p_amount);
      if (!row || balance < amount) {
        return { data: null, error: { message: "insufficient_credits" } };
      }
      row.balance = balance - amount;
      tables.credit_transactions = [
        ...(tables.credit_transactions ?? []),
        { user_id: args.p_user_id, amount: -amount, type: "spend", action: args.p_action },
      ];
      return { data: row.balance, error: null };
    }
    if (fn === "add_credits") {
      if (row) row.balance = Number(row.balance ?? 0) + Number(args.p_amount);
      tables.credit_transactions = [
        ...(tables.credit_transactions ?? []),
        { user_id: args.p_user_id, amount: Number(args.p_amount), type: args.p_type, action: args.p_action },
      ];
      return { data: row?.balance ?? 0, error: null };
    }
    return { data: null, error: { message: `Unknown rpc ${fn}` } };
  };
}

function fakeContext(tables: Record<string, Row[]>) {
  const supabase = {
    rpc: fakeRpc(tables),
    from(table: string) {
      return {
        select: () => new FakeQuery(tables, table, "select"),
        insert: (payload: Row) => new FakeQuery(tables, table, "insert", payload),
        update: (payload: Row) => new FakeQuery(tables, table, "update", payload),
        delete: () => new FakeQuery(tables, table, "delete"),
      };
    },
  };
  return { user: { id: "user-1" }, supabase, serviceSupabase: supabase } as never;
}

describe("Creative Studio MCP smoke path", () => {
  let tables: Record<string, Row[]>;

  beforeEach(() => {
    renderFrames.mockReset();
    tables = {
      sites: [{ id: "site-1", user_id: "user-1", is_default: true, created_at: "2026-01-01" }],
      creative_projects: [],
      creative_project_revisions: [],
      creative_assets: [],
      creative_render_jobs: [],
      user_credits: [{ user_id: "user-1", balance: 500 }],
      credit_transactions: [],
    };
    renderFrames.mockImplementation(async ({ timesMs, outputKeys, contactSheetKey }) => ({
      frames: timesMs.map((timeMs: number, index: number) => ({
        url: `https://cdn.example.com/${outputKeys[index]}`,
        contentType: "image/png",
        sizeBytes: 100 + index,
        renderer: "remotion-vercel" as const,
        frame: Math.floor((timeMs * 30) / 1000),
        timeMs,
      })),
      contactSheet: contactSheetKey
        ? {
            url: `https://cdn.example.com/${contactSheetKey}`,
            contentType: "image/png",
            sizeBytes: 4096,
            columns: 2,
            rows: 1,
            width: 1920,
            height: 1202,
          }
        : undefined,
    }));
  });

  it("refuses an import whose document changed in transit, before writing anything", async () => {
    // The document arrives inline, so importing an authored file means
    // retyping it. A dropped element imports cleanly and only shows up later
    // as a wrong film, which is the failure this catches.
    const { handleCreativeMcpTool } = await import("./mcp-runtime");
    const { documentSha256 } = await import("./document-hash");
    const context = fakeContext(tables);

    const authored = { ...createCanonicalCreativeFixture(), id: "draft" };
    const intact = documentSha256(authored);
    const damaged = {
      ...authored,
      scenes: [{ ...authored.scenes[0], elements: authored.scenes[0].elements.slice(1) }],
    };

    await expect(
      handleCreativeMcpTool(context, "studio_import_creative_document", {
        title: "Damaged",
        document: damaged,
        document_sha256: intact,
      }),
    ).rejects.toThrow(/changed in transit/);

    // Nothing was written: no project, no revision 1.
    expect(tables.creative_project_revisions ?? []).toHaveLength(0);
    expect(tables.creative_projects ?? []).toHaveLength(0);

    const good = (await handleCreativeMcpTool(context, "studio_import_creative_document", {
      title: "Intact",
      document: authored,
      document_sha256: intact,
    })) as { document_sha256: string; project_id: string };

    expect(good.document_sha256).toBe(intact);
    expect(tables.creative_project_revisions).toHaveLength(1);
  });

  it("hashes the document as sent, not as normalized", async () => {
    // The parser normalizes the title and fills a missing id, so hashing the
    // parsed document would compare against something the caller never had.
    const { handleCreativeMcpTool } = await import("./mcp-runtime");
    const { documentSha256 } = await import("./document-hash");
    const context = fakeContext(tables);
    const authored = { ...createCanonicalCreativeFixture(), id: "draft", title: "Authored title" };

    const imported = (await handleCreativeMcpTool(context, "studio_import_creative_document", {
      // A title override is exactly what makes the stored document differ.
      title: "Different stored title",
      document: authored,
      document_sha256: documentSha256(authored),
    })) as { document_sha256: string; title: string };

    expect(imported.title).toBe("Different stored title");
    expect(imported.document_sha256).toBe(documentSha256(authored));
  });

  it("returns the document hash even when none was supplied", async () => {
    const { handleCreativeMcpTool } = await import("./mcp-runtime");
    const { documentSha256 } = await import("./document-hash");
    const context = fakeContext(tables);
    const authored = { ...createCanonicalCreativeFixture(), id: "draft" };

    const imported = (await handleCreativeMcpTool(context, "studio_import_creative_document", {
      title: "No hash given",
      document: authored,
    })) as { document_sha256: string };

    // Recorded on a first import, checkable on the next.
    expect(imported.document_sha256).toBe(documentSha256(authored));
  });

  it("does not spend a revision on a dry run", async () => {
    // Several revisions in a real editing session were corrections of a
    // misreading of the engine rather than changes of mind. A dry run has to
    // answer the question and leave no trace, or it is not worth having.
    const { handleCreativeMcpTool } = await import("./mcp-runtime");
    const context = fakeContext(tables);

    const imported = (await handleCreativeMcpTool(context, "studio_import_creative_document", {
      title: "Dry run",
      document: { ...createCanonicalCreativeFixture(), id: "draft" },
    })) as { project_id: string; current_revision_id: string };

    const revisionsBefore = tables.creative_project_revisions.length;

    const preview = (await handleCreativeMcpTool(context, "studio_edit_creative_project", {
      project_id: imported.project_id,
      dry_run: true,
      return: "document",
      transaction: {
        summary: "Would this work?",
        operations: [{ type: "set_text", sceneId: "scene-1", elementId: "headline", text: "TRY THIS." }],
      },
    })) as { dry_run: boolean; would_apply: boolean; document: CreativeDocument; current_revision_id: string; warnings: unknown[] };

    expect(preview.dry_run).toBe(true);
    expect(preview.would_apply).toBe(true);
    // It shows what the edit would produce...
    const headline = preview.document.scenes[0].elements.find((element) => element.id === "headline");
    expect(headline?.type === "text" ? headline.text : null).toBe("TRY THIS.");
    expect(Array.isArray(preview.warnings)).toBe(true);
    // ...while the project keeps the revision it already had.
    expect(tables.creative_project_revisions).toHaveLength(revisionsBefore);
    expect(preview.current_revision_id).toBe(imported.current_revision_id);

    const stored = (await handleCreativeMcpTool(context, "studio_get_creative_project", {
      project_id: imported.project_id,
    })) as { document: CreativeDocument };
    const unchanged = stored.document.scenes[0].elements.find((element) => element.id === "headline");
    expect(unchanged?.type === "text" ? unchanged.text : null).not.toBe("TRY THIS.");
  });

  it("reports a failing transaction on a dry run instead of throwing", async () => {
    const { handleCreativeMcpTool } = await import("./mcp-runtime");
    const context = fakeContext(tables);
    const imported = (await handleCreativeMcpTool(context, "studio_import_creative_document", {
      title: "Dry run",
      document: { ...createCanonicalCreativeFixture(), id: "draft" },
    })) as { project_id: string };

    const preview = (await handleCreativeMcpTool(context, "studio_edit_creative_project", {
      project_id: imported.project_id,
      dry_run: true,
      transaction: {
        summary: "Nonsense",
        operations: [{ type: "set_text", sceneId: "scene-1", elementId: "no-such-element", text: "x" }],
      },
    })) as {
      would_apply: boolean;
      error: { message: string; operation_index: number | null; validated_count: number };
    };

    // The point of a dry run is to be told, so this is an answer and not an
    // exception the caller has to catch and parse.
    expect(preview.would_apply).toBe(false);
    expect(preview.error.message).toContain("no-such-element");
    expect(preview.error.operation_index).toBe(0);
    // roadmap #71: the failing operation is the very first one, so nothing
    // validated ahead of it.
    expect(preview.error.validated_count).toBe(0);
    expect(tables.creative_project_revisions).toHaveLength(1);
  });

  it("reports a failing real transaction as data, with validated_count, and leaves the document untouched", async () => {
    // roadmap #71: the same guarantee the dry-run test above checks, but for
    // a real edit call. Before this, a rejected transaction only threw a
    // plain Error carrying "Operation N: ..." as a sentence, so a caller had
    // no structured operation_index or validated_count to act on and no way
    // to tell "your edit was rejected" apart from any other thrown failure.
    const { handleCreativeMcpTool } = await import("./mcp-runtime");
    const context = fakeContext(tables);
    const imported = (await handleCreativeMcpTool(context, "studio_import_creative_document", {
      title: "Real failure",
      document: { ...createCanonicalCreativeFixture(), id: "draft-real-failure" },
    })) as { project_id: string };
    const revisionsBefore = tables.creative_project_revisions.length;

    const result = (await handleCreativeMcpTool(context, "studio_edit_creative_project", {
      project_id: imported.project_id,
      transaction: {
        summary: "Two good edits then a bad one",
        operations: [
          { type: "set_text", sceneId: "scene-1", elementId: "headline", text: "FIRST EDIT" },
          { type: "move_element", sceneId: "scene-1", elementId: "accent-line", x: 100, y: 980 },
          { type: "set_text", sceneId: "scene-1", elementId: "no-such-element", text: "x" },
          { type: "set_text", sceneId: "scene-1", elementId: "headline", text: "NEVER APPLIED" },
        ],
      },
    })) as { error?: { message: string; operation_index: number | null; validated_count: number } };

    // Reported as data - a normal tool result carrying an error key, not a
    // rejected call the agent has to catch.
    expect(result.error).toBeDefined();
    expect(result.error?.message).toContain("no-such-element");
    expect(result.error?.operation_index).toBe(2);
    // Operations 0 and 1, applied together, already produced a valid
    // document, so a caller can fix and resend from index 2 onward.
    expect(result.error?.validated_count).toBe(2);

    // Atomic: no partial mutation, even though operations 0 and 1 were each
    // individually valid on their own and a naive implementation could have
    // been tempted to keep them.
    expect(tables.creative_project_revisions).toHaveLength(revisionsBefore);
    const stored = (await handleCreativeMcpTool(context, "studio_get_creative_project", {
      project_id: imported.project_id,
    })) as { document: CreativeDocument };
    const headline = stored.document.scenes[0].elements.find((element) => element.id === "headline");
    expect(headline?.type === "text" ? headline.text : null).toBe("STOP GUESSING.");
    const accentLine = stored.document.scenes[0].elements.find((element) => element.id === "accent-line");
    expect(accentLine?.transform.x).toBe(80);
  });

  it("applies a transaction at the new operation cap and rejects one over it", async () => {
    // roadmap #71: MAX_TRANSACTION_OPERATIONS is imported rather than
    // hardcoded so this test tracks the real cap rather than asserting a
    // number that could drift from it.
    const { handleCreativeMcpTool } = await import("./mcp-runtime");
    const { MAX_TRANSACTION_OPERATIONS } = await import("./schema-guide");
    const context = fakeContext(tables);
    const imported = (await handleCreativeMcpTool(context, "studio_import_creative_document", {
      title: "Cap test",
      document: { ...createCanonicalCreativeFixture(), id: "draft-cap-test" },
    })) as { project_id: string };

    const atCap = Array.from({ length: MAX_TRANSACTION_OPERATIONS }, (_, i) => ({
      type: "set_text",
      sceneId: "scene-1",
      elementId: "headline",
      text: `Edit ${i}`,
    }));

    const applied = (await handleCreativeMcpTool(context, "studio_edit_creative_project", {
      project_id: imported.project_id,
      transaction: { summary: "At the cap", operations: atCap },
    })) as { applied: number; revision_id: string };
    expect(applied.applied).toBe(MAX_TRANSACTION_OPERATIONS);
    expect(applied.revision_id).toBeTruthy();

    const stored = (await handleCreativeMcpTool(context, "studio_get_creative_project", {
      project_id: imported.project_id,
    })) as { document: CreativeDocument };
    const headline = stored.document.scenes[0].elements.find((element) => element.id === "headline");
    expect(headline?.type === "text" ? headline.text : null).toBe(`Edit ${MAX_TRANSACTION_OPERATIONS - 1}`);

    const revisionsAfterCap = tables.creative_project_revisions.length;
    const overCap = [...atCap, { type: "set_text", sceneId: "scene-1", elementId: "headline", text: "one too many" }];
    await expect(
      handleCreativeMcpTool(context, "studio_edit_creative_project", {
        project_id: imported.project_id,
        transaction: { summary: "One over the cap", operations: overCap },
      }),
    ).rejects.toThrow(new RegExp(String(MAX_TRANSACTION_OPERATIONS)));

    // Rejected while parsing, before persistence was ever attempted.
    expect(tables.creative_project_revisions).toHaveLength(revisionsAfterCap);
  });

  it("ingests a ChatGPT document, edits it, then previews the current revision", async () => {
    const { handleCreativeMcpTool } = await import("./mcp-runtime");
    const context = fakeContext(tables);
    const authored = { ...createCanonicalCreativeFixture(), id: "chatgpt-local-draft", title: "Draft" };

    const imported = (await handleCreativeMcpTool(context, "studio_import_creative_document", {
      title: "Spring launch",
      document: authored,
      // These assertions are about the stored document, so this call asks for
      // it; without `return` a mutating call now answers with a summary.
      return: "document",
    })) as { project_id: string; title: string; current_revision_id: string; document: CreativeDocument };

    expect(imported.title).toBe("Spring launch");
    // Project identity is Studio's, never the submitting client's.
    expect(imported.document.id).toBe(imported.project_id);
    expect(imported.document.id).not.toBe("chatgpt-local-draft");
    expect(imported.document.scenes[0].elements).toHaveLength(authored.scenes[0].elements.length);
    expect(tables.creative_project_revisions).toHaveLength(1);
    expect(tables.creative_project_revisions[0].sequence).toBe(1);

    const edited = (await handleCreativeMcpTool(context, "studio_edit_creative_project", {
      project_id: imported.project_id,
      transaction: {
        summary: "Sharpen the headline",
        operations: [{ type: "set_text", sceneId: "scene-1", elementId: "headline", text: "BOOK IN 30 SECONDS." }],
      },
      return: "document",
    })) as { revision: number; document: CreativeDocument };

    expect(edited.revision).toBe(2);
    const headline = edited.document.scenes[0].elements.find((element) => element.id === "headline");
    expect(headline?.type === "text" ? headline.text : null).toBe("BOOK IN 30 SECONDS.");

    const frame = (await handleCreativeMcpTool(context, "studio_render_creative_frame", {
      project_id: imported.project_id,
      time_ms: 1500,
    })) as Record<string, unknown>;

    expect(frame.frame).toBe(45);
    expect(frame.time_ms).toBe(1500);
    expect(frame.content_type).toBe("image/png");
    expect(String(frame.output_url)).toContain(`creative-previews/user-1/${imported.project_id}/`);
    // The preview renders the revision the edit produced, not the one before it.
    expect(frame.revision_id).toBe(tables.creative_projects[0].current_revision_id);
    expect(renderFrames.mock.calls[0][0].document.scenes[0].elements.find((e: { id: string }) => e.id === "headline").text)
      .toBe("BOOK IN 30 SECONDS.");
  });

  it("returns a committed edit when its optional revision-pinned thumbnails fail", async () => {
    const { handleCreativeMcpTool } = await import("./mcp-runtime");
    const context = fakeContext(tables);
    const imported = (await handleCreativeMcpTool(context, "studio_import_creative_document", {
      document: createCanonicalCreativeFixture(),
    })) as { project_id: string };
    renderFrames.mockRejectedValueOnce(new Error("thumbnail sandbox unavailable"));

    const edited = (await handleCreativeMcpTool(context, "studio_edit_creative_project", {
      project_id: imported.project_id,
      transaction: { summary: "Committed edit", operations: [{ type: "set_text", sceneId: "scene-1", elementId: "headline", text: "COMMITTED" }] },
      thumbnail_times_ms: [0],
      return: "document",
    })) as { revision: number; revision_id: string; document: CreativeDocument; thumbnail_error?: string };

    expect(edited.revision).toBe(2);
    expect(edited.thumbnail_error).toMatch(/thumbnail sandbox unavailable/);
    expect(renderFrames.mock.calls[0][0].document.scenes[0].elements.find((element: { id: string }) => element.id === "headline").text).toBe("COMMITTED");
    expect(tables.creative_projects[0].current_revision_id).toBe(edited.revision_id);
  });

  it("returns a contact sheet plus every individual frame", async () => {
    const { handleCreativeMcpTool } = await import("./mcp-runtime");
    const context = fakeContext(tables);
    const imported = (await handleCreativeMcpTool(context, "studio_import_creative_document", {
      document: createCanonicalCreativeFixture(),
    })) as { project_id: string };

    const sheet = (await handleCreativeMcpTool(context, "studio_render_creative_contact_sheet", {
      project_id: imported.project_id,
      times_ms: [0, 4000],
    })) as Record<string, unknown>;

    expect(sheet.rendered_duration_ms).toBe(8000);
    expect(sheet.contact_sheet_columns).toBe(2);
    expect(String(sheet.contact_sheet_url)).toContain("sheet-0-120.png");
    expect(sheet.frames).toEqual([
      expect.objectContaining({ time_ms: 0, frame: 0 }),
      expect.objectContaining({ time_ms: 4000, frame: 120 }),
    ]);
  });

  it("refunds the charge when the renderer fails", async () => {
    const { handleCreativeMcpTool } = await import("./mcp-runtime");
    const context = fakeContext(tables);
    const imported = (await handleCreativeMcpTool(context, "studio_import_creative_document", {
      document: createCanonicalCreativeFixture(),
    })) as { project_id: string };

    renderFrames.mockRejectedValueOnce(new Error("sandbox died"));

    await expect(
      handleCreativeMcpTool(context, "studio_render_creative_frame", {
        project_id: imported.project_id,
        time_ms: 1500,
      }),
    ).rejects.toThrow(/sandbox died/);
  });

  it("rejects a preview past the end of the rendered timeline before rendering anything", async () => {
    const { handleCreativeMcpTool } = await import("./mcp-runtime");
    const context = fakeContext(tables);
    const imported = (await handleCreativeMcpTool(context, "studio_import_creative_document", {
      document: createCanonicalCreativeFixture(),
    })) as { project_id: string };

    await expect(
      handleCreativeMcpTool(context, "studio_render_creative_frame", {
        project_id: imported.project_id,
        time_ms: 8000,
      }),
    ).rejects.toThrow(/rendered duration/i);
    expect(renderFrames).not.toHaveBeenCalled();
  });

  it("refuses an invalid document before writing a project", async () => {
    const { handleCreativeMcpTool } = await import("./mcp-runtime");
    const context = fakeContext(tables);
    const broken = createCanonicalCreativeFixture();
    broken.canvas.fps = 999;

    await expect(
      handleCreativeMcpTool(context, "studio_import_creative_document", { document: broken }),
    ).rejects.toThrow(/fps/i);
    expect(tables.creative_projects).toHaveLength(0);
    expect(tables.creative_project_revisions).toHaveLength(0);
  });

  it("lists projects newest first, with the id every other tool needs", async () => {
    const { handleCreativeMcpTool } = await import("./mcp-runtime");
    const context = fakeContext(tables);

    const first = (await handleCreativeMcpTool(context, "studio_import_creative_document", {
      title: "Older",
      document: createCanonicalCreativeFixture(),
    })) as { project_id: string };
    const second = (await handleCreativeMcpTool(context, "studio_import_creative_document", {
      title: "Newer",
      document: createCanonicalCreativeFixture(),
    })) as { project_id: string };

    // The fake has no clock, so order the rows explicitly the way Postgres would.
    tables.creative_projects.find((row) => row.id === first.project_id)!.updated_at = "2026-01-01";
    tables.creative_projects.find((row) => row.id === second.project_id)!.updated_at = "2026-06-01";

    const listed = (await handleCreativeMcpTool(context, "studio_list_creative_projects", {})) as {
      projects: Array<Record<string, unknown>>;
    };

    expect(listed.projects.map((project) => project.title)).toEqual(["Newer", "Older"]);
    // The whole point of the tool: a caller can reach an existing project.
    expect(listed.projects[0].project_id).toBe(second.project_id);
    // Shape, not content — twenty full documents would be enormous.
    expect(listed.projects[0]).not.toHaveProperty("document");
    expect(listed.projects[0].scene_count).toBe(createCanonicalCreativeFixture().scenes.length);
    expect(listed.projects[0].duration_ms).toBeGreaterThan(0);
  });

  it("never lists another user's projects", async () => {
    const { handleCreativeMcpTool } = await import("./mcp-runtime");
    const context = fakeContext(tables);
    await handleCreativeMcpTool(context, "studio_import_creative_document", {
      title: "Mine",
      document: createCanonicalCreativeFixture(),
    });
    tables.creative_projects.push({
      id: "someone-elses",
      user_id: "user-2",
      title: "Theirs",
      status: "ready",
      updated_at: "2099-01-01",
      document: createCanonicalCreativeFixture(),
    });

    const listed = (await handleCreativeMcpTool(context, "studio_list_creative_projects", {})) as {
      projects: Array<Record<string, unknown>>;
    };

    // Newest by date is the other user's row; it must still not appear.
    expect(listed.projects.map((project) => project.title)).toEqual(["Mine"]);
  });

  it("no longer dispatches the removed second-LLM creative tools", async () => {
    const { handleCreativeMcpTool } = await import("./mcp-runtime");
    const context = fakeContext(tables);
    for (const name of ["studio_direct_creative_project", "studio_decompose_image_asset"]) {
      await expect(
        handleCreativeMcpTool(context, name as never, { project_id: "project-1", intent: "make it pop" }),
      ).rejects.toThrow(/unknown creative tool/i);
    }
    expect(tables.creative_assets).toHaveLength(0);
  });
});
