import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, resolve } from "node:path";
import { describe, expect, it } from "vitest";

const ROOT = resolve(__dirname, "..", "..");
const API_ROOT = join(ROOT, "app", "api");
const CREATIVE_RENDER_ROUTE = "app/api/creative/render/route.ts";

function routeFiles(directory: string): string[] {
  const files: string[] = [];
  for (const entry of readdirSync(directory)) {
    const absolute = join(directory, entry);
    if (statSync(absolute).isDirectory()) {
      files.push(...routeFiles(absolute));
    } else if (entry === "route.ts" || entry === "route.js") {
      files.push(absolute);
    }
  }
  return files;
}

function declaredDuration(absolute: string) {
  const source = readFileSync(absolute, "utf8");
  const match = source.match(/export\s+const\s+maxDuration\s*=\s*(\d+)\s*;/);
  if (!match) return null;
  return {
    route: absolute.slice(ROOT.length + 1).replaceAll("\\", "/"),
    maxDuration: Number(match[1]),
  };
}

const HOBBY_MAX_DURATION = 300;

describe("Vercel runtime configuration", () => {
  it("keeps every function within the Hobby maxDuration ceiling", () => {
    const declared = routeFiles(API_ROOT)
      .map(declaredDuration)
      .filter((entry): entry is { route: string; maxDuration: number } => entry !== null);

    // A route above the ceiling is not clamped: Vercel rejects the whole
    // deployment with `invalid_max_duration` after an otherwise clean build,
    // so this has to fail here rather than at deploy time.
    expect(declared.filter((entry) => entry.maxDuration > HOBBY_MAX_DURATION)).toEqual([]);
    // Export takes the full ceiling; it only has to cover the detached launch,
    // since the render itself outlives the invocation inside the Sandbox.
    expect(declared.find((entry) => entry.route === CREATIVE_RENDER_ROUTE)?.maxDuration).toBe(
      HOBBY_MAX_DURATION,
    );
  });

  it("enables Fluid Compute for the long-running render route", () => {
    const config = JSON.parse(readFileSync(join(ROOT, "vercel.json"), "utf8")) as {
      fluid?: boolean;
    };
    expect(config.fluid).toBe(true);
  });
});
