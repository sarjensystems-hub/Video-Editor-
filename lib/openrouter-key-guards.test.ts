import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, resolve } from "node:path";
import { describe, expect, it } from "vitest";

const ROOT = resolve(__dirname, "..");
const SOURCE_DIRS = ["app", "components", "lib", "remotion", "scripts"];
const SOURCE_EXTENSIONS = [".ts", ".tsx", ".mjs", ".js", ".jsx"];

/** This file names the variable in order to test that nothing else does. */
const ALLOWED = new Set([join("lib", "openrouter-key-guards.test.ts")]);

function sourceFiles(): string[] {
  const found: string[] = [];
  const walk = (relative: string) => {
    for (const entry of readdirSync(join(ROOT, relative))) {
      if (entry === "node_modules" || entry === ".next" || entry.startsWith(".")) continue;
      const childRelative = join(relative, entry);
      if (statSync(join(ROOT, childRelative)).isDirectory()) {
        walk(childRelative);
        continue;
      }
      if (SOURCE_EXTENSIONS.some((extension) => entry.endsWith(extension))) found.push(childRelative);
    }
  };
  for (const dir of SOURCE_DIRS) walk(dir);
  return found;
}

describe("bring-your-own-key guards", () => {
  /**
   * There is no deployment-wide key at all. Reintroducing one — even as a
   * fallback, even in a test helper — puts the deployment owner back on the
   * hook for other people's generation, and it would keep working locally
   * rather than failing loudly.
   */
  it("reads no deployment-wide OpenRouter key anywhere", () => {
    const offenders = sourceFiles().filter(
      (file) => !ALLOWED.has(file) && readFileSync(join(ROOT, file), "utf8").includes("OPENROUTER_API_KEY"),
    );
    expect(offenders).toEqual([]);
  });

  /**
   * A route that can reach OpenRouter but opens no key scope falls through to
   * the deployment fallback — the same silent failure, one layer up.
   */
  it("scopes every generating route to the signed-in account", () => {
    const generating = [
      join("app", "api", "videos", "generate", "route.ts"),
      join("app", "api", "videos", "status", "[id]", "route.ts"),
      join("app", "api", "creative", "decompose", "route.ts"),
      join("app", "api", "creative", "direct", "route.ts"),
      join("app", "api", "creative", "generate-image", "route.ts"),
      join("app", "api", "creative", "import", "route.ts"),
      join("app", "api", "creative", "render", "route.ts"),
      join("app", "api", "creative", "promote-video", "route.ts"),
    ];

    for (const route of generating) {
      const source = readFileSync(join(ROOT, route), "utf8");
      expect(source, `${route} must open a key scope`).toContain("withOpenRouterKeyScope");
    }

    // MCP authenticates its own way, so it binds the key itself.
    const mcp = readFileSync(join(ROOT, "app", "api", "mcp", "route.ts"), "utf8");
    expect(mcp).toContain("withUserOpenRouterKey");
  });
});
