import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, resolve } from "node:path";
import { describe, expect, it } from "vitest";

const ROOT = resolve(__dirname, "..");
const SOURCE_DIRS = ["app", "components", "lib", "remotion", "scripts"];
const SOURCE_EXTENSIONS = [".ts", ".tsx", ".mjs", ".js", ".jsx"];

/** The one shipped module allowed to read the deployment-wide key. */
const ALLOWED = new Set([join("lib", "openrouter-key.ts")]);

/**
 * Tests may name the variable: several stub it to stand in for a configured
 * key, and nothing they do can bill a real account. The rule that matters is
 * about shipped code.
 */
const isTest = (file: string) => file.includes(".test.");

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
   * Reading the env var directly is how a generation path silently goes back
   * to billing the deployment owner for someone else's work: it keeps working
   * in development, where that key is set, and only shows up as a surprise
   * OpenRouter invoice.
   */
  it("resolves the OpenRouter key in exactly one module", () => {
    const offenders = sourceFiles().filter(
      (file) =>
        !ALLOWED.has(file) &&
        !isTest(file) &&
        readFileSync(join(ROOT, file), "utf8").includes("OPENROUTER_API_KEY"),
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
