import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

/**
 * Resolves the `@/` path alias that tsconfig defines, so a module can be
 * imported in a test the same way it is imported in the app.
 *
 * Without this, a value import of `@/lib/...` inside anything a test reaches
 * fails at import time with "Cannot find package". Type-only imports survive
 * because they are erased, which is what let the gap go unnoticed.
 *
 * Note that resolving the alias does not make server-only modules safe to
 * import: anything pulling in `next/headers` still needs a request scope. Keep
 * pure logic in modules that do not reach for one.
 */
export default defineConfig({
  test: {
    /**
     * Parallel work runs in per-agent git worktrees under `.claude/worktrees/`,
     * and each one is a full copy of this repository — tests included. Left in,
     * the suite silently runs three times over three checkouts: it still passes,
     * so nothing looks wrong, but the count is meaningless and a failure could
     * be reported against a copy rather than against this tree.
     */
    exclude: ["**/node_modules/**", "**/dist/**", ".claude/worktrees/**"],
  },
  resolve: {
    alias: {
      "@": fileURLToPath(new URL(".", import.meta.url)),
    },
  },
});
