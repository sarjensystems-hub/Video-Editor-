import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const ROOT = process.cwd();

/**
 * A first-party MCP token has no Supabase session behind it, so the runtime
 * queries the database with the service role and row-level security does not
 * apply. What keeps one account's projects away from another's is that every
 * query filters on `user_id` explicitly.
 *
 * That invariant is invisible in review — a single new query without the filter
 * would read across every tenant and still pass every other test. This walks
 * the modules the MCP path touches and asserts it directly.
 */
const MCP_DATA_MODULES = [
  // mcp-runtime.ts is now a small response/guidance wrapper; the original
  // query-heavy dispatcher lives in mcp-runtime-base.ts and remains part of
  // the live call graph, so both must be scanned.
  "lib/creative/mcp-runtime.ts",
  "lib/creative/mcp-runtime-base.ts",
  "lib/creative/project-runtime.ts",
  // Generated-asset calls are dispatched by MCP and these modules contain
  // their own asset/generation queries, including the duration persistence
  // added by the consolidation batch.
  "lib/creative/workers.ts",
  "lib/creative/workers-base.ts",
  "lib/mcp-server/user-runtime.ts",
];

/**
 * Tables that are not per-user and so cannot be filtered by one. Each entry is
 * a deliberate exemption, not an oversight.
 */
const NOT_USER_SCOPED = new Set([
  // Registered OAuth clients are global; a client is not owned by anybody.
  "mcp_oauth_clients",
]);

/**
 * Splits a module into the statements that start at a `.from(` call, so a
 * filter written several lines below its query still counts. Statements end at
 * the next `.from(` or the end of the file.
 */
function supabaseStatements(source: string): Array<{ table: string; body: string }> {
  const statements: Array<{ table: string; body: string }> = [];
  const pattern = /\.from\(\s*["'`]([A-Za-z0-9_]+)["'`]\s*\)/g;

  const starts: Array<{ table: string; index: number }> = [];
  let match: RegExpExecArray | null;
  while ((match = pattern.exec(source)) !== null) {
    starts.push({ table: match[1], index: match.index });
  }

  for (let i = 0; i < starts.length; i += 1) {
    const end = i + 1 < starts.length ? starts[i + 1].index : source.length;
    statements.push({ table: starts[i].table, body: source.slice(starts[i].index, end) });
  }
  return statements;
}

describe("MCP tenant isolation", () => {
  it("scopes every per-user query by user_id", () => {
    const unscoped: string[] = [];

    for (const relative of MCP_DATA_MODULES) {
      const source = readFileSync(join(ROOT, relative), "utf8");
      for (const statement of supabaseStatements(source)) {
        if (NOT_USER_SCOPED.has(statement.table)) continue;
        if (statement.body.includes("user_id")) continue;
        unscoped.push(`${relative} → ${statement.table}`);
      }
    }

    expect(unscoped).toEqual([]);
  });

  it("finds the queries it claims to be checking", () => {
    // A walker that silently matched nothing would pass the assertion above
    // while checking nothing at all.
    const counted = MCP_DATA_MODULES.reduce(
      (total, relative) => total + supabaseStatements(readFileSync(join(ROOT, relative), "utf8")).length,
      0,
    );
    expect(counted).toBeGreaterThan(20);
  });

  it("notices a query that drops the filter", () => {
    const withFilter = `.from("creative_projects").select("id").eq("user_id", ctx.userId).single()`;
    const withoutFilter = `.from("creative_projects").select("id").eq("id", projectId).single()`;
    expect(supabaseStatements(withFilter)[0].body).toContain("user_id");
    expect(supabaseStatements(withoutFilter)[0].body).not.toContain("user_id");
  });
});
